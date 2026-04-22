import os
import json
import re
import time
import asyncio
from typing import Optional, AsyncGenerator, Any, Union
from dataclasses import dataclass, asdict
from enum import Enum
from abc import ABC, abstractmethod
import warnings


def parse_json_response(content: str) -> Union[dict, list]:
    """Robustly extract and parse JSON from model output that may include reasoning or markdown."""
    if not content:
        return {}

    content = content.strip()

    # Try markdown JSON blocks first
    md_matches = re.findall(r"```(?:json)?\s*([\s\S]*?)```", content)
    for block in reversed(md_matches):
        try:
            return json.loads(block.strip())
        except Exception:
            pass

    # Try repairing malformed JSON if json_repair is available
    try:
        from json_repair import repair_json

        repaired = repair_json(content)
        if isinstance(repaired, (dict, list)):
            return repaired
        if isinstance(repaired, str):
            return json.loads(repaired)
    except Exception:
        pass

    # Brute-force search from each potential opening delimiter
    for start_char, end_char in [("{", "}"), ("[", "]")]:
        start_indices = [m.start() for m in re.finditer(re.escape(start_char), content)]
        for start_idx in reversed(start_indices):
            end_idx = content.rfind(end_char)
            if end_idx > start_idx:
                potential_json = content[start_idx : end_idx + 1]
                try:
                    return json.loads(potential_json)
                except Exception:
                    pass

    # Final attempt
    try:
        return json.loads(content)
    except Exception:
        import logging

        logging.getLogger("slideforge.llm").warning(
            f"Failed to parse JSON: {content[:100]}..."
        )
        return {}


# Load .env into os.environ so os.getenv() calls below work correctly.
# pydantic_settings reads .env for Settings fields only; it does NOT
# populate os.environ, so we need this explicit load.
try:
    from dotenv import load_dotenv as _load_dotenv

    _load_dotenv(override=False)
except ImportError:
    pass


class InferenceProvider(str, Enum):
    MLX = "mlx"
    TRANSFORMERS = "transformers"
    API = "api"
    OLLAMA = "ollama"
    LM_STUDIO = "lm_studio"


@dataclass
class ProviderConnectionConfig:
    base_url: str
    api_key: str = ""
    model: str = "local-model"


@dataclass
class RuntimeProviderConfig:
    provider: InferenceProvider
    api: ProviderConnectionConfig
    ollama: ProviderConnectionConfig
    lm_studio: ProviderConnectionConfig

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class LLMResponse:
    content: str
    usage: dict
    model: str
    finish_reason: str = "stop"


@dataclass
class Message:
    role: str
    content: str


class BaseLLM(ABC):
    @abstractmethod
    async def generate(self, messages: list[Message], **kwargs) -> LLMResponse:
        pass

    @abstractmethod
    async def stream(
        self, messages: list[Message], **kwargs
    ) -> AsyncGenerator[str, None]:
        pass


class MLXLLM(BaseLLM):
    def __init__(
        self,
        model_path: str = "mlx-community/Qwen2.5-7B-Instruct-4bit",
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ):
        self.model_path = model_path
        self.max_tokens = max_tokens
        self.temperature = temperature
        self._model = None
        self._tokenizer = None

    def _ensure_loaded(self):
        if self._model is None:
            try:
                from mlx_lm import load

                self._model, self._tokenizer = load(self.model_path)
            except ImportError:
                raise ImportError(
                    "MLX-LM not installed. Install with: pip install mlx-lm"
                )
            except Exception as e:
                raise RuntimeError(f"Failed to load MLX model: {e}")

    async def generate(self, messages: list[Message], **kwargs) -> LLMResponse:
        self._ensure_loaded()

        from mlx_lm import generate

        prompt = self._format_prompt(messages)

        response = generate(
            self._model,
            self._tokenizer,
            prompt,
            max_tokens=kwargs.get("max_tokens", self.max_tokens),
            temp=kwargs.get("temperature", self.temperature),
        )

        return LLMResponse(
            content=response,
            usage={"prompt_tokens": 0, "completion_tokens": len(response)},
            model=self.model_path,
        )

    async def stream(
        self, messages: list[Message], **kwargs
    ) -> AsyncGenerator[str, None]:
        self._ensure_loaded()

        from mlx_lm import generate

        prompt = self._format_prompt(messages)

        for token in generate(
            self._model,
            self._tokenizer,
            prompt,
            max_tokens=kwargs.get("max_tokens", self.max_tokens),
            temp=kwargs.get("temperature", self.temperature),
            stream=True,
        ):
            yield token

    def _format_prompt(self, messages: list[Message]) -> str:
        system_prompt = ""
        user_messages = []

        for msg in messages:
            if msg.role == "system":
                system_prompt = msg.content
            else:
                user_messages.append(msg)

        if system_prompt:
            prompt = f"<|system|>{system_prompt}"
        else:
            prompt = "<|system|>You are a helpful assistant."

        for msg in user_messages:
            if msg.role == "user":
                prompt += f"\n<|user|>{msg.content}"
            elif msg.role == "assistant":
                prompt += f"\n<|assistant|>{msg.content}"

        prompt += "\n<|assistant|>"

        return prompt


class TransformersLLM(BaseLLM):
    def __init__(
        self,
        model_name: str = "Qwen/Qwen2.5-7B-Instruct",
        max_tokens: int = 4096,
        temperature: float = 0.7,
        device: str = "auto",
    ):
        self.model_name = model_name
        self.max_tokens = max_tokens
        self.temperature = temperature
        self.device = device
        self._pipeline = None

    def _ensure_loaded(self):
        if self._pipeline is None:
            try:
                import torch
                from transformers import AutoTokenizer, AutoModelForCausalLM, pipeline

                # Optimization: Use float16 on GPU
                torch_dtype = (
                    torch.float16
                    if "cuda" in self.device or self.device == "auto"
                    else torch.float32
                )

                tokenizer = AutoTokenizer.from_pretrained(
                    self.model_name,
                    trust_remote_code=True,
                )

                # Check for bitsandbytes for 4-bit
                load_kwargs = {
                    "trust_remote_code": True,
                    "device_map": self.device,
                    "torch_dtype": torch_dtype,
                }

                try:
                    import importlib.util

                    if importlib.util.find_spec("bitsandbytes") is not None:
                        load_kwargs["load_in_4bit"] = True
                        print("BitsAndBytes detected: Enabling 4-bit quantization")
                except Exception:
                    pass

                model = AutoModelForCausalLM.from_pretrained(
                    self.model_name, **load_kwargs
                )

                self._pipeline = pipeline(
                    "text-generation",
                    model=model,
                    tokenizer=tokenizer,
                )
            except Exception as e:
                raise RuntimeError(f"Failed to load Transformers model: {e}")

    async def generate(self, messages: list[Message], **kwargs) -> LLMResponse:
        self._ensure_loaded()

        prompt = self._format_prompt(messages)

        outputs = self._pipeline(
            prompt,
            max_new_tokens=kwargs.get("max_tokens", self.max_tokens),
            temperature=kwargs.get("temperature", self.temperature),
            do_sample=True,
            return_full_text=False,
        )

        response = outputs[0]["generated_text"]

        return LLMResponse(
            content=response,
            usage={"prompt_tokens": 0, "completion_tokens": len(response)},
            model=self.model_name,
        )

    async def stream(
        self, messages: list[Message], **kwargs
    ) -> AsyncGenerator[str, None]:
        raise NotImplementedError("Streaming not supported for Transformers backend")

    def _format_prompt(self, messages: list[Message]) -> str:
        prompt = "<|im_start|>system\n"

        for msg in messages:
            if msg.role == "system":
                prompt += msg.content + "\n"

        prompt += "<|im_end|>\n"

        for msg in messages:
            if msg.role != "system":
                prompt += f"<|im_start|>{msg.role}\n{msg.content}<|im_end|>\n"

        prompt += "<|im_start|>assistant\n"

        return prompt


class APILLM(BaseLLM):
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: str = "qwen2.5-7b-instruct",
    ):
        import httpx

        self.api_key = api_key or os.getenv("API_KEY", "")
        self.base_url = base_url or os.getenv(
            "API_BASE_URL", "http://localhost:11434/v1"
        )
        self.model = model
        self._timeout = httpx.Timeout(connect=5.0, read=180.0, write=30.0, pool=10.0)
        self._limits = httpx.Limits(max_keepalive_connections=8, max_connections=16)
        self._client = httpx.AsyncClient(timeout=self._timeout, limits=self._limits)

    async def aclose(self):
        await self._client.aclose()

    async def _post_chat(self, headers: dict, payload: dict):
        import httpx
        import logging

        logger = logging.getLogger("slideforge.llm")
        url = f"{self.base_url}/chat/completions"
        provider = getattr(inference_service, "current_provider", "unknown")
        if (
            getattr(inference_service, "is_provider_circuit_open", None)
            and inference_service.is_provider_circuit_open()
        ):
            raise RuntimeError(
                f"LLM provider circuit open for '{provider}'. Retry after cool-down."
            )
        transient_types = (
            httpx.TimeoutException,
            httpx.NetworkError,
            httpx.RemoteProtocolError,
        )
        attempts = 3
        for attempt in range(1, attempts + 1):
            try:
                response = await self._client.post(url, headers=headers, json=payload)
                if response.status_code >= 500 and attempt < attempts:
                    if getattr(inference_service, "note_provider_failure", None):
                        inference_service.note_provider_failure()
                    wait_seconds = min(8, 2 ** (attempt - 1))
                    logger.warning(
                        "LLM 5xx response, retrying attempt %s in %ss",
                        attempt,
                        wait_seconds,
                    )
                    await response.aclose()
                    await asyncio.sleep(wait_seconds)
                    continue
                if response.status_code == 200 and getattr(
                    inference_service, "note_provider_success", None
                ):
                    inference_service.note_provider_success()
                return response
            except transient_types as exc:
                if getattr(inference_service, "note_provider_failure", None):
                    inference_service.note_provider_failure()
                if attempt >= attempts:
                    raise RuntimeError(f"LLM request failed: {exc}")
                wait_seconds = min(8, 2 ** (attempt - 1))
                logger.warning(
                    "LLM transient error %s on attempt %s/%s, retrying in %ss",
                    exc.__class__.__name__,
                    attempt,
                    attempts,
                    wait_seconds,
                )
                await asyncio.sleep(wait_seconds)
            except Exception as exc:
                if getattr(inference_service, "note_provider_failure", None):
                    inference_service.note_provider_failure()
                raise RuntimeError(f"LLM request failed: {exc}")
        raise RuntimeError("LLM request failed after retries")

    async def generate(self, messages: list[Message], **kwargs) -> LLMResponse:
        import logging

        logger = logging.getLogger("slideforge.llm")

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        model_name = kwargs.get("model", self.model) or "local-model"
        max_tokens = kwargs.get("max_tokens", 4096)

        payload = {
            "model": model_name,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "temperature": kwargs.get("temperature", 0.7),
            "max_tokens": max_tokens,
            "stream": False,
        }

        context_window = kwargs.get("context_window")
        if context_window:
            if "11434" in self.base_url:
                payload["options"] = {"num_ctx": int(context_window)}
            elif "1234" in self.base_url:
                payload["extra_body"] = {"num_ctx": int(context_window)}

        logger.info(
            f"LLM request → {self.base_url} | model={model_name} | max_tokens={max_tokens}"
        )

        response = await self._post_chat(headers, payload)

        if response.status_code != 200:
            logger.error(f"LLM error {response.status_code}: {response.text[:200]}")
            raise RuntimeError(
                f"API error {response.status_code}: {response.text[:200]}"
            )

        try:
            data = response.json()
        except Exception as e:
            logger.error(f"JSON parse failed: {e}")
            raise RuntimeError(f"JSON parse failed: {e}")

        # --- Robust content extraction ---
        content = ""
        reasoning = ""
        if "choices" in data and len(data["choices"]) > 0:
            choice = data["choices"][0]
            if "message" in choice and isinstance(choice["message"], dict):
                msg = choice["message"]
                content = msg.get("content") or ""
                reasoning = msg.get("reasoning_content") or ""
                # If content is empty but reasoning exists, use reasoning as content
                if not content and reasoning:
                    content = reasoning
            elif "text" in choice:
                content = choice["text"]
            elif "delta" in choice and isinstance(choice["delta"], dict):
                delta = choice["delta"]
                content = delta.get("content") or delta.get("reasoning_content") or ""

        if not content:
            logger.warning(
                f"Empty LLM response. Keys: {list(data.get('choices', [{}])[0].keys()) if data.get('choices') else 'no choices'}"
            )

        finish_reason = (
            data["choices"][0].get("finish_reason", "stop")
            if data.get("choices")
            else "unknown"
        )
        logger.info(f"LLM response OK | len={len(content)} | finish={finish_reason}")

        return LLMResponse(
            content=content,
            usage=data.get("usage", {}),
            model=data.get("model", self.model),
            finish_reason=finish_reason,
        )

    async def stream(
        self, messages: list[Message], **kwargs
    ) -> AsyncGenerator[str, None]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        payload = {
            "model": kwargs.get("model", self.model),
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "temperature": kwargs.get("temperature", 0.7),
            "max_tokens": kwargs.get("max_tokens", 4096),
            "stream": True,
        }

        async with self._client.stream(
            "POST",
            f"{self.base_url}/chat/completions",
            headers=headers,
            json=payload,
        ) as response:
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    data = line[6:]
                    if data == "[DONE]":
                        break
                    chunk = json.loads(data)
                    content = (
                        chunk.get("choices", [{}])[0]
                        .get("delta", {})
                        .get("content", "")
                    )
                    if content:
                        yield content


class LLMFactory:
    @staticmethod
    def create(
        provider: InferenceProvider = InferenceProvider.MLX, **kwargs
    ) -> BaseLLM:
        if provider == InferenceProvider.MLX:
            return MLXLLM(**kwargs)
        elif provider == InferenceProvider.TRANSFORMERS:
            return TransformersLLM(**kwargs)
        elif provider == InferenceProvider.API:
            return APILLM(**kwargs)
        elif provider == InferenceProvider.OLLAMA:
            kwargs.setdefault("base_url", "http://localhost:11434/v1")
            kwargs.setdefault("api_key", "ollama")
            return APILLM(**kwargs)
        elif provider == InferenceProvider.LM_STUDIO:
            kwargs.setdefault("base_url", "http://localhost:1234/v1")
            kwargs.setdefault("api_key", "lm-studio")
            return APILLM(**kwargs)
        else:
            raise ValueError(f"Unknown provider: {provider}")

    @staticmethod
    def create_auto() -> BaseLLM:
        # Default to LM Studio if running (Local-First Priority)
        if os.getenv("USE_LM_STUDIO", "1") == "1":
            try:
                # Check for port 1234 (default LM Studio)
                import socket

                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(0.5)
                    if s.connect_ex(("localhost", 1234)) == 0:
                        print(
                            "LM Studio detected on port 1234, using it as primary LLM."
                        )
                        return LLMFactory.create(InferenceProvider.LM_STUDIO)
            except Exception:
                pass

        if os.getenv("USE_OFFLINE", "0") == "1":
            try:
                return LLMFactory.create(InferenceProvider.MLX)
            except Exception:
                pass

        if os.getenv("API_KEY") or os.getenv("OLLAMA_BASE_URL"):
            return LLMFactory.create(InferenceProvider.API)

        try:
            return LLMFactory.create(InferenceProvider.TRANSFORMERS)
        except Exception:
            raise RuntimeError(
                "No LLM provider available. Set USE_OFFLINE=1 for MLX, "
                "API_KEY for remote API, or install transformers."
            )


class InferenceService:
    def __init__(self, llm: Optional[BaseLLM] = None):
        self.analysis_max_tokens = int(os.getenv("ANALYSIS_MAX_TOKENS", "800"))
        self.local_context_window = int(os.getenv("LOCAL_CONTEXT_WINDOW", "8192"))
        self._provider_failures: dict[str, list[float]] = {}
        self._provider_circuit_open_until: dict[str, float] = {}
        self._circuit_failure_window_seconds = 60
        self._circuit_failure_threshold = 5
        self._circuit_open_seconds = 30
        self.provider_config = self._build_runtime_provider_config()
        self.current_provider = self.provider_config.provider.value
        if llm is not None:
            self.llm = llm
        else:
            try:
                self.reinitialize_provider()
            except RuntimeError as e:
                import logging

                logging.getLogger("slideforge.llm").warning(
                    f"No LLM provider auto-detected at startup: {e}. "
                    "Server will start, but LLM calls will fail until a provider is configured."
                )
                self.llm = None

    def _provider_key(self, provider: Optional[InferenceProvider] = None) -> str:
        if provider is not None:
            return provider.value
        return str(self.current_provider or "unknown")

    def is_provider_circuit_open(
        self, provider: Optional[InferenceProvider] = None
    ) -> bool:
        key = self._provider_key(provider)
        until = self._provider_circuit_open_until.get(key, 0)
        return until > time.time()

    def note_provider_failure(
        self, provider: Optional[InferenceProvider] = None
    ) -> None:
        key = self._provider_key(provider)
        now = time.time()
        failures = self._provider_failures.setdefault(key, [])
        failures.append(now)
        cutoff = now - self._circuit_failure_window_seconds
        self._provider_failures[key] = [ts for ts in failures if ts >= cutoff]
        if len(self._provider_failures[key]) >= self._circuit_failure_threshold:
            self._provider_circuit_open_until[key] = now + self._circuit_open_seconds

    def note_provider_success(
        self, provider: Optional[InferenceProvider] = None
    ) -> None:
        key = self._provider_key(provider)
        self._provider_failures[key] = []
        self._provider_circuit_open_until[key] = 0

    async def close(self) -> None:
        llm = getattr(self, "llm", None)
        if llm is not None and hasattr(llm, "aclose"):
            await llm.aclose()

    def get_provider_failure_stats(self) -> dict[str, dict[str, float | int]]:
        now = time.time()
        stats: dict[str, dict[str, float | int]] = {}
        providers = {
            InferenceProvider.API.value,
            InferenceProvider.OLLAMA.value,
            InferenceProvider.LM_STUDIO.value,
            InferenceProvider.MLX.value,
            InferenceProvider.TRANSFORMERS.value,
            self._provider_key(),
        }
        for key in providers:
            failures = self._provider_failures.get(key, [])
            until = self._provider_circuit_open_until.get(key, 0)
            stats[key] = {
                "recent_failures": len(
                    [
                        ts
                        for ts in failures
                        if now - ts <= self._circuit_failure_window_seconds
                    ]
                ),
                "circuit_open": until > now,
                "open_until_ts": until if until > now else 0,
            }
        return stats

    def _normalize_provider(self, value: Optional[str]) -> InferenceProvider:
        if value:
            try:
                return InferenceProvider(value)
            except ValueError:
                pass

        api_base = os.getenv("API_BASE_URL", "")
        api_key = os.getenv("API_KEY", "")
        if "localhost:1234" in api_base or api_key == "lm-studio":
            return InferenceProvider.LM_STUDIO
        if "localhost:11434" in api_base or api_key == "ollama":
            return InferenceProvider.OLLAMA
        return InferenceProvider.API

    def _build_runtime_provider_config(self) -> RuntimeProviderConfig:
        current_provider = self._normalize_provider(os.getenv("DEFAULT_LLM_PROVIDER"))
        return RuntimeProviderConfig(
            provider=current_provider,
            api=ProviderConnectionConfig(
                base_url=os.getenv("API_BASE_URL", "https://api.openai.com/v1"),
                api_key=os.getenv("API_KEY", ""),
                model=os.getenv("API_MODEL", "qwen2.5-7b-instruct"),
            ),
            ollama=ProviderConnectionConfig(
                base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1"),
                api_key=os.getenv("OLLAMA_API_KEY", "ollama"),
                model=os.getenv("OLLAMA_MODEL", "llama3.1:8b"),
            ),
            lm_studio=ProviderConnectionConfig(
                base_url=os.getenv("LM_STUDIO_BASE_URL", "http://localhost:1234/v1"),
                api_key=os.getenv("LM_STUDIO_API_KEY", "lm-studio"),
                model=os.getenv("LM_STUDIO_MODEL", "local-model"),
            ),
        )

    def get_provider_connection_config(
        self, provider: Optional[InferenceProvider] = None
    ) -> ProviderConnectionConfig:
        resolved_provider = provider or InferenceProvider(self.current_provider)
        if resolved_provider == InferenceProvider.API:
            return self.provider_config.api
        if resolved_provider == InferenceProvider.OLLAMA:
            return self.provider_config.ollama
        if resolved_provider == InferenceProvider.LM_STUDIO:
            return self.provider_config.lm_studio
        raise ValueError(
            f"Unsupported provider for runtime config: {resolved_provider}"
        )

    def provider_is_ready(self, provider: Optional[InferenceProvider] = None) -> bool:
        resolved_provider = provider or InferenceProvider(self.current_provider)
        if resolved_provider in (
            InferenceProvider.MLX,
            InferenceProvider.TRANSFORMERS,
        ):
            return True
        config = self.get_provider_connection_config(resolved_provider)
        if not config.base_url or not config.model:
            return False
        if resolved_provider == InferenceProvider.API:
            return bool(config.api_key)
        return True

    def update_runtime_provider_config(
        self,
        provider: Optional[InferenceProvider] = None,
        api: Optional[dict] = None,
        ollama: Optional[dict] = None,
        lm_studio: Optional[dict] = None,
        local_context_window: Optional[int] = None,
    ) -> RuntimeProviderConfig:
        if provider is not None:
            self.provider_config.provider = provider

        for field_name, updates in (
            ("api", api),
            ("ollama", ollama),
            ("lm_studio", lm_studio),
        ):
            if not updates:
                continue
            target = getattr(self.provider_config, field_name)
            for key, value in updates.items():
                if value is None or not hasattr(target, key):
                    continue
                setattr(target, key, value)

        if local_context_window is not None:
            self.set_local_context_window(local_context_window)

        self.current_provider = self.provider_config.provider.value
        return self.provider_config

    def apply_runtime_environment(self):
        os.environ["DEFAULT_LLM_PROVIDER"] = self.current_provider
        os.environ["LOCAL_CONTEXT_WINDOW"] = str(self.local_context_window)

        api_config = self.provider_config.api
        os.environ["API_BASE_URL"] = api_config.base_url
        os.environ["API_KEY"] = api_config.api_key
        os.environ["API_MODEL"] = api_config.model

        os.environ["OLLAMA_BASE_URL"] = self.provider_config.ollama.base_url
        os.environ["OLLAMA_API_KEY"] = self.provider_config.ollama.api_key
        os.environ["OLLAMA_MODEL"] = self.provider_config.ollama.model

        os.environ["LM_STUDIO_BASE_URL"] = self.provider_config.lm_studio.base_url
        os.environ["LM_STUDIO_API_KEY"] = self.provider_config.lm_studio.api_key
        os.environ["LM_STUDIO_MODEL"] = self.provider_config.lm_studio.model

    def reinitialize_provider(self):
        provider = InferenceProvider(self.current_provider)
        self.apply_runtime_environment()
        if not self.provider_is_ready(provider):
            self.llm = None
            return None

        llm_kwargs = {}
        if provider in (
            InferenceProvider.API,
            InferenceProvider.OLLAMA,
            InferenceProvider.LM_STUDIO,
        ):
            config = self.get_provider_connection_config(provider)
            llm_kwargs = {
                "base_url": config.base_url,
                "api_key": config.api_key,
                "model": config.model,
            }

        self.llm = LLMFactory.create(provider, **llm_kwargs)
        return self.llm

    def set_analysis_max_tokens(self, value: int):
        self.analysis_max_tokens = max(128, min(int(value), 8192))

    def set_local_context_window(self, value: int):
        self.local_context_window = max(1024, min(int(value), 131072))

    def optimize_memory(self):
        from .model_registry import model_registry

        model_registry.optimize_memory()

    async def analyze_with_council(
        self,
        slide_text: str,
        system_prompt: str,
    ) -> dict:
        if self.llm is None:
            return {
                "title": "Analysis",
                "summary": "LLM provider unavailable.",
                "overallScore": 50,
                "councilDebate": [],
            }
        messages = [
            Message(role="system", content=system_prompt),
            Message(role="user", content=f"Analyze this slide:\n\n{slide_text}"),
        ]

        response = await self.llm.generate(messages)

        try:
            result = parse_json_response(response.content)
            if not isinstance(result, dict) or (
                "overallScore" not in result and "summary" not in result
            ):
                raise ValueError("Invalid format")
            return result
        except Exception:
            return {
                "title": "Analysis",
                "summary": response.content[:200],
                "overallScore": 50,
                "councilDebate": [],
            }

    async def extract_claims(
        self,
        text: str,
        guardrail_rules: dict = None,
    ) -> list[dict]:
        if self.llm is None:
            return []
        prompt = f"""Extract all factual claims from this text that require source verification.
Return a JSON array of claims, each with 'claim' and 'confidence' fields.

Text: {text}
"""

        if guardrail_rules and guardrail_rules.get("citation_required_for"):
            prompt += f"\nRequired citations for: {', '.join(guardrail_rules['citation_required_for'])}"

        messages = [
            Message(
                role="system",
                content="You are a precise claim extraction agent. Extract factual claims that need verification. Return valid JSON array only.",
            ),
            Message(role="user", content=prompt),
        ]

        response = await self.llm.generate(messages)

        try:
            claims = parse_json_response(response.content)
            return claims if isinstance(claims, list) else []
        except Exception:
            return []

    async def check_entailment(
        self,
        claim: str,
        evidence: str,
    ) -> dict:
        if self.llm is None:
            return {
                "supported": False,
                "reasoning": "LLM provider unavailable",
                "confidence": 0.0,
            }
        messages = [
            Message(
                role="system",
                content="You are a logical entailment checker. Given a claim and evidence, determine if the evidence supports the claim. Return JSON with 'supported' (bool), 'reasoning' (str), and 'confidence' (float 0-1).",
            ),
            Message(
                role="user",
                content=f"Claim: {claim}\n\nEvidence: {evidence}\n\nDoes the evidence support the claim?",
            ),
        ]

        response = await self.llm.generate(messages)

        try:
            result = parse_json_response(response.content)
            if isinstance(result, dict):
                return result
            raise ValueError("Not a dictionary")
        except Exception:
            return {
                "supported": False,
                "reasoning": "Failed to parse LLM response format",
                "confidence": 0.0,
            }

    async def suggest_fix(
        self,
        issue: str,
        context: str,
    ) -> str:
        if self.llm is None:
            return ""
        messages = [
            Message(
                role="system",
                content="You are a consulting document editing assistant. Suggest specific text improvements for the given issue. Return only the suggested rewrite, no explanation.",
            ),
            Message(
                role="user",
                content=f"Issue: {issue}\n\nContext:\n{context}\n\nSuggest a fix:",
            ),
        ]

        response = await self.llm.generate(messages)
        return response.content.strip()

    async def generate_summary(
        self,
        scorecard: dict,
    ) -> str:
        if self.llm is None:
            return "LLM summary unavailable."
        messages = [
            Message(
                role="system",
                content="You are a consulting QA summarizer. Generate a brief executive summary of the QA results.",
            ),
            Message(
                role="user",
                content=f"Generate a summary for this scorecard:\n{json.dumps(scorecard)}",
            ),
        ]

        response = await self.llm.generate(messages)
        return response.content


inference_service = InferenceService()
