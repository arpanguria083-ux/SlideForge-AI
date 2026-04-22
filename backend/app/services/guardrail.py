import json
import hashlib
from typing import Optional
from pathlib import Path
import base64

from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from ..models.schemas import GuardrailSchema, DEFAULT_RUBRIC_WEIGHTS
from ..core.time_utils import utc_now_compact, utc_now_iso


class GuardrailManager:
    def __init__(self, base_dir: str = "data/guardrails"):
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self._key_dir = self.base_dir.parent / "keys"
        self._key_dir.mkdir(parents=True, exist_ok=True)
        self._private_key_path = self._key_dir / "guardrail_signing.key"
        self._public_key_path = self._key_dir / "guardrail_signing.pub"

    def create_guardrail(
        self,
        engagement_type: str = "strategy",
        client_namespace: Optional[str] = None,
        playbook_rules: list[dict] = None,
        human_confirmed_rules: list[dict] = None,
        rubric_weights: dict = None,
        language_rules: dict = None,
        pass_threshold: int = 75,
    ) -> GuardrailSchema:
        normalized_weights = self._normalize_weights(rubric_weights)
        guardrail = GuardrailSchema(
            schema_version="1.0.0",
            engagement_type=engagement_type,
            client_namespace=client_namespace,
            playbook_rules=playbook_rules or [],
            human_confirmed_rules=human_confirmed_rules or [],
            rubric_weights=normalized_weights,
            language_rules=language_rules or {},
            pass_threshold=pass_threshold,
        )

        return guardrail

    def _normalize_weights(self, rubric_weights: Optional[dict]) -> dict[str, float]:
        if not isinstance(rubric_weights, dict) or not rubric_weights:
            return dict(DEFAULT_RUBRIC_WEIGHTS)
        return GuardrailSchema(
            rubric_weights=rubric_weights
        ).normalized_rubric_weights()

    def sign_guardrail(
        self, guardrail: GuardrailSchema, signer_name: str
    ) -> GuardrailSchema:
        guardrail.signed_by = signer_name
        guardrail.signed_at = utc_now_iso()

        canonical_json = self._canonical_json(guardrail)
        guardrail.sha256 = hashlib.sha256(canonical_json.encode()).hexdigest()
        private_key = self._load_or_create_signing_keypair()
        signature = private_key.sign(canonical_json.encode("utf-8"))
        public_key = private_key.public_key().public_bytes_raw()
        guardrail.signature = base64.b64encode(signature).decode("ascii")
        guardrail.public_key = base64.b64encode(public_key).decode("ascii")
        guardrail.signature_algorithm = "ed25519"

        return guardrail

    def verify_guardrail(self, guardrail: GuardrailSchema) -> bool:
        if guardrail.signature and guardrail.public_key:
            return self._verify_ed25519_signature(guardrail)
        if not guardrail.sha256:
            return False

        stored_hash = guardrail.sha256
        guardrail.sha256 = None

        canonical_json = self._canonical_json(guardrail)
        computed_hash = hashlib.sha256(canonical_json.encode()).hexdigest()

        guardrail.sha256 = stored_hash

        return stored_hash == computed_hash

    def _canonical_json(self, guardrail: GuardrailSchema) -> str:
        data = guardrail.model_dump(
            exclude={"sha256", "signature", "public_key", "signature_algorithm"}
        )
        return json.dumps(data, sort_keys=True, separators=(",", ":"))

    def _load_or_create_signing_keypair(self) -> Ed25519PrivateKey:
        if self._private_key_path.exists():
            key_bytes = self._private_key_path.read_bytes()
            return Ed25519PrivateKey.from_private_bytes(key_bytes)

        private_key = Ed25519PrivateKey.generate()
        public_key = private_key.public_key()
        private_bytes = private_key.private_bytes_raw()
        public_bytes = public_key.public_bytes_raw()
        self._private_key_path.write_bytes(private_bytes)
        self._public_key_path.write_bytes(public_bytes)
        try:
            self._private_key_path.chmod(0o600)
            self._public_key_path.chmod(0o644)
        except Exception:
            pass
        return private_key

    def _verify_ed25519_signature(self, guardrail: GuardrailSchema) -> bool:
        try:
            signature_bytes = base64.b64decode(guardrail.signature or "", validate=True)
            public_key_bytes = base64.b64decode(
                guardrail.public_key or "", validate=True
            )
            public_key = Ed25519PublicKey.from_public_bytes(public_key_bytes)
            canonical_json = self._canonical_json(guardrail)
            public_key.verify(signature_bytes, canonical_json.encode("utf-8"))
            return True
        except Exception:
            return False

    def save_guardrail(
        self, guardrail: GuardrailSchema, filename: Optional[str] = None
    ) -> str:
        if not filename:
            namespace = guardrail.client_namespace or "default"
            engagement = guardrail.engagement_type
            version = guardrail.schema_version
            timestamp = utc_now_compact()
            filename = f"guardrail_{namespace}_{engagement}_{version}_{timestamp}.json"

        filepath = self.base_dir / filename

        with open(filepath, "w") as f:
            json.dump(guardrail.model_dump(), f, indent=2)

        return str(filepath)

    def load_guardrail(
        self, filepath: str, require_signature: bool = True
    ) -> GuardrailSchema:
        with open(filepath, "r") as f:
            data = json.load(f)

        guardrail = GuardrailSchema(**data)

        if require_signature and not self.verify_guardrail(guardrail):
            raise ValueError(f"Guardrail integrity check failed: {filepath}")
        if (
            not require_signature
            and guardrail.sha256
            and not self.verify_guardrail(guardrail)
        ):
            raise ValueError(f"Guardrail integrity check failed: {filepath}")

        return guardrail

    def merge_guardrails(
        self,
        base: GuardrailSchema,
        client: GuardrailSchema,
        engagement: GuardrailSchema,
    ) -> GuardrailSchema:
        playbook_rules = self._dedupe_rules(
            engagement.playbook_rules or base.playbook_rules or []
        )
        human_rules = self._dedupe_rules(
            engagement.human_confirmed_rules or base.human_confirmed_rules or []
        )
        merged = GuardrailSchema(
            schema_version=engagement.schema_version,
            engagement_type=engagement.engagement_type,
            client_namespace=engagement.client_namespace,
            discovered_patterns=engagement.discovered_patterns
            or base.discovered_patterns,
            playbook_rules=playbook_rules,
            human_confirmed_rules=human_rules,
            rubric_weights=engagement.rubric_weights or base.rubric_weights,
            language_rules=engagement.language_rules or base.language_rules,
            pass_threshold=engagement.pass_threshold or base.pass_threshold,
        )

        return merged

    def _dedupe_rules(self, rules: list[dict | str]) -> list[dict | str]:
        seen: set[str] = set()
        deduped: list[dict | str] = []
        for rule in rules or []:
            try:
                key = json.dumps(rule, sort_keys=True)
            except Exception:
                key = str(rule)
            if key in seen:
                continue
            seen.add(key)
            deduped.append(rule)
        return deduped

    def diff_guardrails(self, old: GuardrailSchema, new: GuardrailSchema) -> dict:
        changes = {"added": [], "modified": [], "removed": []}

        old_rules = {json.dumps(r): r for r in (old.human_confirmed_rules or [])}
        new_rules = {json.dumps(r): r for r in (new.human_confirmed_rules or [])}

        for rule_json, rule in new_rules.items():
            if rule_json not in old_rules:
                changes["added"].append(rule)
            elif old_rules[rule_json] != rule:
                changes["modified"].append({"old": old_rules[rule_json], "new": rule})

        for rule_json, rule in old_rules.items():
            if rule_json not in new_rules:
                changes["removed"].append(rule)

        return changes
