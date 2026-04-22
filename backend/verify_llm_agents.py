import asyncio
from dotenv import load_dotenv

# ruff: noqa: E402

# Load the .env file that points to LM Studio
load_dotenv()  # noqa: E402
from app.agents.parallel_analysis import InsightExtractor
from app.agents.language_analysis import LanguageAnalysisAgent
from app.models.schemas import GuardrailSchema


async def main():
    print("=== Testing LLM Agents with LM Studio ===")

    # 1. Setup mock data simulating a slide extraction
    mock_slides = [
        {
            "index": 0,
            "title": "Market Dominance",
            "full_text": "We are absolutely certain that we currently hold 75% of the total addressable market. This is a tremendous opportunity that we must optimize immediately. Data suggests this is true.",
        }
    ]
    guardrail = GuardrailSchema()

    # 2. Test InsightExtractor (Factual Claim Detection)
    print("\n--- 1. Testing InsightExtractor (Claims & Evidence) ---")
    try:
        insight_agent = InsightExtractor()
        insight_result = await insight_agent.run(mock_slides, guardrail)
        print("Status: Success")
        print(f"Score: {insight_result.score}")
        print(f"Findings ({len(insight_result.findings)}):")
        for f in insight_result.findings:
            print(f"  - [{f.severity}] {f.text}: {f.message}")
    except Exception as e:
        print(f"Failed: {e}")

    # 3. Test LanguageAnalysisAgent (Quality & Tone)
    print("\n--- 2. Testing LanguageAnalysisAgent (Quality) ---")
    try:
        lang_agent = LanguageAnalysisAgent()
        lang_result = await lang_agent.analyze_deck(mock_slides, guardrail_rules={})
        print("Status: Success")
        print(f"Findings ({len(lang_result)}):")
        for f in lang_result:
            if f.category == "quality":
                print(
                    f"  - [{f.severity}] [LLM Quality Check] {f.text}: {f.message} (Suggested: {f.suggestion})"
                )
    except Exception as e:
        print(f"Failed: {e}")

    print("\n=== All Tests Complete ===")


if __name__ == "__main__":
    asyncio.run(main())
