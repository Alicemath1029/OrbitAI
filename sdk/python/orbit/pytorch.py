import copy
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

from . import checkpoint as orbit_checkpoint

_threads = []


@dataclass
class LoadedCheckpoint:
    path: str
    step: int
    epoch: int
    metadata: Dict[str, Any]
    hparams: Dict[str, Any]


def load_checkpoint_if_available(
    model: Any,
    optimizer: Any = None,
    scheduler: Any = None,
    scaler: Any = None,
    map_location: str = "cpu",
) -> Optional[LoadedCheckpoint]:
    path = orbit_checkpoint.resume_from()
    if not path:
        return None
    target = Path(path)
    if target.is_dir():
        candidates = sorted(target.glob("*.pt")) + sorted(target.glob("*.pth")) + sorted(target.glob("*.ckpt"))
        if not candidates:
            return None
        target = candidates[-1]
    if not target.exists():
        return None
    import torch

    data = torch.load(target, map_location=map_location)
    model.load_state_dict(data["model"])
    if optimizer is not None and data.get("optimizer") is not None:
        optimizer.load_state_dict(data["optimizer"])
    if scheduler is not None and data.get("scheduler") is not None:
        scheduler.load_state_dict(data["scheduler"])
    if scaler is not None and data.get("scaler") is not None:
        scaler.load_state_dict(data["scaler"])
    return LoadedCheckpoint(
        path=str(target),
        step=int(data.get("step", 0)),
        epoch=int(data.get("epoch", 0)),
        metadata=dict(data.get("metadata") or {}),
        hparams=dict(data.get("hparams") or {}),
    )


def save_checkpoint(
    model: Any,
    optimizer: Any = None,
    scheduler: Any = None,
    scaler: Any = None,
    step: int = 0,
    epoch: int = 0,
    hparams: Optional[Dict[str, Any]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    async_save: bool = False,
    save_on_all_ranks: bool = False,
    filename: Optional[str] = None,
) -> Optional[str]:
    if not save_on_all_ranks and _rank() != 0:
        return None
    target_dir = orbit_checkpoint.checkpoint_dir()
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / (filename or f"checkpoint-{int(step)}.pt")
    state = _state_dict(model, optimizer, scheduler, scaler, step, epoch, hparams, metadata)
    if async_save:
        state = _cpu_snapshot(state)
    if async_save:
        thread = threading.Thread(target=_write_checkpoint, args=(target, state, int(step), metadata), daemon=False)
        thread.start()
        _threads.append(thread)
    else:
        _write_checkpoint(target, state, int(step), metadata)
    return str(target)


def flush() -> None:
    while _threads:
        thread = _threads.pop(0)
        thread.join()


def _state_dict(
    model: Any,
    optimizer: Any,
    scheduler: Any,
    scaler: Any,
    step: int,
    epoch: int,
    hparams: Optional[Dict[str, Any]],
    metadata: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    return {
        "schema_version": "orbit.pytorch.checkpoint.v1",
        "model": model.state_dict(),
        "optimizer": optimizer.state_dict() if optimizer is not None else None,
        "scheduler": scheduler.state_dict() if scheduler is not None else None,
        "scaler": scaler.state_dict() if scaler is not None else None,
        "step": int(step),
        "epoch": int(epoch),
        "hparams": hparams or {},
        "metadata": metadata or {},
    }


def _write_checkpoint(target: Path, state: Dict[str, Any], step: int, metadata: Optional[Dict[str, Any]]) -> None:
    import torch

    tmp = target.with_name(target.name + ".tmp")
    torch.save(state, tmp)
    tmp.replace(target)
    record_metadata = dict(metadata or {})
    record_metadata["framework"] = "pytorch"
    record_metadata["checkpointSchemaVersion"] = state.get("schema_version", "")
    orbit_checkpoint.record(str(target), step=step, metadata=record_metadata)


def _cpu_snapshot(value: Any) -> Any:
    try:
        import torch

        if isinstance(value, torch.Tensor):
            return value.detach().cpu().clone()
    except ImportError:
        pass
    if isinstance(value, dict):
        return {key: _cpu_snapshot(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_cpu_snapshot(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_cpu_snapshot(item) for item in value)
    if isinstance(value, set):
        return {_cpu_snapshot(item) for item in value}
    try:
        return copy.deepcopy(value)
    except Exception:
        return value


def _rank() -> int:
    for key in ("RANK", "LOCAL_RANK"):
        value = os.getenv(key)
        if value is None:
            continue
        try:
            return int(value)
        except ValueError:
            return 0
    return 0
