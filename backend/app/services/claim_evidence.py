import chromadb
from chromadb.config import Settings as ChromaSettings
from typing import Optional
from pathlib import Path
import re

from .llm_inference import inference_service
from app.core.time_utils import utc_now_iso


class ChromaDBManager:
    def __init__(self, persist_directory: str = "data/chromadb"):
        self.persist_directory = Path(persist_directory)
        self.persist_directory.mkdir(parents=True, exist_ok=True)

        self.client = chromadb.PersistentClient(
            path=str(self.persist_directory),
            settings=ChromaSettings(
                anonymized_telemetry=False,
                allow_reset=True,
            ),
        )

    def create_collection(self, namespace: str) -> chromadb.Collection:
        collection_name = self._sanitize_name(namespace)

        try:
            collection = self.client.get_collection(collection_name)
        except Exception:
            collection = self.client.create_collection(
                collection_name,
                metadata={
                    "namespace": namespace,
                    "created_at": utc_now_iso(),
                },
            )

        return collection

    def get_collection(self, namespace: str) -> Optional[chromadb.Collection]:
        collection_name = self._sanitize_name(namespace)

        try:
            return self.client.get_collection(collection_name)
        except Exception:
            return None

    def _sanitize_name(self, name: str) -> str:
        return "".join(c if c.isalnum() else "_" for c in name.lower())

    def add_documents(
        self,
        namespace: str,
        documents: list[str],
        ids: list[str],
        metadatas: list[dict] = None,
    ):
        collection = self.create_collection(namespace)

        collection.add(
            documents=documents, ids=ids, metadatas=metadatas or [{}] * len(documents)
        )

    def query(
        self,
        namespace: str,
        query_texts: list[str],
        n_results: int = 5,
        threshold: float = 0.80,
    ) -> dict:
        collection = self.get_collection(namespace)

        if not collection:
            return {"matches": [], "note": "No collection found"}

        results = collection.query(query_texts=query_texts, n_results=n_results)

        filtered = {
            "matches": [],
            "distances": [],
        }

        for idx, (distance, metadata) in enumerate(
            zip(results.get("distances", [[]])[0], results.get("metadatas", [[]])[0])
        ):
            similarity = 1 - distance
            if similarity >= threshold:
                filtered["matches"].append(
                    {
                        "document": results["documents"][0][idx],
                        "metadata": metadata,
                        "similarity": similarity,
                    }
                )
                filtered["distances"].append(distance)

        return filtered

    def delete_collection(self, namespace: str):
        collection_name = self._sanitize_name(namespace)
        try:
            self.client.delete_collection(collection_name)
        except Exception:
            pass

    def reset(self):
        self.client.reset()


class ClaimEvidenceGuardrail:
    def __init__(self, chroma_manager: ChromaDBManager):
        self.chroma = chroma_manager
        self.entailment_threshold = 0.55

    async def check_claim(
        self, claim: str, namespace: str, source_documents: list[str] = None
    ) -> dict:
        if source_documents and not self.chroma.get_collection(namespace):
            self._index_sources(namespace, source_documents)

        retrieval_result = self.chroma.query(
            namespace=namespace,
            query_texts=[claim],
            n_results=4,
            threshold=self.entailment_threshold,
        )

        if not retrieval_result["matches"]:
            return {
                "claim": claim,
                "grounded": False,
                "evidence": None,
                "status": "UNGROUNDED",
                "severity": "hard_block",
                "message": "No supporting evidence found in source documents",
            }

        best_match = retrieval_result["matches"][0]
        evidence_documents = [m["document"] for m in retrieval_result["matches"]]
        merged_evidence = "\n\n---\n\n".join(evidence_documents[:3])[:4000]
        entailment_result = await self._check_entailment(claim, merged_evidence)

        if not entailment_result["supported"]:
            return {
                "claim": claim,
                "grounded": False,
                "evidence": merged_evidence[:300],
                "status": "ENTAILMENT_FAILED",
                "severity": "hard_block",
                "message": "Evidence exists but does not support the claim",
                "reasoning": entailment_result.get("reasoning"),
                "similarity": best_match.get("similarity", 0),
            }

        return {
            "claim": claim,
            "grounded": True,
            "evidence": merged_evidence[:300],
            "status": "GROUNDED",
            "severity": "pass",
            "message": "Claim is supported by source evidence",
            "similarity": best_match.get("similarity", 0),
            "reasoning": entailment_result.get("reasoning"),
        }

    def _index_sources(self, namespace: str, documents: list[str]):
        collection = self.chroma.create_collection(namespace)

        ids = [f"doc_{idx}" for idx in range(len(documents))]

        collection.add(
            documents=documents,
            ids=ids,
            metadatas=[
                {"index": idx, "source": "playbook"} for idx in range(len(documents))
            ],
        )

    async def _check_entailment(self, claim: str, evidence: str) -> dict:
        if inference_service.llm is not None:
            try:
                result = await inference_service.check_entailment(claim, evidence)
                if isinstance(result, dict) and "supported" in result:
                    return result
            except Exception:
                pass

        return self._check_entailment_fallback(claim, evidence)

    def _check_entailment_fallback(self, claim: str, evidence: str) -> dict:
        """TF-IDF cosine similarity fallback for entailment checking.

        When no LLM is available, this replaces naive keyword overlap with
        TF-IDF unigram+bigram cosine similarity.  TF-IDF captures term
        importance (not just presence) and bigrams provide phrase-level
        matching, significantly reducing false negatives/positives.
        """
        try:
            from sklearn.feature_extraction.text import TfidfVectorizer
            from sklearn.metrics.pairwise import cosine_similarity
            import numpy as np

            # Fit on evidence corpus for meaningful IDF weights, then compare
            vectorizer = TfidfVectorizer(
                ngram_range=(1, 2),
                max_features=3000,
                stop_words="english",
                sublinear_tf=True,
            )
            tfidf_matrix = vectorizer.fit_transform([evidence, claim])
            similarity = cosine_similarity(tfidf_matrix[1:2], tfidf_matrix[0:1])[0][0]

            supported = similarity >= 0.35
            confidence = (
                min(0.85, similarity + 0.15) if supported else max(0.1, similarity)
            )

            return {
                "supported": supported,
                "reasoning": (
                    f"TF-IDF cosine similarity={similarity:.3f} "
                    f"({'above' if supported else 'below'} threshold 0.35)"
                ),
                "confidence": round(confidence, 2),
            }

        except ImportError:
            # scikit-learn not installed — fall back to keyword overlap
            claim_keywords = set(re.findall(r"\b[a-z0-9.%$]+\b", claim.lower()))
            evidence_keywords = set(re.findall(r"\b[a-z0-9.%$]+\b", evidence.lower()))
            overlap = claim_keywords & evidence_keywords
            ratio = len(overlap) / len(claim_keywords) if claim_keywords else 0

            return {
                "supported": ratio >= 0.6,
                "reasoning": f"Keyword overlap ratio={ratio:.2f} (scikit-learn unavailable)",
                "confidence": 0.55 if ratio >= 0.6 else 0.2,
            }

    async def check_claims_batch(
        self, claims: list[str], namespace: str, source_documents: list[str] = None
    ) -> list[dict]:
        import asyncio

        return list(
            await asyncio.gather(
                *[
                    self.check_claim(claim, namespace, source_documents)
                    for claim in claims
                ],
                return_exceptions=False,
            )
        )
