from typing import Any, Dict, Optional

from . import checkpoint as orbit_checkpoint


def save_checkpoint(
    checkpoint: Any,
    manager: Any = None,
    step: int = 0,
    metadata: Optional[Dict[str, Any]] = None,
) -> str:
    if manager is not None:
        path = manager.save(checkpoint_number=int(step))
    else:
        target_dir = orbit_checkpoint.checkpoint_dir()
        target_dir.mkdir(parents=True, exist_ok=True)
        path = checkpoint.save(str(target_dir / f"ckpt-{int(step)}"))
    record_metadata = dict(metadata or {})
    record_metadata["framework"] = "tensorflow"
    record_metadata["format"] = "tensorflow-checkpoint"
    record_metadata["checkpointSchemaVersion"] = "orbit.tensorflow.checkpoint.v1"
    orbit_checkpoint.record(str(path), step=int(step), metadata=record_metadata, format="tensorflow-checkpoint")
    return str(path)


def restore_if_available(checkpoint: Any, expect_partial: bool = True) -> Any:
    resume = orbit_checkpoint.resume_from()
    if not resume:
        return None
    status = checkpoint.restore(resume)
    return status.expect_partial() if expect_partial and hasattr(status, "expect_partial") else status
