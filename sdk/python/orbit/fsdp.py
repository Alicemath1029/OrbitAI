import json
from pathlib import Path
from typing import Any, Dict, Optional

from . import checkpoint as orbit_checkpoint


def save_checkpoint(
    model: Any,
    optimizer: Any = None,
    step: int = 0,
    filename: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    rank0_only: bool = False,
) -> Optional[str]:
    import torch

    target_dir = orbit_checkpoint.checkpoint_dir()
    target_dir.mkdir(parents=True, exist_ok=True)
    record_metadata = dict(metadata or {})
    record_metadata["framework"] = "fsdp"

    dcp = _distributed_checkpoint_module()
    if dcp is not None and not filename:
        target = target_dir / f"checkpoint-{int(step)}"
        target.mkdir(parents=True, exist_ok=True)
        state = {
            "model": model.state_dict(),
            "optimizer": optimizer.state_dict() if optimizer is not None else None,
            "metadata": {"step": int(step), **(metadata or {})},
        }
        dcp.save(state, checkpoint_id=str(target))
        record_metadata["format"] = "pytorch-dcp"
        record_metadata["checkpointSchemaVersion"] = "orbit.fsdp.checkpoint.v1"
        orbit_checkpoint.record(str(target), step=int(step), metadata=record_metadata, format="pytorch-dcp")
        return str(target)

    if rank0_only and not _is_rank0():
        return None
    target = target_dir / (filename or f"checkpoint-{int(step)}.pt")
    state = {
        "schema_version": "orbit.fsdp.checkpoint.v1",
        "model": model.state_dict(),
        "optimizer": optimizer.state_dict() if optimizer is not None else None,
        "step": int(step),
        "metadata": metadata or {},
    }
    tmp = target.with_name(target.name + ".tmp")
    torch.save(state, tmp)
    tmp.replace(target)
    record_metadata["format"] = "fsdp-state-dict"
    record_metadata["checkpointSchemaVersion"] = state["schema_version"]
    orbit_checkpoint.record(str(target), step=int(step), metadata=record_metadata, format="fsdp-state-dict")
    return str(target)


def load_checkpoint_if_available(model: Any, optimizer: Any = None, map_location: str = "cpu") -> Optional[Dict[str, Any]]:
    resume = orbit_checkpoint.resume_from()
    if not resume:
        return None
    target = Path(resume)
    if target.is_dir():
        manifest = _load_manifest(target)
        if manifest.get("format") == "pytorch-dcp":
            dcp = _distributed_checkpoint_module()
            if dcp is None:
                return None
            state: Dict[str, Any] = {
                "model": model.state_dict(),
                "metadata": {},
            }
            if optimizer is not None:
                state["optimizer"] = optimizer.state_dict()
            dcp.load(state, checkpoint_id=str(target))
            model.load_state_dict(state["model"])
            if optimizer is not None and state.get("optimizer") is not None:
                optimizer.load_state_dict(state["optimizer"])
            return state
        candidates = sorted(target.glob("*.pt")) + sorted(target.glob("*.pth"))
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
    return data


def _is_rank0() -> bool:
    import os

    for name in ("RANK", "LOCAL_RANK"):
        value = os.getenv(name)
        if value is None:
            continue
        try:
            return int(value) == 0
        except ValueError:
            return True
    return True


def _distributed_checkpoint_module() -> Any:
    try:
        import torch.distributed.checkpoint as dcp

        return dcp
    except Exception:
        return None


def _load_manifest(target: Path) -> Dict[str, Any]:
    manifest_path = target.with_name(target.name + ".orbit.json")
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    return data
