import hashlib
import json
import os
import shutil
import threading
import time
import uuid
import atexit
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from .client import log_artifact

LATEST_MARKER = "latest_checkpointed_iteration.txt"
SUCCESS_MARKER = "_SUCCESS"
FILE_SUCCESS_SUFFIX = "._SUCCESS"
MANIFEST_SCHEMA_V2 = "orbit.checkpoint.manifest.v2"

_MANAGERS: List["Manager"] = []


def checkpoint_dir() -> Path:
    return Path(
        os.getenv("ORBIT_CHECKPOINT_STAGING_DIR")
        or os.getenv("ORBIT_CHECKPOINT_DIR")
        or os.getenv("ORBIT_OUTPUT_DIR")
        or os.getcwd()
    )


def resume_from() -> str:
    local_path = os.getenv("ORBIT_RESUME_LOCAL_PATH")
    if local_path and _checkpoint_path_ready(Path(local_path)):
        return local_path
    return os.getenv("ORBIT_RESUME_FROM") or os.getenv("ORBIT_LATEST_CHECKPOINT") or ""


class Manager:
    def __init__(self, staging_dir: Optional[str] = None, final_dir: Optional[str] = None) -> None:
        self.staging_dir = Path(staging_dir or os.getenv("ORBIT_CHECKPOINT_STAGING_DIR") or checkpoint_dir())
        self.final_dir = Path(final_dir or os.getenv("ORBIT_CHECKPOINT_FINAL_DIR") or os.getenv("ORBIT_CHECKPOINT_DIR") or self.staging_dir)
        self._threads: List[threading.Thread] = []
        self._errors: List[BaseException] = []
        self._lock = threading.Lock()
        _MANAGERS.append(self)

    def save(
        self,
        name: Optional[str] = None,
        step: int = 0,
        writer: Optional[Callable[[Path], None]] = None,
        source: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        framework: Optional[str] = None,
        format: Optional[str] = None,
    ) -> Dict[str, Any]:
        target = self._target_path(name, step)
        if target.exists():
            if target.is_dir():
                shutil.rmtree(target)
            else:
                target.unlink()

        if writer is not None:
            target.parent.mkdir(parents=True, exist_ok=True)
            writer(target)
        elif source is not None:
            self._copy_source(Path(source), target)
        else:
            target.mkdir(parents=True, exist_ok=True)

        record_metadata = dict(metadata or {})
        if framework:
            record_metadata["framework"] = framework
        return record(str(target), step=step, metadata=record_metadata, format=format, final_dir=str(self.final_dir))

    def save_async(self, *args: Any, **kwargs: Any) -> threading.Thread:
        def run() -> None:
            try:
                self.save(*args, **kwargs)
            except BaseException as exc:  # noqa: BLE001 - propagated by flush.
                with self._lock:
                    self._errors.append(exc)

        thread = threading.Thread(target=run, daemon=False)
        thread.start()
        self._threads.append(thread)
        return thread

    def flush(self) -> None:
        for thread in list(self._threads):
            thread.join()
        self._threads.clear()
        with self._lock:
            if self._errors:
                error = self._errors.pop(0)
                self._errors.clear()
                raise error

    def load_if_available(self) -> str:
        return resume_from()

    def _target_path(self, name: Optional[str], step: int) -> Path:
        checkpoint_name = name or f"checkpoint-{int(step)}"
        return self.staging_dir / checkpoint_name

    def _copy_source(self, source: Path, target: Path) -> None:
        if source.is_dir():
            shutil.copytree(source, target, dirs_exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)


def record(
    path: str,
    step: int = 0,
    metadata: Optional[Dict[str, Any]] = None,
    format: Optional[str] = None,
    final_dir: Optional[str] = None,
) -> Dict[str, Any]:
    target = Path(path)
    manifest_metadata = dict(metadata or {})
    checkpoint_format = format or manifest_metadata.get("format") or ("file" if target.is_file() else "directory")
    size = _size_bytes(target)
    created_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    final_path, storage_path = _final_paths(target, final_dir)
    staging_path = str(target)
    manifest = {
        "schemaVersion": MANIFEST_SCHEMA_V2,
        "checkpointID": manifest_metadata.get("checkpointID") or str(uuid.uuid4()),
        "jobName": os.getenv("ORBIT_JOB_NAME", ""),
        "runID": os.getenv("ORBIT_RUN_ID", ""),
        "framework": manifest_metadata.get("framework", "custom"),
        "format": checkpoint_format,
        "name": target.name,
        "path": final_path,
        "step": int(step),
        "status": "staged",
        "distributed": bool(manifest_metadata.get("distributed", False)),
        "worldSize": int(manifest_metadata.get("worldSize") or os.getenv("WORLD_SIZE") or 1),
        "storageBackend": os.getenv("ORBIT_CHECKPOINT_STORAGE_BACKEND", "pvc"),
        "storagePath": storage_path,
        "stagingPath": staging_path,
        "sizeBytes": size,
        "sha256": _sha256(target) if target.is_file() else "",
        "createdAt": created_at,
        "committedAt": "",
        "metadata": manifest_metadata,
    }
    manifest_path = target.with_name(target.name + ".orbit.json")
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    _write_success_marker(target)
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
    log_artifact(target.name, storage_path, type="checkpoint", metadata=artifact_metadata)
    return manifest


def flush() -> None:
    for manager in list(_MANAGERS):
        manager.flush()


def _write_latest_marker(directory: Path, step: int, name: str) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    marker = f"global_step_{int(step)}" if step >= 0 else name
    (directory / LATEST_MARKER).write_text(marker, encoding="utf-8")


def _write_success_marker(target: Path) -> None:
    if target.is_dir():
        marker = target / SUCCESS_MARKER
    else:
        marker = target.with_name(target.name + FILE_SUCCESS_SUFFIX)
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), encoding="utf-8")


def _final_paths(target: Path, final_dir: Optional[str] = None) -> Tuple[str, str]:
    configured_final_dir = final_dir or os.getenv("ORBIT_CHECKPOINT_FINAL_DIR")
    staging_dir = os.getenv("ORBIT_CHECKPOINT_STAGING_DIR")
    if not configured_final_dir:
        return str(target), _storage_path_from_prefix("", target.name, str(target))
    if not staging_dir and final_dir is None:
        return str(target), _storage_path_from_prefix("", target.name, str(target))
    if final_dir is None and not _is_under(target, Path(staging_dir)):
        return str(target), _storage_path_from_prefix("", target.name, str(target))

    final_root = Path(configured_final_dir)
    layout = (os.getenv("ORBIT_CHECKPOINT_FINAL_LAYOUT") or "flat").strip().lower()
    relative_parts = [target.name]
    if layout == "job":
        job_name = os.getenv("ORBIT_JOB_NAME", "").strip()
        if job_name:
            relative_parts = [job_name, target.name]
    final_path = final_root.joinpath(*relative_parts)
    return str(final_path), _storage_path_from_prefix(
        os.getenv("ORBIT_CHECKPOINT_STORAGE_PREFIX", ""),
        "/".join(relative_parts),
        str(final_path),
    )


def _storage_path_from_prefix(prefix: str, relative_path: str, fallback: str) -> str:
    prefix = prefix.strip().strip("/")
    relative_path = relative_path.strip().strip("/")
    if prefix:
        return f"{prefix}/{relative_path}" if relative_path else prefix
    return fallback


def _checkpoint_path_ready(path: Path) -> bool:
    if path.is_dir():
        return any(path.iterdir()) or (path / SUCCESS_MARKER).exists()
    return path.exists()


def _is_under(path: Path, root: Path) -> bool:
    try:
        path_resolved = path.resolve()
        root_resolved = root.resolve()
    except OSError:
        return False
    return path_resolved == root_resolved or root_resolved in path_resolved.parents


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


def _flush_at_exit() -> None:
    for manager in list(_MANAGERS):
        manager.flush()


atexit.register(_flush_at_exit)
