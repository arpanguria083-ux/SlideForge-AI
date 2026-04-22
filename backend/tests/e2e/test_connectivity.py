import asyncio
import sys
from pathlib import Path
import pytest

# Add backend to path
sys.path.append(str(Path(__file__).parent.parent.parent))

from app.services.llm_inference import Message, LLMFactory

pytestmark = pytest.mark.e2e


async def test_connectivity():
    print("\n[TEST] LM Studio Connectivity")

    # 1. Test Factory detection
    llm = LLMFactory.create_auto()
    print(f"Detected LLM Provider: {type(llm).__name__}")

    # 2. Test actual generation
    messages = [
        Message(
            role="user",
            content="Respond with exactly the word 'SUCCESS' if you can read this.",
        )
    ]
    try:
        response = await llm.generate(messages, max_tokens=100)
        content = response.content.strip().upper()
        print(f"Received: '{content}'")

        if "SUCCESS" in content:
            print(">>> [PASS] Connectivity verified.")
        elif content:
            print(
                f">>> [PASS] Connectivity verified (Partial/Other response: {content})"
            )
        else:
            print(">>> [FAIL] Received empty response.")
            sys.exit(1)
    except Exception as e:
        print(f">>> [FAIL] Request failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(test_connectivity())
