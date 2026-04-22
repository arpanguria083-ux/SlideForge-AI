import gc
import inspect
import logging
import os
import time
from pathlib import Path


logger = logging.getLogger("slideforge.models")


class ModelRegistry:
    _instance = None

    _surya_layout = None
    _surya_recognition = None
    _surya_detector = None
    _surya_foundation = None

    _surya_unavailable_until = 0.0
    _surya_last_error = None
    _surya_retry_backoff_seconds = int(os.environ.get("SURYA_RETRY_BACKOFF_SECONDS", "1800"))

    _device = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ModelRegistry, cls).__new__(cls)
            cls._device = None  # Lazy init
        return cls._instance

    @classmethod
    def get_device(cls):
        if cls._device is None:
            try:
                import torch

                cls._device = "cuda" if torch.cuda.is_available() else "cpu"
            except ImportError:
                cls._device = "cpu"
        return cls._device

    @classmethod
    def _ensure_surya_env(cls):
        """
        Force Surya temp/cache locations to project-local writable directories.
        This avoids repeated failed downloads caused by locked or restricted user temp paths.
        """
        backend_root = Path(__file__).resolve().parents[2]
        data_root = backend_root / "data"
        cache_dir = data_root / "surya_models"
        tmp_dir = data_root / "tmp"
        cache_dir.mkdir(parents=True, exist_ok=True)
        tmp_dir.mkdir(parents=True, exist_ok=True)

        os.environ.setdefault("MODEL_CACHE_DIR", str(cache_dir))
        os.environ.setdefault("TMPDIR", str(tmp_dir))
        os.environ.setdefault("TEMP", str(tmp_dir))
        os.environ.setdefault("TMP", str(tmp_dir))

    @classmethod
    def _surya_is_blocked(cls) -> bool:
        return time.time() < cls._surya_unavailable_until

    @classmethod
    def _mark_surya_unavailable(cls, exc: Exception):
        cls._surya_last_error = str(exc)
        cls._surya_unavailable_until = (
            time.time() + max(60, cls._surya_retry_backoff_seconds)
        )
        logger.warning(
            "Disabling Surya model init for %ss after error: %s",
            cls._surya_retry_backoff_seconds,
            cls._surya_last_error,
        )

    @classmethod
    def get_surya_foundation(cls):
        if cls._surya_foundation is not None:
            return cls._surya_foundation

        if cls._surya_is_blocked():
            logger.info("Surya foundation init currently in cooldown; skipping.")
            return None

        try:
            cls._ensure_surya_env()
            from surya.foundation import FoundationPredictor

            kwargs = {}
            signature = inspect.signature(FoundationPredictor.__init__)
            if "device" in signature.parameters:
                kwargs["device"] = cls.get_device()
            cls._surya_foundation = FoundationPredictor(**kwargs)
            return cls._surya_foundation
        except Exception as exc:
            cls._mark_surya_unavailable(exc)
            return None

    @classmethod
    def _build_surya_predictor(cls, predictor_cls):
        signature = inspect.signature(predictor_cls.__init__)
        if "foundation_predictor" in signature.parameters:
            foundation = cls.get_surya_foundation()
            if foundation is None:
                return None
            return predictor_cls(foundation)
        return predictor_cls()

    @classmethod
    def get_surya_layout(cls):
        """
        Returns a cached Surya LayoutPredictor.
        Supports both constructor variants:
        - LayoutPredictor()
        - LayoutPredictor(foundation_predictor=...)
        """
        if cls._surya_layout is not None:
            return cls._surya_layout

        if cls._surya_is_blocked():
            logger.info("Surya layout init currently in cooldown; skipping.")
            return None

        try:
            cls._ensure_surya_env()
            from surya.layout import LayoutPredictor

            cls._surya_layout = cls._build_surya_predictor(LayoutPredictor)
            return cls._surya_layout
        except Exception as exc:
            cls._mark_surya_unavailable(exc)
            return None

    @classmethod
    def get_surya_recognition(cls):
        """
        Returns a cached Surya RecognitionPredictor.
        Supports both constructor variants:
        - RecognitionPredictor()
        - RecognitionPredictor(foundation_predictor=...)
        """
        if cls._surya_recognition is not None:
            return cls._surya_recognition

        if cls._surya_is_blocked():
            logger.info("Surya recognition init currently in cooldown; skipping.")
            return None

        try:
            cls._ensure_surya_env()
            from surya.recognition import RecognitionPredictor

            cls._surya_recognition = cls._build_surya_predictor(RecognitionPredictor)
            return cls._surya_recognition
        except Exception as exc:
            cls._mark_surya_unavailable(exc)
            return None

    @classmethod
    def get_surya_detector(cls):
        if cls._surya_detector is not None:
            return cls._surya_detector

        if cls._surya_is_blocked():
            logger.info("Surya detector init currently in cooldown; skipping.")
            return None

        try:
            cls._ensure_surya_env()
            try:
                from surya.detection import DetectionPredictor as DetectorCls
            except Exception:
                from surya.detection import BatchDetector as DetectorCls

            cls._surya_detector = cls._build_surya_predictor(DetectorCls)
            return cls._surya_detector
        except Exception as exc:
            cls._mark_surya_unavailable(exc)
            return None

    @classmethod
    def release_surya(cls):
        """Offload Surya models to CPU or delete to free VRAM."""
        cls._surya_layout = None
        cls._surya_recognition = None
        cls._surya_detector = None
        cls._surya_foundation = None
        cls.optimize_memory()

    @classmethod
    def optimize_memory(cls):
        """Aggressive memory cleanup."""
        gc.collect()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                torch.cuda.synchronize()
        except ImportError:
            pass
        logger.info("Memory optimization complete. Device: %s", cls.get_device())


model_registry = ModelRegistry()
