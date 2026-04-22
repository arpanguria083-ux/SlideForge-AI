from app.models.schemas import (
    GuardrailSchema,
    Annotation,
    QAScorecard,
)
from app.services.guardrail import GuardrailManager


class TestGuardrailSchema:
    def test_create_default_guardrail(self):
        guardrail = GuardrailSchema()
        assert guardrail.schema_version == "1.0.0"
        assert guardrail.engagement_type == "strategy"
        assert guardrail.pass_threshold == 75

    def test_custom_guardrail(self):
        guardrail = GuardrailSchema(
            engagement_type="due_diligence",
            client_namespace="acme_corp",
            pass_threshold=80,
            rubric_weights={
                "structure": 0.20,
                "claim_grounding": 0.35,
                "data_accuracy": 0.25,
                "visual": 0.10,
                "language": 0.10,
            },
        )
        assert guardrail.engagement_type == "due_diligence"
        assert guardrail.client_namespace == "acme_corp"
        assert guardrail.pass_threshold == 80
        assert set(guardrail.rubric_weights.keys()) >= {
            "structure",
            "claim_grounding",
            "data_accuracy",
            "visual",
            "language",
            "framework",
            "so_what",
            "benchmarking",
        }
        assert abs(sum(guardrail.rubric_weights.values()) - 1.0) < 1e-6


class TestGuardrailManager:
    def test_sign_and_verify(self, tmp_path):
        manager = GuardrailManager(str(tmp_path / "guardrails"))

        guardrail = manager.create_guardrail()
        signed = manager.sign_guardrail(guardrail, "Senior Evaluator")

        assert signed.signed_by == "Senior Evaluator"
        assert signed.signed_at is not None
        assert signed.sha256 is not None
        assert signed.signature is not None
        assert signed.public_key is not None
        assert signed.signature_algorithm == "ed25519"

        assert manager.verify_guardrail(signed)

    def test_verify_fails_on_tampering(self, tmp_path):
        manager = GuardrailManager(str(tmp_path / "guardrails"))

        guardrail = manager.create_guardrail()
        signed = manager.sign_guardrail(guardrail, "Evaluator")

        signed.pass_threshold = 90
        assert not manager.verify_guardrail(signed)

    def test_verify_fails_on_signature_tampering(self, tmp_path):
        manager = GuardrailManager(str(tmp_path / "guardrails"))

        guardrail = manager.create_guardrail()
        signed = manager.sign_guardrail(guardrail, "Evaluator")

        assert signed.signature is not None
        signed.signature = signed.signature[:-2] + "ab"
        assert not manager.verify_guardrail(signed)

    def test_save_and_load(self, tmp_path):
        manager = GuardrailManager(str(tmp_path / "guardrails"))

        guardrail = manager.create_guardrail(
            engagement_type="ops_review", client_namespace="test_client"
        )
        signed = manager.sign_guardrail(guardrail, "Evaluator")

        filepath = manager.save_guardrail(signed, "test.json")

        loaded = manager.load_guardrail(filepath)

        assert loaded.engagement_type == "ops_review"
        assert loaded.client_namespace == "test_client"
        assert manager.verify_guardrail(loaded)

    def test_load_legacy_sha256_guardrail(self, tmp_path):
        manager = GuardrailManager(str(tmp_path / "guardrails"))

        guardrail = manager.create_guardrail(engagement_type="legacy")
        signed = manager.sign_guardrail(guardrail, "Evaluator")
        signed.signature = None
        signed.public_key = None
        signed.signature_algorithm = None

        filepath = manager.save_guardrail(signed, "legacy.json")
        loaded = manager.load_guardrail(filepath)
        assert loaded.engagement_type == "legacy"
        assert loaded.sha256 is not None


class TestAnnotation:
    def test_create_annotation(self):
        annotation = Annotation(
            slide_index=2,
            text="Revenue grew by 25%",
            category="claim_grounding",
            severity="warning",
            message="This claim needs source verification",
            suggestion="Add source citation",
        )
        assert annotation.slide_index == 2
        assert annotation.category == "claim_grounding"
        assert annotation.severity == "warning"


class TestQAScorecard:
    def test_hard_block_count_from_annotations(self):
        scorecard = QAScorecard(
            composite_score=85,
            hard_block_count=1,
            annotations=[
                Annotation(
                    slide_index=0,
                    text="Test",
                    category="test",
                    severity="hard_block",
                    message="Test",
                )
            ],
        )
        assert scorecard.hard_block_count == 1

    def test_dimension_scores(self):
        scorecard = QAScorecard(
            composite_score=78,
            structure_score=80,
            claim_grounding_score=85,
            data_accuracy_score=95,
            visual_compliance_score=70,
            language_score=75,
        )
        assert scorecard.structure_score == 80
        assert scorecard.data_accuracy_score == 95
