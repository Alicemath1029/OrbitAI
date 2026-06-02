import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, Iterable, Optional


class OrbitClient:
    def __init__(self) -> None:
        self.run_id = os.getenv("ORBIT_RUN_ID", "")
        self.token = os.getenv("ORBIT_RUN_TOKEN", "")
        self.api_base = os.getenv("ORBIT_API_BASE", "").rstrip("/")
        output_dir = os.getenv("ORBIT_OUTPUT_DIR") or os.getcwd()
        self.offline_path = Path(output_dir) / ".orbit" / "offline_metrics.jsonl"

    @property
    def enabled(self) -> bool:
        return bool(self.run_id and self.token and self.api_base)

    def log_param(self, name: str, value: Any) -> None:
        self.log_params({name: value})

    def log_params(self, params: Dict[str, Any]) -> None:
        self._post("params", {"params": params}, offline_type="params")

    def log_metric(
        self,
        name: str,
        value: float,
        step: int = 0,
        context: Optional[Dict[str, Any]] = None,
    ) -> None:
        metric = {
            "name": name,
            "value": float(value),
            "step": int(step),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "context": context or {},
        }
        self._post("metrics", {"metrics": [metric]}, offline_type="metrics")

    def log_artifact(
        self,
        name: str,
        path: str,
        type: str = "file",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        size = 0
        try:
            target = Path(path)
            if target.is_file():
                size = target.stat().st_size
        except OSError:
            size = 0
        payload = {
            "name": name,
            "path": path,
            "type": type,
            "sizeBytes": size,
            "metadata": metadata or {},
        }
        self._post("artifacts", payload, offline_type="artifact")

    def finish(self, status: str = "succeeded") -> None:
        self._post("finish", {"status": status}, offline_type="finish")

    def sync(self, jsonl_path: str) -> None:
        for item in _read_jsonl(Path(jsonl_path)):
            kind = item.get("type")
            payload = item.get("payload")
            if not isinstance(kind, str) or not isinstance(payload, dict):
                continue
            self._post(kind, payload, offline_type=kind, write_offline=False)

    def _post(
        self,
        endpoint: str,
        payload: Dict[str, Any],
        offline_type: str,
        write_offline: bool = True,
    ) -> None:
        if not self.enabled:
            if write_offline:
                self._write_offline(offline_type, payload)
            return
        url = f"{self.api_base}/experiments/runs/{self.run_id}/{endpoint}"
        data = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=data,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-Orbit-Run-Token": self.token,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=3):
                return
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            print(f"[orbit] failed to post {endpoint}: {exc}")
            if write_offline:
                self._write_offline(offline_type, payload)

    def _write_offline(self, kind: str, payload: Dict[str, Any]) -> None:
        try:
            self.offline_path.parent.mkdir(parents=True, exist_ok=True)
            with self.offline_path.open("a", encoding="utf-8") as fp:
                fp.write(json.dumps({"type": kind, "payload": payload}) + "\n")
        except OSError as exc:
            print(f"[orbit] failed to write offline metrics: {exc}")


_client: Optional[OrbitClient] = None


def init() -> OrbitClient:
    global _client
    _client = OrbitClient()
    return _client


def _get_client() -> OrbitClient:
    global _client
    if _client is None:
        _client = OrbitClient()
    return _client


def log_param(name: str, value: Any) -> None:
    _get_client().log_param(name, value)


def log_params(params: Dict[str, Any]) -> None:
    _get_client().log_params(params)


def log_metric(
    name: str,
    value: float,
    step: int = 0,
    context: Optional[Dict[str, Any]] = None,
) -> None:
    _get_client().log_metric(name, value, step, context)


def log_artifact(
    name: str,
    path: str,
    type: str = "file",
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    _get_client().log_artifact(name, path, type, metadata)


def finish(status: str = "succeeded") -> None:
    _get_client().finish(status)


def sync(jsonl_path: str) -> None:
    _get_client().sync(jsonl_path)


def _read_jsonl(path: Path) -> Iterable[Dict[str, Any]]:
    with path.open("r", encoding="utf-8") as fp:
        for line in fp:
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(item, dict):
                yield item
