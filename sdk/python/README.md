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
