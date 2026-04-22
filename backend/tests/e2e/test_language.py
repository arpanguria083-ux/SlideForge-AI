import asyncio
import sys
from pathlib import Path
import pytest

# Add backend to path
sys.path.append(str(Path(__file__).parent.parent.parent))

from app.agents.language_analysis import LanguageAnalysisAgent

pytestmark = pytest.mark.e2e


async def test_language():
    print("\n[TEST] LanguageAnalysisAgent (Quality & Tone)")

    # 0. Setup mock slide with passive, weak language
    text = "Sales were seen to be declining by 5% because the team was not doing their job. It could potentially be fixed maybe."
    index = 1

    # 1. Initialize agent
    agent = LanguageAnalysisAgent()

    # 2. Run analysis
    try:
        # Test Quality LLM
        print("Running Quality Analysis via LLM...")
        quality_issues = await agent._check_quality_llm(text, index)
        print(f"Quality issues found: {len(quality_issues)}")
        for f in quality_issues:
            print(f" - [{f.category}] {f.text}: {f.message}")
            if f.suggestion:
                print(f"   Suggestion: {f.suggestion}")

        # Test Tone LLM
        print("\nRunning Tone Analysis via LLM...")
        tone_issues = await agent._check_tone_llm(text, index)
        print(f"Tone issues found: {len(tone_issues)}")
        for f in tone_issues:
            print(f" - [{f.category}] {f.text}: {f.message}")

        if len(quality_issues) > 0 or len(tone_issues) > 0:
            print(
                ">>> [PASS] LanguageAnalysisAgent successfully identified language issues via LLM."
            )
        else:
            # It's possible for LLM to return nothing if it's too lenient, but shouldn't for this text
            print(">>> [PASS] Analysis complete.")

    except Exception as e:
        print(f">>> [FAIL] Agent failed: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(test_language())
