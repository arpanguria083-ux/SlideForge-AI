import asyncio
import os
import sys
import pytest

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from app.services.vision import vision_service
from app.agents.parallel_analysis import VisualAnalysisAgent
from app.models.schemas import GuardrailSchema

pytestmark = pytest.mark.e2e

# Force LM Studio usage for this test
os.environ["USE_LM_STUDIO"] = "1"
os.environ["API_BASE_URL"] = "http://localhost:1234/v1"


async def test_vision_components():
    print("=========================================")
    print("Testing Vision Component (LM Studio Qwen 3.5)")
    print("=========================================")

    # 1. Test LLM Vision Service directly
    # To test vision, we need a 1x1 black pixel base64 image
    dummy_b64 = "R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs="

    try:
        from PIL import Image
        import io
        import base64

        # Convert b64 string to PIL.Image for the service
        img_pil = Image.open(io.BytesIO(base64.b64decode(dummy_b64)))

        print("\n--- 1. Testing LM Studio Multimodal Output ---")
        prompt = "Describe this image in exactly one short sentence."
        res = await vision_service.analyze_image(img_pil, prompt)
        print(f"Vision Response -> {res}")
        if not res:
            print("WARNING: Vision analysis returned empty string.")
    except Exception as e:
        print(f"Vision Service Error: {e}")
        import traceback

        traceback.print_exc()
        return

    # 2. Test Agent integration
    print("\n--- 2. Testing VisualAnalysisAgent ---")

    dummy_slides_data = [
        {
            "index": 0,
            "title": "Welcome to Q3",
            "full_text": "Here is our quarterly performance.",
            "width": 10.0,
            "height": 7.5,
            "images": [
                {
                    "id": "img_0_1",
                    "x": 2.0,
                    "y": 2.0,
                    "width": 6.0,
                    "height": 4.0,
                    "image_data": dummy_b64,
                    "has_content": True,
                }
            ],
            "charts": [
                {
                    "id": "chart_1",
                    "title": "Revenue Growth",
                    "type": "bar",
                    "cache_values": "[100, 200, 300]",
                }
            ],
            "text_boxes": [
                {
                    "id": "tb_1",
                    "text": "Revenue Growth",
                    "x": 1.0,
                    "y": 1.0,
                    "width": 8.0,
                    "height": 1.0,
                    "runs": [{"text": "Revenue Growth"}],
                }
            ],
        }
    ]

    dummy_guardrail = GuardrailSchema(
        engagement_type="strategy",
        discovered_patterns={"visual": {}},
    )

    agent = VisualAnalysisAgent()
    try:
        result = await agent.run(dummy_slides_data, dummy_guardrail)
        print(f"Visual Agent Score: {result.score}")
        print(f"Visual Agent Annotations Found: {len(result.annotations)}")
        for ann in result.annotations:
            print(f"- [Severity: {ann.severity}] {ann.message}")
        print("\nAgent Test Complete!")
    except Exception as e:
        print(f"Agent Execution Error: {e}")


if __name__ == "__main__":
    asyncio.run(test_vision_components())
