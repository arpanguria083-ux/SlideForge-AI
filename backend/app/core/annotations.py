import hashlib
import json


def build_annotation_id(annotation: dict) -> str:
    slide_index = annotation.get("slide_index", 0)
    payload = {
        "message": annotation.get("message") or "",
        "text": annotation.get("text") or "",
        "category": annotation.get("category") or "",
        "severity": annotation.get("severity") or "",
        "shape_id": annotation.get("shape_id") or "",
        "run_start": annotation.get("run_start"),
        "run_end": annotation.get("run_end"),
    }
    digest = hashlib.sha1(
        json.dumps(payload, sort_keys=True).encode("utf-8", errors="ignore")
    ).hexdigest()[:12]
    return f"{slide_index}:{digest}"
