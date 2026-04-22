import httpx
import logging
import os


class LanguageToolClient:
    def __init__(self, base_url: str | None = None):
        self.base_url = (
            base_url or os.getenv("LANGUAGETOOL_URL") or "http://localhost:8081"
        ).rstrip("/")
        self.check_url = f"{self.base_url}/v2/check"
        self._last_error: str | None = None

    async def check(self, text: str, language: str = "en-US") -> list[dict]:
        if not text.strip():
            return []

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.post(
                    self.check_url, data={"text": text, "language": language}
                )
                response.raise_for_status()
                data = response.json()
                self._last_error = None
                return data.get("matches", [])
        except Exception as e:
            # Silent fallback if LT is not running or error occurs
            logging.debug(f"LanguageTool check failed: {e}. Falling back to regex.")
            self._last_error = str(e)
            return []

    async def is_available(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=1.0) as client:
                response = await client.get(f"{self.base_url}/v2/languages")
                if response.status_code == 200:
                    self._last_error = None
                    return True
                self._last_error = f"Unexpected status code {response.status_code}"
                return False
        except Exception as e:
            self._last_error = str(e)
            return False

    async def status(self) -> dict:
        available = await self.is_available()
        return {
            "available": available,
            "base_url": self.base_url,
            "check_url": self.check_url,
            "last_error": self._last_error,
        }
