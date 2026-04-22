import os
import sys
from datetime import datetime
from pathlib import Path


def run_preflight_checks(data_dir: str) -> dict:
    checks = []

    # 1. Check Offline Envs
    t_offline = os.environ.get("TRANSFORMERS_OFFLINE") == "1"
    h_offline = os.environ.get("HF_DATASETS_OFFLINE") == "1"
    if t_offline and h_offline:
        checks.append(
            {"name": "ENV_OFFLINE", "status": "OK", "message": "Offline mode enforced"}
        )
    else:
        checks.append(
            {
                "name": "ENV_OFFLINE",
                "status": "WARNING",
                "message": "Offline mode not enforced — Hugging Face may make network calls",
            }
        )

    # 2. Check Data Dir Writable
    try:
        data_path = Path(data_dir)
        data_path.mkdir(parents=True, exist_ok=True)
        test_file = data_path / ".preflight_check"
        test_file.write_text("ok")
        test_file.unlink()
        checks.append(
            {
                "name": "DATA_DIR_WRITABLE",
                "status": "OK",
                "message": "Data directory is writable",
            }
        )
    except Exception as e:
        checks.append(
            {
                "name": "DATA_DIR_WRITABLE",
                "status": "ERROR",
                "message": f"Data directory not writable: {e}",
            }
        )

    # 3. Check ChromaDB Dir
    chroma_path = Path(data_dir) / "chromadb"
    if chroma_path.exists():
        checks.append(
            {
                "name": "CHROMADB_DIR",
                "status": "OK",
                "message": "ChromaDB directory exists",
            }
        )
    else:
        checks.append(
            {
                "name": "CHROMADB_DIR",
                "status": "MISSING",
                "message": "ChromaDB directory not found (will be created on use)",
            }
        )

    # 4. Python Version
    if sys.version_info >= (3, 11):
        checks.append(
            {
                "name": "PYTHON_VERSION",
                "status": "OK",
                "message": f"Python version {sys.version.split()[0]} is compatible",
            }
        )
    else:
        checks.append(
            {
                "name": "PYTHON_VERSION",
                "status": "WARNING",
                "message": f"Python version {sys.version.split()[0]} is below 3.11",
            }
        )

    overall = "OK"
    if any(c["status"] == "ERROR" for c in checks):
        overall = "ERROR"
    elif any(c["status"] in ["WARNING", "MISSING"] for c in checks):
        overall = "WARNING"

    return {
        "timestamp": datetime.now().isoformat(),
        "checks": checks,
        "overall": overall,
    }
