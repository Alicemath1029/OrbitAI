from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from . import checkpoint as orbit_checkpoint


def save_checkpoint(
    engine: Any,
    step: int = 0,
    tag: Optional[str] = None,
    client_state: Optional[Dict[str, Any]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    save_dir: Optional[str] = None,
) -> Optional[str]:
    if not _is_rank0():
        return None
    target_dir = Path(save_dir) if save_dir else orbit_checkpoint.checkpoint_dir()
    target_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_tag = tag or f"global_step{int(step)}"
    engine.save_checkpoint(str(target_dir), tag=checkpoint_tag, client_state=client_state)
    checkpoint_path = target_dir / checkpoint_tag
    record_metadata = dict(metadata or {})
    record_metadata.update(
        {
            "framework": "deepspeed",
            "format": "zero-sharded",
            "checkpointSchemaVersion": "orbit.deepspeed.checkpoint.v1",
            "checkpointTag": checkpoint_tag,
        }
    )
    orbit_checkpoint.record(str(checkpoint_path), step=int(step), metadata=record_metadata, format="zero-sharded")
    return str(checkpoint_path)


def load_checkpoint_if_available(
    engine: Any,
    tag: Optional[str] = None,
    load_module_strict: bool = True,
    **kwargs: Any,
) -> Optional[Tuple[Any, Any]]:
    resume = orbit_checkpoint.resume_from()
    if not resume:
        return None
    load_dir, checkpoint_tag = _split_load_target(Path(resume), tag)
    return engine.load_checkpoint(
        str(load_dir),
        tag=checkpoint_tag,
        load_module_strict=load_module_strict,
        **kwargs,
    )


def _split_load_target(path: Path, tag: Optional[str]) -> Tuple[Path, Optional[str]]:
    if tag:
        return path, tag
    if path.name.startswith(("global_step", "checkpoint-")):
        return path.parent, path.name
    return path, None


def _is_rank0() -> bool:
    for name in ("RANK", "LOCAL_RANK"):
        value = __import__("os").getenv(name)
        if value is None:
            continue
        try:
            return int(value) == 0
        except ValueError:
            return True
    return True
