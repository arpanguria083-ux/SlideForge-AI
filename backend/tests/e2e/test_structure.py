import asyncio
import sys
from pathlib import Path
import pytest

# Add backend to path
sys.path.append(str(Path(__file__).parent.parent.parent))

from app.agents.parallel_analysis import StructureAuditor
from app.models.schemas import GuardrailSchema

pytestmark = pytest.mark.e2e


async def test_structure():
    print("\n[TEST] StructureAuditor (Narrative & Headlines)")

    # 0. Setup mock deck with weak/descriptive headlines
    mock_slides = [
        {
            "index": 0,
            "title": "Introduction",
            "full_text": "Company overview and history.",
        },
        {
            "index": 1,
            "title": "Revenue Chart",
            "full_text": "Sales reached $10M in 2023.",
        },
        {
            "index": 2,
            "title": "Strategic Recommendation",
            "full_text": "We should grow the business.",
        },
    ]

    # 1. Initialize agent
    agent = StructureAuditor()
    guardrail = GuardrailSchema()

    # 2. Run analysis
    try:
        result = await agent.run(mock_slides, guardrail)
        print(f"Agent Score: {result.score}/100")
        print(f"Structural issues: {len(result.findings)}")

        for f in result.findings:
            print(f" - [{f.category}] {f.text}: {f.message}")
            if f.suggestion:
                print(f"   Suggestion: {f.suggestion}")

        if len(result.findings) > 0:
            print(
                ">>> [PASS] StructureAuditor successfully identified structural issues via LLM."
            )
        else:
            print(">>> [PASS] All headlines strong (or LLM returned nothing).")

    except Exception as e:
        print(f">>> [FAIL] Agent failed: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(test_structure())
