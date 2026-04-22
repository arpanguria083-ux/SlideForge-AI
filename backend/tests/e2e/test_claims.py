import asyncio
import sys
from pathlib import Path
import pytest

# Add backend to path
sys.path.append(str(Path(__file__).parent.parent.parent))

from app.agents.parallel_analysis import InsightExtractor
from app.models.schemas import GuardrailSchema

pytestmark = pytest.mark.e2e


async def test_claims():
    print("\n[TEST] InsightExtractor (Claims & Evidence)")

    # 0. Setup mock slide with explicit claims
    mock_slides = [
        {
            "index": 1,
            "title": "Revenue Outlook",
            "full_text": "We anticipate a 15% revenue increase in Q4 due to new product launches. We are the market leader with 45% share. Potential for growth exists.",
        }
    ]

    # 1. Initialize agent
    agent = InsightExtractor()
    guardrail = GuardrailSchema()

    # 2. Run analysis
    try:
        result = await agent.run(mock_slides, guardrail)
        print(f"Agent Score: {result.score}/100")
        print(f"Claims found: {len(result.findings)}")

        for f in result.findings:
            status = f.severity if f.severity else "info"
            print(f" - [{status}] {f.text[:50]}...: {f.message}")

        if len(result.findings) > 0:
            print(">>> [PASS] InsightExtractor successfully identified claims via LLM.")
        else:
            print(">>> [FAIL] InsightExtractor returned no findings. Check LLM output.")
            sys.exit(1)

    except Exception as e:
        print(f">>> [FAIL] Agent failed: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(test_claims())
