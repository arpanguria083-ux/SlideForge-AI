import asyncio
import httpx


async def main():
    print("Testing basic generation with LM Studio...")
    payload = {
        "model": "local-model",
        "messages": [
            {
                "role": "user",
                "content": "Hello! Please reply with exactly 'Hello World'.",
            }
        ],
        "temperature": 0.7,
        "max_tokens": 50,
        "stream": False,
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(
            "http://localhost:1234/v1/chat/completions",
            json=payload,
            timeout=30.0,
        )

    data = response.json()
    print("Response JSON:")
    print(data)
    print(
        "Content:",
        repr(data.get("choices", [{}])[0].get("message", {}).get("content", "")),
    )


if __name__ == "__main__":
    asyncio.run(main())
