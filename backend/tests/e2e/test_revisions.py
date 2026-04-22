import asyncio
import sys
from pathlib import Path
import pytest

# Add backend to path
sys.path.append(str(Path(__file__).parent.parent.parent))

from app.agents.parallel_analysis import RevisionOrchestrator
from app.models.schemas import Annotation, QAScorecard

pytestmark = pytest.mark.e2e


async def test_revisions():
    print("\n[TEST] RevisionOrchestrator (Auto-Remediation)")

    # 0. Setup mock scorecard with issues
    annotations = [
        Annotation(
            slide_index=0,
            text="The report was written by the consultant.",
            category="passive",
            severity="warning",
            message="Passive voice detected.",
        )
    ]
    scorecard = QAScorecard(
        composite_score=60,
        structure_score=60,
        claim_grounding_score=60,
        data_accuracy_score=60,
        visual_compliance_score=60,
        language_score=60,
        hard_block_count=0,
        warning_count=1,
        failing_slides=[0],
        annotations=annotations,
        summary="Testing revisions",
    )

    # 1. Initialize agent
    agent = RevisionOrchestrator()

    # 2. Run remediation
    try:
        print("Applying auto-remediation via LLM...")
        fixes = await agent.apply_auto_remediation(scorecard, [])
        print(f"Fixes applied: {len(fixes)}")

        for f in fixes:
            print(
                f" - Slide {f['slide_index']}: '{f['original_text']}' -> '{f['suggested_text']}'"
            )

        if len(fixes) > 0:
            print(">>> [PASS] RevisionOrchestrator successfully applied LLM fixes.")
        else:
            print(">>> [FAIL] No fixes applied. Check LLM output.")
            sys.exit(1)

    except Exception as e:
        print(f">>> [FAIL] Agent failed: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(test_revisions())
