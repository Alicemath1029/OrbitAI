# Orbit Python SDK

Lightweight training telemetry SDK for Orbit Experiment Center.

```python
import orbit

orbit.init()
orbit.log_param("lr", 1e-4)
orbit.log_metric("loss", loss, step=step)
orbit.log_artifact("final_model", "./outputs/model", type="model")
orbit.finish(status="succeeded")
```

Install locally during image build or development:

```bash
pip install -e sdk/python
```

Metrics are buffered and flushed every 20 records or 2 seconds by default.
You can force a flush before process exit:

```python
orbit.flush()
```

The platform injects these variables when a job is bound to an experiment:

- `ORBIT_RUN_ID`
- `ORBIT_RUN_TOKEN`
- `ORBIT_API_BASE`
- `ORBIT_OUTPUT_DIR`

If the API is unavailable, records are appended to
`$ORBIT_OUTPUT_DIR/.orbit/offline_metrics.jsonl`.

```python
import orbit

orbit.sync("/path/to/offline_metrics.jsonl")
```

The same sync operation is available from the command line:

```bash
python -m orbit sync /path/to/offline_metrics.jsonl
```

Checkpoint exporter CLI used by Orbit export jobs:

```bash
python -m orbit.export \
  --framework deepspeed \
  --format pytorch \
  --checkpoint "$CHECKPOINT_DIR" \
  --output "$OUT_DIR"
```

DeepSpeed export requires `zero_to_fp32.py` in the exporter image. Other
frameworks currently use `basic-copy` mode and record that in
`export_manifest.json`.

PyTorch checkpoint helper:

```python
import orbit
import orbit.pytorch as orbit_torch

orbit.init()

loaded = orbit_torch.load_checkpoint_if_available(model, optimizer=optimizer)
start_step = loaded.step if loaded else 0

orbit_torch.save_checkpoint(
    model=model,
    optimizer=optimizer,
    step=step,
    epoch=epoch,
    hparams={"lr": 1e-4},
    async_save=True,
)

orbit_torch.flush()
orbit.finish("succeeded")
```
