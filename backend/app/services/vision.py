"""
Vision model service — uses LM Studio multimodal endpoint for image analysis.
Supports Qwen 3.5 vision models loaded in LM Studio.
Falls back to basic metadata extraction if vision is unavailable.
"""

import os
import io
import base64
import json
import logging
from PIL import Image

logger = logging.getLogger("slideforge.vision")


class LMStudioVisionModel:
    """
    Uses LM Studio's OpenAI-compatible multimodal endpoint to analyze images.
    Requires a vision-capable model (e.g., Qwen 3.5-9B) loaded in LM Studio.
    """

    def __init__(
        self,
        base_url: str = None,
        api_key: str = "lm-studio",
    ):
        self.base_url = base_url or os.getenv(
            "API_BASE_URL", "http://localhost:1234/v1"
        )
        self.api_key = api_key

    def _image_to_base64(self, image: Image.Image, max_size: int = 1024) -> str:
        """Convert PIL image to base64, resizing if too large."""
        # Resize to avoid overwhelming the model
        w, h = image.size
        if max(w, h) > max_size:
            ratio = max_size / max(w, h)
            image = image.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)

        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return base64.b64encode(buffer.getvalue()).decode("utf-8")

    async def analyze_image(
        self,
        image: Image.Image,
        prompt: str,
    ) -> str:
        """Send image + text prompt to LM Studio multimodal model."""
        import httpx

        b64 = self._image_to_base64(image)

        payload = {
            "model": "local-model",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": prompt,
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{b64}",
                            },
                        },
                    ],
                }
            ],
            "max_tokens": 2048,
            "temperature": 0.3,
            "stream": False,
        }

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=120.0,
                )

            if response.status_code != 200:
                logger.error(
                    f"Vision API error {response.status_code}: {response.text[:200]}"
                )
                return f"[Vision API error: {response.status_code}]"

            data = response.json()
            content = ""
            if "choices" in data and data["choices"]:
                msg = data["choices"][0].get("message", {})
                content = msg.get("content") or msg.get("reasoning_content") or ""

            logger.info(f"Vision analysis OK | len={len(content)}")
            return content

        except Exception as e:
            logger.error(f"Vision analysis failed: {e}")
            return f"[Vision analysis failed: {e}]"

    async def extract_chart_data(self, image: Image.Image) -> dict:
        """Analyze a chart/graph image and extract structured data."""
        prompt = """Analyze this chart/graph image and extract ALL information:

Return a JSON object:
{
  "chart_type": "bar|line|pie|scatter|area|other",
  "title": "<chart title if visible>",
  "x_axis": {"label": "", "values": []},
  "y_axis": {"label": "", "values": []},
  "data_points": [{"label": "", "value": ""}],
  "trends": "<describe any visible trends>",
  "key_insight": "<one sentence summary of what the chart shows>"
}

Return ONLY the JSON. No markdown wrapping."""

        result = await self.analyze_image(image, prompt)
        try:
            from app.services.llm_inference import parse_json_response
            parsed = parse_json_response(result)
            if isinstance(parsed, dict):
                return parsed
            raise ValueError()
        except Exception:
            return {"raw_analysis": result, "chart_type": "unknown"}

    async def extract_table_content(self, image: Image.Image) -> dict:
        """Analyze a table-like image and extract structured content."""
        prompt = """Analyze this table or screenshot from a consulting slide.

Return a JSON object:
{
  "title": "<table title if visible>",
  "headers": ["<header 1>", "<header 2>"],
  "key_rows": [
    {
      "label": "<row label>",
      "values": ["<value 1>", "<value 2>"]
    }
  ],
  "table_summary": "<2 sentence summary of what the table is communicating>",
  "confidence": "high|medium|low"
}

Return ONLY the JSON. No markdown wrapping."""

        result = await self.analyze_image(image, prompt)
        try:
            from app.services.llm_inference import parse_json_response
            parsed = parse_json_response(result)
            if isinstance(parsed, dict):
                return parsed
            raise ValueError()
        except Exception:
            return {
                "title": "",
                "headers": [],
                "key_rows": [],
                "table_summary": result[:300],
                "confidence": "low",
            }

    async def describe_image(self, image: Image.Image) -> dict:
        """Get a general description of an image found in a slide."""
        prompt = """Describe this image from a consulting slide deck. Focus on:
1. What the image shows (diagram, photo, icon, logo, etc.)
2. Any text visible in the image
3. How it relates to a business/consulting context
4. Any data or information conveyed

Return JSON:
{
  "type": "diagram|photo|icon|logo|illustration|screenshot|other",
  "description": "<2-3 sentence description>",
  "visible_text": ["<any text found>"],
  "relevance": "high|medium|low",
  "suggestion": "<any improvement suggestion or empty string>"
}

Return ONLY the JSON."""

        result = await self.analyze_image(image, prompt)
        try:
            from app.services.llm_inference import parse_json_response
            parsed = parse_json_response(result)
            if isinstance(parsed, dict):
                return parsed
            raise ValueError()
        except Exception:
            return {
                "type": "unknown",
                "description": result[:200],
                "relevance": "unknown",
            }


class FallbackVisionModel:
    """Basic image metadata extraction when no vision model is available."""

    async def analyze_image(self, image: Image.Image, prompt: str) -> str:
        width, height = image.size
        return (
            f"[No vision model available] Image: {width}x{height} {image.mode}. "
            f"Load a vision-capable model in LM Studio for full analysis."
        )

    async def extract_chart_data(self, image: Image.Image) -> dict:
        return {
            "chart_type": "unknown",
            "note": "No vision model available. Load a multimodal model in LM Studio.",
        }

    async def extract_table_content(self, image: Image.Image) -> dict:
        w, h = image.size
        return {
            "title": "",
            "headers": [],
            "key_rows": [],
            "table_summary": f"Table-like region {w}x{h}px detected, but structured reading requires a multimodal model.",
            "confidence": "low",
        }

    async def describe_image(self, image: Image.Image) -> dict:
        w, h = image.size
        return {
            "type": "unknown",
            "description": f"Image {w}x{h}px — vision analysis requires a multimodal model",
            "relevance": "unknown",
        }


def create_vision_model() -> LMStudioVisionModel:
    """Create the vision model — always use LM Studio multimodal when available."""
    # Check if LM Studio is running
    try:
        import socket

        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            if s.connect_ex(("localhost", 1234)) == 0:
                logger.info("LM Studio detected — using multimodal vision endpoint")
                return LMStudioVisionModel()
    except Exception:
        pass

    logger.warning("LM Studio not detected — using fallback vision model")
    return FallbackVisionModel()


vision_service = create_vision_model()
