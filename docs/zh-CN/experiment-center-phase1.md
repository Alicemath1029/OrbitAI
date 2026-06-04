# Orbit 实验中心第一阶段功能说明

## 背景

Orbit 已经具备作业提交、资源申请、数据和模型挂载、日志、监控、checkpoint 与作业生命周期管理能力。实验中心第一阶段在现有 Job 之上增加一层实验语义，用于回答训练平台用户更关心的问题：

- 这次训练属于哪个实验。
- 哪一次 Run 对应哪个 Job。
- 当时使用了哪些超参数、代码快照、镜像和资源配置。
- 训练过程指标和产物在哪里查看。
- 是否可以基于历史 Run 复现和对比。

第一阶段不是替代 Kubernetes Job，也不是完整 MLflow，而是在 Orbit backend 内实现轻量实验、Run 和指标采集能力，为后续独立 collector、模型注册和更复杂的实验治理留扩展口。

## 本次已实现范围

### 后端能力

新增实验中心数据模型：

- `experiments`：实验元信息。
- `experiment_runs`：一次训练 Run，绑定现有 Job。
- `run_metrics`：训练指标点。
- `run_artifacts`：模型、报告、checkpoint 等产物元信息。

新增实验中心 API：

- `GET /api/v1/experiments`
- `POST /api/v1/experiments`
- `GET /api/v1/experiments/:id`
- `PUT /api/v1/experiments/:id`
- `GET /api/v1/experiments/:id/runs`
- `GET /api/v1/experiments/runs/:runID`
- `GET /api/v1/experiments/runs/:runID/metrics`
- `GET /api/v1/experiments/runs/:runID/artifacts`

新增 Run token 公开上报 API：

- `POST /api/v1/experiments/runs/:runID/metrics`
- `POST /api/v1/experiments/runs/:runID/params`
- `POST /api/v1/experiments/runs/:runID/tags`
- `POST /api/v1/experiments/runs/:runID/artifacts`
- `POST /api/v1/experiments/runs/:runID/finish`

作业创建集成：

- `CreateJobCommon` 新增 `experiment` 配置。
- Jupyter、WebIDE、Custom、PyTorch、TensorFlow 作业创建时均支持绑定 Experiment。
- 创建作业时先创建 `ExperimentRun`，再把 Run 信息注入到训练容器。
- 作业提交失败时会把对应 Run 标记为 failed，并保留提交错误信息。
- Job reconciler 会按 `job_name` 回填 `job_id`，并同步 Run 状态、开始时间、结束时间和 checkpoint 快照。

容器注入环境变量：

```bash
ORBIT_RUN_ID=<run id>
ORBIT_RUN_TOKEN=<run token>
ORBIT_API_BASE=http://orbit-backend:8088/api/v1
```

Job 注解：

```bash
orbit.raids.io/experiment-id=<experiment id>
orbit.raids.io/experiment-run-id=<run id>
```

### 前端能力

新增页面：

- `/portal/experiments`：实验列表与新建实验。
- `/portal/experiments/$id`：实验详情、Run 表格、多 Run 指标对比。
- `/portal/experiments/runs/$runID`：Run 详情、指标曲线、超参数、代码/数据/镜像快照、产物、Job 入口。

作业创建页新增“实验信息”折叠区：

- 是否加入实验中心。
- 选择已有实验或新建实验。
- Run 名称。
- 超参数 JSON。
- 代码仓库、分支、Commit。
- Run 标签。

已接入页面：

- 单机/Custom 作业创建页。
- PyTorch DDP 作业创建页。
- TensorFlow PS 作业创建页。

### Python SDK

新增轻量 Python SDK，路径：

```text
sdk/python/orbit/
```

基础用法：

```python
import orbit

orbit.init()
orbit.log_param("lr", 1e-4)
orbit.log_metric("loss", 0.42, step=1)
orbit.log_artifact("final_model", "/tmp/model", type="model")
orbit.finish("succeeded")
```

SDK 行为：

- 默认从 `ORBIT_RUN_ID`、`ORBIT_RUN_TOKEN`、`ORBIT_API_BASE` 读取运行时配置。
- API 失败不会中断训练。
- 失败数据会写入 `$ORBIT_OUTPUT_DIR/.orbit/offline_metrics.jsonl`，后续可补传。
- `log_artifact` 只登记路径和元数据，不上传大文件。

## 本次增强设计

本次增强把第一阶段的 `Experiment Telemetry v1` 向“可恢复、可复现的实验中心”推进，重点补齐 checkpoint 归属、恢复链路、SDK 幂等和 Run 详情展示。

### 数据模型增强

`experiment_runs` 新增来源关系字段：

- `parent_run_id`：恢复或复制来源 Run。
- `source_checkpoint_id`：恢复来源 checkpoint。
- `reproduce_snapshot`：复现入口使用的来源信息、恢复模式和配置快照。

`run_metrics` 新增：

- `client_record_id`：SDK offline sync 幂等键。
- 唯一约束：`(run_id, client_record_id)`。

`run_artifacts` 新增：

- `client_record_id`：SDK offline sync 幂等键。
- `source_type`：来源类型，例如 `checkpoint`、`sdk`、`manual`。
- `source_id`：来源记录 ID，例如 `job_checkpoints.id`。

`job_checkpoints` 新增：

- `run_id`：checkpoint 归属的 ExperimentRun。

这些字段让平台可以回答：

- 这个 Run 产生了哪些 checkpoint。
- 这个 checkpoint 对应哪个 Run。
- 从 checkpoint 恢复后生成了哪个新 Run。
- SDK 离线补传是否会重复写入。

### Checkpoint 与 Experiment 打通

checkpoint scanner 扫描作业时，会从 Job record 的 annotations 中读取：

```text
orbit.raids.io/experiment-run-id
```

如果能读到 Run ID，新建或更新 `job_checkpoints` 时会写入 `run_id`。扫描完成后，后端会把 ready checkpoint 自动注册为 Run artifact：

```json
{
  "name": "checkpoint-10",
  "type": "checkpoint",
  "path": "/workspace/checkpoints/checkpoint-10",
  "sourceType": "checkpoint",
  "sourceID": 13,
  "metadata": {
    "framework": "pytorch",
    "step": 10,
    "latest": true,
    "storagePath": "users/alice/checkpoints/checkpoint-10",
    "jobName": "e2e-job-xxx"
  }
}
```

第一版没有新增 `GET /experiments/runs/:runID/checkpoints`。前端直接复用现有 artifact 查询接口，通过 `type=checkpoint` 展示 Checkpoints 区块。这保持了 API 面更小，也符合第一阶段“只登记路径和元数据”的边界。

### Checkpoint 恢复链路

从 checkpoint 恢复作业时，平台会重新构造恢复 Job，并处理实验上下文：

1. 清理历史模板中的旧 `ORBIT_RUN_*` 和 `ORBIT_API_BASE`。
2. 读取源 Job annotation 中的 `orbit.raids.io/experiment-id`。
3. 如果源 Job 绑定了实验，则创建新的 `ExperimentRun`。
4. 新 Run 写入：
   - `parentRunID`
   - `sourceCheckpointID`
   - `checkpointSnapshot`
   - `reproduceSnapshot`
   - `tags.restoredFromRunID`
   - `tags.restoredFromJobName`
   - `tags.restoredFromCheckpointID`
5. 为恢复 Job 写入新的 `orbit.raids.io/experiment-run-id`。
6. 向容器注入新的 `ORBIT_RUN_ID`、`ORBIT_RUN_TOKEN`、`ORBIT_API_BASE`。
7. 注入 checkpoint 恢复变量：

```bash
ORBIT_RESUME_MODE=manual
ORBIT_RESUME_FROM=<checkpoint path>
ORBIT_LATEST_CHECKPOINT=<checkpoint path>
```

如果源 Job 没有绑定实验，恢复 Job 不创建新 Run，但仍会清理旧 `ORBIT_RUN_*`，避免恢复任务继续向历史 Run 上报指标。

### 数据快照与镜像快照

作业创建页实验信息表单新增“数据快照 JSON”字段。前端会把该字段解析为 `experiment.data`，后端写入 `ExperimentRun.dataSnapshot`。

PyTorch / TensorFlow 分布式作业的 `imageSnapshot` 改为结构化对象：

```json
{
  "tasks": [
    {
      "name": "worker",
      "image": "python:3.11-slim"
    }
  ]
}
```

避免数组直接转换成 `JSONMap` 时变成空对象。

### 账户可见权限

Run 详情、metrics、artifacts 统一使用同一套访问规则：

- 平台管理员可访问。
- Run owner 可访问。
- 同 account 且实验 `visibility=account` 时可访问。
- 跨 account 不可访问。

这样避免“实验列表能看到，点 Run 详情 404”的不一致体验。

### SDK 幂等与安装

Python SDK 新增 `pyproject.toml`，可通过以下方式本地安装：

```bash
pip install -e sdk/python
```

SDK offline jsonl 每条记录会带 `id`。执行：

```bash
python -m orbit sync /path/to/offline_metrics.jsonl
```

时，SDK 会把记录 ID 转换为 `clientRecordID` 并提交给后端。后端基于 `(run_id, client_record_id)` 去重，因此同一份 offline jsonl 重放多次不会重复写入 metrics 或 artifacts。

### Checkpoint SDK

新增：

```text
sdk/python/orbit/checkpoint.py
sdk/python/orbit/pytorch.py
```

通用 checkpoint API：

```python
import orbit

orbit.init()
orbit.checkpoint.record(
    path="/workspace/checkpoints/checkpoint-1000.pt",
    step=1000,
    metadata={"framework": "custom"},
)
orbit.checkpoint.flush()
```

PyTorch helper：

```python
import orbit
import orbit.pytorch as orbit_torch

orbit.init()

loaded = orbit_torch.load_checkpoint_if_available(
    model=model,
    optimizer=optimizer,
    scheduler=scheduler,
    scaler=scaler,
)
start_step = loaded.step if loaded else 0

orbit_torch.save_checkpoint(
    model=model,
    optimizer=optimizer,
    scheduler=scheduler,
    scaler=scaler,
    step=step,
    epoch=epoch,
    hparams=hparams,
    async_save=True,
)

orbit_torch.flush()
orbit.finish("succeeded")
```

第一版能力边界：

- 默认只在 DDP rank 0 保存。
- 支持同步保存和基础后台线程异步保存。
- 写入 `.tmp` 后 rename，避免 scanner 扫到半成品。
- 生成 `<checkpoint>.orbit.json` manifest。
- 更新 `latest_checkpointed_iteration.txt`。
- 调用 `orbit.log_artifact(..., type="checkpoint")` 与实验中心打通。
- 不支持 TensorFlow/JAX/DeepSpeed/FSDP 分片保存。
- 不上传 checkpoint 文件，只登记路径和元数据。

## 请求示例

创建实验：

```bash
curl -X POST http://127.0.0.1:8088/api/v1/experiments \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "baseline-sft",
    "description": "SFT baseline",
    "visibility": "private",
    "tags": {"stage": "baseline"}
  }'
```

创建作业时绑定实验：

```json
{
  "name": "train-sft",
  "resource": {
    "cpu": "10m",
    "memory": "64Mi"
  },
  "image": {
    "imageLink": "python:3.11-slim",
    "archs": ["amd64", "arm64"]
  },
  "workingDir": "/tmp",
  "shell": "sh",
  "command": "python train.py",
  "experiment": {
    "experimentId": 2,
    "runName": "lr-1e-4-bs-1",
    "hyperparams": {
      "lr": 0.0001,
      "batch_size": 1
    },
    "code": {
      "commit": "abc123"
    },
    "tags": {
      "kind": "sft"
    }
  }
}
```

训练代码上报指标：

```bash
curl -X POST http://127.0.0.1:8088/api/v1/experiments/runs/1/metrics \
  -H "X-Orbit-Run-Token: <run-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "metrics": [
      {"name": "loss", "value": 0.42, "step": 1}
    ]
  }'
```

## 真实功能验证记录

本功能做过两轮真实端到端验证，不只是单元测试或接口 mock。

### 第一阶段基础链路验证

验证环境：

- Orbit backend：`http://127.0.0.1:8088`
- Kubernetes namespace：`crater-workspace`
- 测试镜像：`python:3.11-slim`

验证步骤与结果：

1. 创建真实实验

   - 实验名称：`experiment-e2e-real-1900`
   - Experiment ID：`2`
   - API 返回：`code=0`

2. 提交真实 Custom/VolcanoJob

   - Job 名称：`sg-admin-260602-3bd6f`
   - Run ID：`1`
   - Experiment ID：`2`
   - API 返回：`code=0`
   - Kubernetes Job 状态：`Completed`
   - Pod 状态：`Completed`

3. 验证容器环境变量注入

   Pod 日志确认容器内实际存在：

   ```text
   ORBIT_RUN_ID=1
   ORBIT_RUN_TOKEN=<redacted>
   ORBIT_EXPERIMENT_E2E_OK
   ```

4. 验证 Run 状态同步

   Run 查询结果：

   - `runName=real-job-e2e`
   - `jobName=sg-admin-260602-3bd6f`
   - `status=succeeded`
   - `jobID=4`
   - `hyperparams.lr=0.0001`
   - `hyperparams.batch_size=1`

5. 验证公开上报接口

   使用真实 `ORBIT_RUN_TOKEN` 上报：

   - metrics：`loss=0.42`、`accuracy=0.98`
   - params：`epochs=1`
   - artifact：`final_model /tmp/model`

   API 返回：

   - metrics accepted：`2`
   - params accepted：`1`
   - artifact created：`final_model`

6. 验证前端查询数据源

   鉴权查询接口已读回：

   - Run detail：`status=succeeded`
   - metrics：`loss`、`accuracy`
   - artifacts：`final_model`

### 本次增强链路验证

验证日期：2026-06-03。

验证环境：

- Orbit backend：当前工作区代码临时启动到 `http://127.0.0.1:18089`
- 本地 checkpoint scanner：`http://127.0.0.1:17330`
- 临时存储根目录：`/private/tmp/orbit-e2e-storage`
- 本地 Postgres：`orbit`

验证链路：

1. HTTP 注册临时用户。
2. HTTP 创建 `visibility=account` 的 Experiment。
3. 写入真实 `ExperimentRun` 和 `Job` 测试记录。
4. 使用真实 Python SDK 通过 HTTP 上报：
   - metrics
   - params
   - artifacts
   - finish
5. 使用 `python -m orbit sync` 重放同一份 offline jsonl 两次。
6. 本地 checkpoint scanner 扫描 checkpoint 文件。
7. 后端把 `JobCheckpoint` 注册成 `RunArtifact(type=checkpoint)`。
8. HTTP 查询 Run、metrics、artifacts、experiment runs。
9. 另一个同账户用户访问 account 可见 Run，验证权限一致。

最终断言结果：

```json
{
  "metrics_count": 3,
  "artifacts_count": 3,
  "checkpoint_artifact": {
    "name": "checkpoint-10",
    "sourceType": "checkpoint",
    "sourceID": 13,
    "step": 10
  },
  "scan_total": 1,
  "run_status": "succeeded",
  "data_snapshot": {
    "digest": "sha256:20260603083107",
    "name": "dataset-e2e"
  },
  "image_snapshot": {
    "tasks": [
      {
        "image": "python:3.11-slim",
        "name": "worker"
      }
    ]
  }
}
```

权限验证结果：

```text
account-visible peer access ok
```

说明：

- offline jsonl 重放两次后，`offline_loss` 只写入一次。
- offline artifact 重放两次后，`offline-model` 只写入一次。
- checkpoint artifact 的 `sourceType=checkpoint`，`sourceID` 指向 `job_checkpoints.id`。
- 测试临时服务端口 `18089` 和 `17330` 已停止，原本已有的 `8088` 服务未修改。

## 测试覆盖

已执行：

```bash
go test ./internal/handler ./internal/handler/vcjob ./internal/service ./pkg/reconciler
npm run lint
python3 -m unittest discover -s sdk/python/tests
python3 -m py_compile sdk/python/orbit/client.py sdk/python/orbit/checkpoint.py sdk/python/orbit/pytorch.py sdk/python/orbit/__init__.py sdk/python/orbit/__main__.py
git diff --check
```

新增服务层测试覆盖：

- 创建实验。
- 创建 Run。
- Run token 校验。
- metric 写入。
- param 合并。
- artifact 创建。
- Run finish。
- Run / metrics / artifacts 查询。

## 当前边界

第一阶段已完成轻量实验中心核心链路，但仍有边界：

- 第一阶段 metrics 存 PostgreSQL，适合轻量采集，不适合超高频指标写入。
- artifact 只记录共享存储路径和元数据，不上传大文件。
- Python SDK 已补 `pyproject.toml`，但尚未发布到 pip 仓库。
- 不接 SDK 的训练脚本仍可看到 Job、Run、资源、checkpoint 等元数据，但不会有训练曲线。
- `GET /experiments/runs/:runID/checkpoints` 暂未新增，第一版通过 `artifacts type=checkpoint` 展示。
- `POST /experiments/runs/:runID/reproduce` 暂未实现，当前只提供复制复现信息和从 checkpoint 恢复入口。
- PyTorch checkpoint helper 是基础版，尚未覆盖 DeepSpeed、FSDP、Megatron、TensorFlow、JAX。
- 独立 collector、消息队列、ClickHouse/TimescaleDB、HPO、完整模型注册中心属于后续阶段。

## 后续建议

- 将 Python SDK 发布到内部或公开 pip 仓库，并加入训练镜像模板。
- 在 Run 详情页增加“复现此 Run”入口，复用镜像、命令、资源、挂载和实验配置。
- 增加 `POST /api/v1/experiments/runs/:runID/reproduce`，统一复制配置和 checkpoint 恢复入口。
- 如 checkpoint 查询需求扩大，可新增只读接口 `GET /api/v1/experiments/runs/:runID/checkpoints`。
- 对高频 metrics 写入引入批量压缩或独立 collector。
- 区分训练恢复 checkpoint 和可发布模型 artifact。
- 为实验权限、共享、归档和清理策略补充管理能力。
