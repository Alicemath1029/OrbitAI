import pickle
from pathlib import Path
from typing import Any, Dict, Optional

from . import checkpoint as orbit_checkpoint


def save_checkpoint(
    state: Any,
    step: int = 0,
    metadata: Optional[Dict[str, Any]] = None,
    checkpointer: Any = None,
) -> str:
    target_dir = orbit_checkpoint.checkpoint_dir()
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"checkpoint-{int(step)}"
    if checkpointer is not None:
        checkpointer.save(str(target), state, force=True)
    else:
        with target.with_suffix(".pkl").open("wb") as fp:
            pickle.dump(state, fp)
        target = target.with_suffix(".pkl")
    record_metadata = dict(metadata or {})
    record_metadata["framework"] = "jax"
    orbit_checkpoint.record(str(target), step=int(step), metadata=record_metadata)
    return str(target)


def restore_if_available(checkpointer: Any = None) -> Any:
    resume = orbit_checkpoint.resume_from()
    if not resume:
        return None
    target = Path(resume)
    if checkpointer is not None:
        return checkpointer.restore(str(target))
    if target.is_dir():
        candidates = sorted(target.glob("*.pkl"))
        if not candidates:
            return None
        target = candidates[-1]
    with target.open("rb") as fp:
        return pickle.load(fp)
