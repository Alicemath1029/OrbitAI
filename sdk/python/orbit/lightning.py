from pathlib import Path
from typing import Any, Dict, Optional

from . import checkpoint as orbit_checkpoint


def save_checkpoint(
    trainer: Any,
    step: int = 0,
    filename: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    weights_only: bool = False,
) -> str:
    target_dir = orbit_checkpoint.checkpoint_dir()
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / (filename or f"checkpoint-{int(step)}.ckpt")
    trainer.save_checkpoint(str(target), weights_only=weights_only)
    record_metadata = dict(metadata or {})
    record_metadata["framework"] = "lightning"
    record_metadata["format"] = "lightning-ckpt"
    record_metadata["checkpointSchemaVersion"] = "orbit.lightning.checkpoint.v1"
    orbit_checkpoint.record(str(target), step=int(step), metadata=record_metadata, format="lightning-ckpt")
    return str(target)


def fit_kwargs(resume_from_checkpoint: Optional[str] = None) -> Dict[str, Any]:
    resume = resume_from_checkpoint if resume_from_checkpoint is not None else orbit_checkpoint.resume_from()
    return {"ckpt_path": resume} if resume else {}


def load_checkpoint_if_available(module_cls: Any, map_location: Optional[str] = None, **kwargs: Any) -> Any:
    resume = orbit_checkpoint.resume_from()
    if not resume:
        return None
    target = Path(resume)
    if target.is_dir():
        candidates = sorted(target.glob("*.ckpt"))
        if not candidates:
            return None
        target = candidates[-1]
    return module_cls.load_from_checkpoint(str(target), map_location=map_location, **kwargs)
