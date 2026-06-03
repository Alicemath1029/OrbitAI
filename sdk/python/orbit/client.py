import argparse
import atexit
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


DEFAULT_FLUSH_INTERVAL_SECONDS = 2.0
DEFAULT_FLUSH_BATCH_SIZE = 20


class OrbitClient:
    def __init__(
        self,
        flush_batch_size: int = DEFAULT_FLUSH_BATCH_SIZE,
        flush_interval_seconds: float = DEFAULT_FLUSH_INTERVAL_SECONDS,
    ) -> None:
        self.run_id = os.getenv("ORBIT_RUN_ID", "")
        self.token = os.getenv("ORBIT_RUN_TOKEN", "")
        self.api_base = os.getenv("ORBIT_API_BASE", "").rstrip("/")
        output_dir = os.getenv("ORBIT_OUTPUT_DIR") or os.getcwd()
        self.offline_path = Path(output_dir) / ".orbit" / "offline_metrics.jsonl"
        self.flush_batch_size = max(1, flush_batch_size)
        self.flush_interval_seconds = max(0.1, flush_interval_seconds)
        self._metrics: List[Dict[str, Any]] = []
        self._lock = threading.Lock()
        self._timer: Optional[threading.Timer] = None
        atexit.register(self.flush)

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
            "id": str(uuid.uuid4()),
            "name": name,
            "value": float(value),
            "step": int(step),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "context": context or {},
        }
        should_flush = False
        with self._lock:
            self._metrics.append(metric)
            should_flush = len(self._metrics) >= self.flush_batch_size
            if not should_flush:
                self._ensure_timer_locked()
        if should_flush:
            self.flush()

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
            "id": str(uuid.uuid4()),
            "name": name,
            "path": path,
            "type": type,
            "sizeBytes": size,
            "metadata": metadata or {},
        }
        self._post("artifacts", payload, offline_type="artifact")

    def finish(self, status: str = "succeeded") -> None:
        self.flush()
        self._post("finish", {"status": status}, offline_type="finish")

    def sync(self, jsonl_path: str) -> None:
        self.flush()
        for item in _read_jsonl(Path(jsonl_path)):
            kind = item.get("type")
            payload = item.get("payload")
            if not isinstance(kind, str) or not isinstance(payload, dict):
                continue
            record_id = item.get("id")
            if isinstance(record_id, str) and record_id:
                _attach_client_record_id(kind, payload, record_id)
            self._post(_offline_endpoint(kind), payload, offline_type=kind, write_offline=False)

    def flush(self) -> None:
        with self._lock:
            metrics = self._metrics
            self._metrics = []
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None
        if metrics:
            self._post("metrics", {"metrics": metrics}, offline_type="metrics")

    def _ensure_timer_locked(self) -> None:
        if self._timer is not None:
            return
        self._timer = threading.Timer(self.flush_interval_seconds, self.flush)
        self._timer.daemon = True
        self._timer.start()

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
                fp.write(json.dumps({"id": str(uuid.uuid4()), "type": kind, "payload": payload}) + "\n")
        except OSError as exc:
            print(f"[orbit] failed to write offline metrics: {exc}")


_client: Optional[OrbitClient] = None


def init(
    flush_batch_size: int = DEFAULT_FLUSH_BATCH_SIZE,
    flush_interval_seconds: float = DEFAULT_FLUSH_INTERVAL_SECONDS,
) -> OrbitClient:
    global _client
    _client = OrbitClient(flush_batch_size, flush_interval_seconds)
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


def flush() -> None:
    _get_client().flush()


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


def _offline_endpoint(kind: str) -> str:
    if kind == "artifact":
        return "artifacts"
    return kind


def _attach_client_record_id(kind: str, payload: Dict[str, Any], record_id: str) -> None:
    if kind == "metrics":
        metrics = payload.get("metrics")
        if isinstance(metrics, list):
            for index, metric in enumerate(metrics):
                if isinstance(metric, dict) and not metric.get("clientRecordID"):
                    metric["clientRecordID"] = f"{record_id}:{index}"
        return
    if not payload.get("clientRecordID"):
        payload["clientRecordID"] = record_id


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="orbit")
    subparsers = parser.add_subparsers(dest="command", required=True)
    sync_parser = subparsers.add_parser("sync", help="Upload offline JSONL records")
    sync_parser.add_argument("jsonl_path")
    args = parser.parse_args(argv)

    if args.command == "sync":
        sync(args.jsonl_path)
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
