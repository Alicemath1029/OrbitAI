import json
import os
import sys
import tempfile
import types
import unittest
import urllib.request
from contextlib import redirect_stdout, redirect_stderr
from io import StringIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from orbit import checkpoint  # noqa: E402
from orbit import deepspeed as orbit_deepspeed  # noqa: E402
from orbit import export as orbit_export  # noqa: E402
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

    def test_deepspeed_non_rank0_saves_without_recording_manifest(self):
        class FakeEngine:
            def __init__(self):
                self.saved = []

            def save_checkpoint(self, save_dir, tag=None, client_state=None):
                self.saved.append((save_dir, tag, client_state))

        class FakeDistributed:
            def __init__(self):
                self.barriers = 0

            def is_available(self):
                return True

            def is_initialized(self):
                return True

            def barrier(self):
                self.barriers += 1

        with tempfile.TemporaryDirectory() as tmpdir:
            os.environ.clear()
            os.environ["RANK"] = "1"
            distributed = FakeDistributed()
            previous_torch = sys.modules.get("torch")
            previous_record = orbit_deepspeed.orbit_checkpoint.record
            records = []
            sys.modules["torch"] = types.SimpleNamespace(distributed=distributed)
            orbit_deepspeed.orbit_checkpoint.record = lambda *args, **kwargs: records.append((args, kwargs))
            try:
                engine = FakeEngine()
                saved_path = orbit_deepspeed.save_checkpoint(
                    engine,
                    step=5,
                    client_state={"step": 5},
                    save_dir=tmpdir,
                )
            finally:
                orbit_deepspeed.orbit_checkpoint.record = previous_record
                if previous_torch is None:
                    sys.modules.pop("torch", None)
                else:
                    sys.modules["torch"] = previous_torch

        self.assertEqual(len(engine.saved), 1)
        self.assertEqual(engine.saved[0][1], "global_step5")
        self.assertEqual(records, [])
        self.assertEqual(distributed.barriers, 2)
        self.assertTrue(str(saved_path).endswith("global_step5"))

    def test_deepspeed_rank0_records_manifest_after_save(self):
        class FakeEngine:
            def save_checkpoint(self, save_dir, tag=None, client_state=None):
                self.saved = (save_dir, tag, client_state)

        with tempfile.TemporaryDirectory() as tmpdir:
            os.environ.clear()
            os.environ["RANK"] = "0"
            previous_record = orbit_deepspeed.orbit_checkpoint.record
            records = []
            orbit_deepspeed.orbit_checkpoint.record = lambda *args, **kwargs: records.append((args, kwargs))
            try:
                engine = FakeEngine()
                orbit_deepspeed.save_checkpoint(engine, step=6, save_dir=tmpdir)
            finally:
                orbit_deepspeed.orbit_checkpoint.record = previous_record

        self.assertEqual(engine.saved[1], "global_step6")
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0][1]["format"], "zero-sharded")

    def test_export_cli_deepspeed_requires_zero_to_fp32(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            checkpoint_dir = Path(tmpdir) / "checkpoint"
            checkpoint_dir.mkdir()
            output_dir = Path(tmpdir) / "output"
            empty_path = Path(tmpdir) / "bin"
            empty_path.mkdir()
            os.environ["PATH"] = str(empty_path)
            stderr = StringIO()
            with redirect_stderr(stderr):
                code = orbit_export.main(
                    [
                        "--framework",
                        "deepspeed",
                        "--format",
                        "pytorch",
                        "--checkpoint",
                        str(checkpoint_dir),
                        "--output",
                        str(output_dir),
                    ]
                )

        self.assertEqual(code, 1)
        self.assertIn("zero_to_fp32.py is required", stderr.getvalue())

    def test_export_cli_basic_copy_writes_manifest_and_result(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            checkpoint_file = Path(tmpdir) / "checkpoint.pt"
            checkpoint_file.write_text("checkpoint", encoding="utf-8")
            output_dir = Path(tmpdir) / "output"
            stdout = StringIO()
            with redirect_stdout(stdout):
                code = orbit_export.main(
                    [
                        "--framework",
                        "pytorch",
                        "--format",
                        "huggingface",
                        "--checkpoint",
                        str(checkpoint_file),
                        "--output",
                        str(output_dir),
                    ]
                )

            manifest = json.loads((output_dir / "export_manifest.json").read_text(encoding="utf-8"))
            copied_exists = (output_dir / "checkpoint.pt").exists()

        self.assertEqual(code, 0)
        self.assertTrue(copied_exists)
        self.assertEqual(manifest["exportMode"], "basic-copy")
        self.assertEqual(manifest["framework"], "pytorch")
        self.assertEqual(manifest["format"], "huggingface")
        self.assertIn("[RESULT] size_bytes=", stdout.getvalue())


if __name__ == "__main__":
    unittest.main()
