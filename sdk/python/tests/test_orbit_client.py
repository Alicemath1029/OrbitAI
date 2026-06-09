import json
import os
import sys
import tempfile
import types
import unittest
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from orbit import checkpoint  # noqa: E402
from orbit import pytorch as orbit_torch  # noqa: E402
import orbit.client as client_module  # noqa: E402
from orbit.client import OrbitClient, main  # noqa: E402


class DummyResponse:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False


class OrbitClientTest(unittest.TestCase):
    def setUp(self):
        self._env = os.environ.copy()
        self._urlopen = urllib.request.urlopen
        self.posts = []
        client_module._client = None

        def fake_urlopen(request, timeout=0):
            self.posts.append(
                {
                    "url": request.full_url,
                    "token": request.headers.get("X-orbit-run-token"),
                    "payload": json.loads(request.data.decode("utf-8")),
                    "timeout": timeout,
                }
            )
            return DummyResponse()

        urllib.request.urlopen = fake_urlopen

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._env)
        urllib.request.urlopen = self._urlopen
        client_module._client = None

    def configure_env(self, output_dir):
        os.environ["ORBIT_RUN_ID"] = "7"
        os.environ["ORBIT_RUN_TOKEN"] = "token"
        os.environ["ORBIT_API_BASE"] = "http://orbit/api/v1"
        os.environ["ORBIT_OUTPUT_DIR"] = output_dir

    def test_metrics_flush_by_batch_size(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            self.configure_env(tmpdir)
            client = OrbitClient(flush_batch_size=2, flush_interval_seconds=30)
            client.log_metric("loss", 0.9, step=1)
            self.assertEqual(len(self.posts), 0)
            client.log_metric("loss", 0.8, step=2)

        self.assertEqual(len(self.posts), 1)
        self.assertEqual(self.posts[0]["url"], "http://orbit/api/v1/experiments/runs/7/metrics")
        self.assertEqual(len(self.posts[0]["payload"]["metrics"]), 2)

    def test_disabled_client_writes_offline_jsonl(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            os.environ.clear()
            os.environ["ORBIT_OUTPUT_DIR"] = tmpdir
            client = OrbitClient(flush_batch_size=2, flush_interval_seconds=30)
            client.log_metric("loss", 0.9, step=1)
            client.flush()
            offline_path = Path(tmpdir) / ".orbit" / "offline_metrics.jsonl"
            records = [json.loads(line) for line in offline_path.read_text().splitlines()]

        self.assertEqual(records[0]["type"], "metrics")
        self.assertTrue(records[0]["id"])
        self.assertEqual(records[0]["payload"]["metrics"][0]["name"], "loss")

    def test_sync_cli_uploads_jsonl_records(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            self.configure_env(tmpdir)
            jsonl = Path(tmpdir) / "offline.jsonl"
            jsonl.write_text(
                json.dumps({"id": "param-1", "type": "params", "payload": {"params": {"lr": 0.1}}})
                + "\n"
                + json.dumps(
                    {
                        "id": "artifact-1",
                        "type": "artifact",
                        "payload": {
                            "name": "model",
                            "path": "/outputs/model",
                            "type": "model",
                            "sizeBytes": 0,
                            "metadata": {},
                        },
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            self.assertEqual(main(["sync", str(jsonl)]), 0)

        self.assertEqual(len(self.posts), 2)
        self.assertEqual(self.posts[0]["url"], "http://orbit/api/v1/experiments/runs/7/params")
        self.assertEqual(self.posts[0]["payload"]["clientRecordID"], "param-1")
        self.assertEqual(
            self.posts[1]["url"], "http://orbit/api/v1/experiments/runs/7/artifacts"
        )
        self.assertEqual(self.posts[1]["payload"]["clientRecordID"], "artifact-1")

    def test_checkpoint_record_writes_manifest_and_latest_marker(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            os.environ.clear()
            os.environ["ORBIT_OUTPUT_DIR"] = tmpdir
            target = Path(tmpdir) / "checkpoint-3.pt"
            target.write_text("checkpoint", encoding="utf-8")
            manifest = checkpoint.record(str(target), step=3, metadata={"framework": "pytorch"})

            manifest_path = Path(str(target) + ".orbit.json")
            latest_path = Path(tmpdir) / "latest_checkpointed_iteration.txt"
            self.assertEqual(manifest["step"], 3)
            self.assertEqual(manifest["format"], "file")
            self.assertTrue(manifest_path.exists())
            persisted = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["format"], "file")
            self.assertEqual(latest_path.read_text(encoding="utf-8"), "global_step_3")

    def test_pytorch_async_snapshot_recursively_clones_tensors_to_cpu(self):
        class FakeTensor:
            def __init__(self, value, device="cuda"):
                self.value = value
                self.device = device

            def detach(self):
                return self

            def cpu(self):
                return FakeTensor(self.value, "cpu")

            def clone(self):
                return FakeTensor(self.value, self.device)

        previous_torch = sys.modules.get("torch")
        sys.modules["torch"] = types.SimpleNamespace(Tensor=FakeTensor)
        try:
            tensor = FakeTensor(1)
            snapshot = orbit_torch._cpu_snapshot({"model": {"weight": tensor}, "items": [tensor]})
            tensor.value = 2
        finally:
            if previous_torch is None:
                sys.modules.pop("torch", None)
            else:
                sys.modules["torch"] = previous_torch

        self.assertIsNot(snapshot["model"]["weight"], tensor)
        self.assertEqual(snapshot["model"]["weight"].device, "cpu")
        self.assertEqual(snapshot["model"]["weight"].value, 1)
        self.assertEqual(snapshot["items"][0].device, "cpu")


if __name__ == "__main__":
    unittest.main()
