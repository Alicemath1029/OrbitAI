import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any, Dict, Optional

from .client import log_artifact

LATEST_MARKER = "latest_checkpointed_iteration.txt"


def checkpoint_dir() -> Path:
    return Path(os.getenv("ORBIT_CHECKPOINT_DIR") or os.getenv("ORBIT_OUTPUT_DIR") or os.getcwd())


def resume_from() -> str:
    return os.getenv("ORBIT_RESUME_FROM") or os.getenv("ORBIT_LATEST_CHECKPOINT") or ""


def record(
    path: str,
    step: int = 0,
    metadata: Optional[Dict[str, Any]] = None,
    format: Optional[str] = None,
) -> Dict[str, Any]:
    target = Path(path)
    manifest_metadata = dict(metadata or {})
    checkpoint_format = format or manifest_metadata.get("format") or ("file" if target.is_file() else "directory")
    size = _size_bytes(target)
    manifest = {
        "schemaVersion": "orbit.checkpoint.manifest.v1",
        "framework": manifest_metadata.get("framework", "custom"),
        "format": checkpoint_format,
        "name": target.name,
        "path": str(target),
        "step": int(step),
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sizeBytes": size,
        "sha256": _sha256(target) if target.is_file() else "",
        "runID": os.getenv("ORBIT_RUN_ID", ""),
        "jobName": os.getenv("ORBIT_JOB_NAME", ""),
        "metadata": manifest_metadata,
    }
    manifest_path = target.with_name(target.name + ".orbit.json")
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    _write_latest_marker(target.parent, step, target.name)
    artifact_metadata = dict(manifest_metadata)
    artifact_metadata.update(
        {
            "step": int(step),
            "manifestPath": str(manifest_path),
            "framework": manifest["framework"],
            "format": checkpoint_format,
        }
    )
    log_artifact(target.name, str(target), type="checkpoint", metadata=artifact_metadata)
    return manifest


def flush() -> None:
    # Kept for API symmetry; pytorch.flush waits for async writers.
    return None


def _write_latest_marker(directory: Path, step: int, name: str) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    marker = f"global_step_{int(step)}" if step >= 0 else name
    (directory / LATEST_MARKER).write_text(marker, encoding="utf-8")


def _size_bytes(path: Path) -> int:
    try:
        if path.is_file():
            return path.stat().st_size
        total = 0
        for item in path.rglob("*"):
            if item.is_file():
                total += item.stat().st_size
        return total
    except OSError:
        return 0


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fp:
        for chunk in iter(lambda: fp.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
