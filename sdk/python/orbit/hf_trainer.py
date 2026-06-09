import os
from pathlib import Path
from typing import Any, Dict, Optional

from . import checkpoint as orbit_checkpoint


def training_args_kwargs(output_dir: Optional[str] = None) -> Dict[str, Any]:
    kwargs: Dict[str, Any] = {
        "output_dir": output_dir or str(orbit_checkpoint.checkpoint_dir()),
    }
    save_steps = _int_env("ORBIT_SAVE_STEPS")
    save_total_limit = _int_env("ORBIT_SAVE_TOTAL_LIMIT")
    if save_steps is not None:
        kwargs["save_steps"] = save_steps
    if save_total_limit is not None:
        kwargs["save_total_limit"] = save_total_limit
    return kwargs


def train(trainer: Any, resume_from_checkpoint: Optional[str] = None, **kwargs: Any) -> Any:
    resume = resume_from_checkpoint if resume_from_checkpoint is not None else orbit_checkpoint.resume_from()
    if resume:
        kwargs["resume_from_checkpoint"] = resume
    return trainer.train(**kwargs)


def record_latest_checkpoint(
    trainer: Any,
    step: Optional[int] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    checkpoint_path = latest_checkpoint_path(getattr(trainer, "args", None))
    if not checkpoint_path:
        return None
    current_step = step
    if current_step is None:
        state = getattr(trainer, "state", None)
        current_step = int(getattr(state, "global_step", 0) or 0)
    record_metadata = dict(metadata or {})
    record_metadata["framework"] = "hf-trainer"
    record_metadata["format"] = "huggingface-trainer"
    record_metadata["checkpointSchemaVersion"] = "orbit.hf-trainer.checkpoint.v1"
    return orbit_checkpoint.record(
        str(checkpoint_path),
        step=int(current_step or 0),
        metadata=record_metadata,
        format="huggingface-trainer",
    )


def latest_checkpoint_path(training_args: Any = None) -> Optional[Path]:
    output_dir = getattr(training_args, "output_dir", None) or str(orbit_checkpoint.checkpoint_dir())
    try:
        from transformers.trainer_utils import get_last_checkpoint

        latest = get_last_checkpoint(output_dir)
        return Path(latest) if latest else None
    except ImportError:
        checkpoints = sorted(Path(output_dir).glob("checkpoint-*"))
        return checkpoints[-1] if checkpoints else None


def _int_env(name: str) -> Optional[int]:
    value = os.getenv(name)
    if value is None or value == "":
        return None
    try:
        return int(value)
    except ValueError:
        return None
