# Orbit 训练模板与 Checkpoint 恢复能力变更说明

本文记录本次围绕训练模板、checkpoint 扫描、latest 识别和一键恢复体验的改动。

## 背景

Orbit 需要把训练能力从“提交任意命令”推进到“平台提供规范训练入口和恢复体验”。本次改动的目标不是承诺任意训练代码都能零侵入自动续训，而是让平台为常见训练框架提供模板、目录约定、环境变量注入、latest checkpoint 识别和从历史 checkpoint 恢复的入口。

## 本次新增能力

### HF Trainer 强支持模板

在自定义训练作业创建页新增 Hugging Face Trainer 模板入口。选择模板后，前端会自动填充推荐命令和 checkpoint 配置。

模板命令包含：

```bash
--output_dir "$ORBIT_OUTPUT_DIR"
--save_strategy steps
--save_steps "$ORBIT_SAVE_STEPS"
--save_total_limit "$ORBIT_SAVE_TOTAL_LIMIT"
--resume_from_checkpoint "$ORBIT_RESUME_FROM"
```

适用边界：

- 用户训练脚本需要基于 `transformers.Trainer` 或兼容 `TrainingArguments` 参数。
- `output_dir` 和 checkpoint 目录必须位于持久化挂载路径中。
- 平台负责注入路径和参数，保存与加载仍由 HF Trainer 执行。

### PyTorch / torchrun 通用模板

在单机训练作业和 PyTorch DDP 作业创建页新增 PyTorch / torchrun 模板入口。

平台自动填充：

- `ORBIT_OUTPUT_DIR`
- `ORBIT_CHECKPOINT_DIR`
- `ORBIT_RESUME_FROM`
- `ORBIT_SAVE_STEPS`
- `ORBIT_SAVE_TOTAL_LIMIT`
- 推荐的 `torchrun` 命令结构

适用边界：

- 平台只负责目录、环境变量、资源、挂载和命令模板。
- 裸 PyTorch 脚本仍需要用户自行实现 `torch.save` / `torch.load`。
- 该模板是规范训练入口，不代表平台能自动恢复任意 PyTorch 代码内部状态。

### latest checkpoint 识别

后端 checkpoint scanner 增加对 `latest_checkpointed_iteration.txt` 的识别能力。

当 checkpoint 根目录中存在：

```text
latest_checkpointed_iteration.txt
```

并且其内容为某个 step，例如：

```text
8
```

平台会优先把匹配该 step 的 checkpoint 标记为 latest。也就是说，即使目录中同时存在：

```text
global_step0008/
global_step0010/
latest_checkpointed_iteration.txt
```

只要 tracker 指向 `8`，latest 就会被识别为 `global_step0008`，而不是简单选择 step 更大的 `global_step0010`。

扫描结果会在 checkpoint metadata 中记录：

```json
{
  "trackedLatest": true,
  "latestTracker": "latest_checkpointed_iteration.txt",
  "scanBackend": "scanner-service"
}
```

### 一键恢复体验

作业详情页新增 checkpoint 面板能力：

- 展示 checkpoint root。
- 展示 latest checkpoint。
- 展示 framework 和 resume mode。
- 展示恢复命令。
- 支持复制恢复命令。
- 支持从 latest 恢复。
- 支持从指定 checkpoint 恢复。

恢复作业创建后，平台会把恢复路径注入到新作业环境变量中：

```bash
ORBIT_RESUME_MODE=manual
ORBIT_RESUME_FROM=<checkpoint path>
ORBIT_LATEST_CHECKPOINT=<checkpoint path>
```

同时会更新恢复作业的 checkpoint annotations，使作业详情页和后续扫描能继续识别恢复来源。

### scanner 兼容旧 Crater 环境变量

本次验证中发现本地集群仍存在历史 Crater 风格的 scanner 环境变量。为了避免部署升级时因为环境变量前缀变化导致 scanner 找不到挂载根目录，当前代码兼容以下旧变量：

```bash
CRATER_CHECKPOINT_SCANNER_ROOT
CRATER_CHECKPOINT_SCANNER_PORT
CRATER_CHECKPOINT_SCANNER_CONCURRENCY
CRATER_CHECKPOINT_SCANNER_ENDPOINT
CRATER_CHECKPOINT_SCANNER_TIMEOUT_SECONDS
```

新的 Orbit 变量仍是优先路径：

```bash
ORBIT_CHECKPOINT_SCANNER_ROOT
ORBIT_CHECKPOINT_SCANNER_PORT
ORBIT_CHECKPOINT_SCANNER_CONCURRENCY
ORBIT_CHECKPOINT_SCANNER_ENDPOINT
ORBIT_CHECKPOINT_SCANNER_TIMEOUT_SECONDS
```

## 涉及文件

前端主要改动：

- `frontend/src/routes/portal/jobs/new/single-job.tsx`
- `frontend/src/routes/portal/jobs/new/pytorch-ddp-job.tsx`
- `frontend/src/components/job/detail/checkpoint-panel.tsx`
- `frontend/src/components/job/detail/index.tsx`
- `frontend/src/components/form/checkpoint-form-field.tsx`
- `frontend/src/routes/portal/jobs/new/tensorflow-ps-job.tsx`
- `frontend/src/services/api/vcjob.ts`

后端主要改动：

- `backend/internal/service/vcjob/checkpoint/scanner.go`
- `backend/internal/service/vcjob/checkpoint/scanner_service.go`
- `backend/internal/service/vcjob/checkpoint/scanner_client.go`
- `backend/internal/service/vcjob/checkpoint/checkpoint_test.go`
- `backend/internal/storage/file.go`
- `backend/cmd/checkpoint-scanner/main.go`

## 端到端验证结果

本次做了真实端到端验证，不只停留在单元测试。

验证链路：

1. 登录本地后端。
2. 创建真实训练作业。
3. 作业在真实 PVC 中写入 checkpoint。
4. scanner 读取同一块 PVC。
5. 后端扫描 checkpoint 并识别 latest。
6. 调用恢复接口创建真实恢复作业。
7. 在 Kubernetes 中确认恢复作业环境变量和 annotations。
8. 等待恢复作业完成。

验证作业：

- 源作业：`sg-admin-260602-ce4d5`
- 恢复作业：`sg-admin-260602-a63b4`

源作业写入的 checkpoint：

```text
/home/admin/checkpoints/e2e/exp-235231/global_step0008
/home/admin/checkpoints/e2e/exp-235231/global_step0010
/home/admin/checkpoints/e2e/exp-235231/latest_checkpointed_iteration.txt
```

`latest_checkpointed_iteration.txt` 内容为：

```text
8
```

扫描结果确认：

- `global_step0008` 被识别为 latest。
- `global_step0010` 没有被误识别为 latest。
- `global_step0008` metadata 包含 `trackedLatest=true`。

恢复接口返回：

```json
{
  "jobName": "sg-admin-260602-a63b4",
  "name": "e2e-checkpoint-restore",
  "checkpointPath": "/home/admin/checkpoints/e2e/exp-235231/global_step0008"
}
```

恢复作业环境变量确认：

```bash
ORBIT_RESUME_MODE=manual
ORBIT_RESUME_FROM=/home/admin/checkpoints/e2e/exp-235231/global_step0008
ORBIT_LATEST_CHECKPOINT=/home/admin/checkpoints/e2e/exp-235231/global_step0008
```

恢复作业状态：

```text
Completed
```

## 自动化验证

已执行并通过：

```bash
GOCACHE=$PWD/.cache/go-build go test ./cmd/checkpoint-scanner ./internal/service/vcjob/checkpoint ./internal/storage
npx pnpm@9.15.9 --dir frontend lint
npx pnpm@9.15.9 --dir frontend build
```

前端 build 中仍有既有的 Rollup chunk size 与依赖警告，不影响本次功能验证。

## 部署注意事项

正式部署时需要更新后端镜像和 checkpoint scanner 镜像。原因是 latest tracker 的读取逻辑位于 scanner 代码中，如果集群中的常驻 scanner 仍是旧镜像，它只能扫描 checkpoint 目录，无法返回 `latest_checkpointed_iteration.txt` 的 marker。

建议部署后检查：

```bash
kubectl logs -n <job-namespace> deploy/checkpoint-scanner
kubectl port-forward -n <job-namespace> svc/checkpoint-scanner-service 7330:7330
curl http://127.0.0.1:7330/healthz
```

如果是本地调试后端访问集群内 scanner，需要将后端配置中的 scanner endpoint 指向本地 port-forward 地址，例如：

```yaml
checkpointScanner:
  endpoint: http://127.0.0.1:7330
  timeoutSeconds: 30
```

生产部署中建议使用集群内 service 地址。

## 能力边界

- Orbit 不会在后端保存模型权重、优化器状态或训练状态。
- 自定义 PyTorch 代码无法零侵入自动续训，需要用户代码配合保存和加载。
- HF Trainer 模板依赖用户脚本兼容 HF Trainer 参数。
- `latest_checkpointed_iteration.txt` 是框架 tracker，平台只读取并据此排序，不改写框架内部 checkpoint 结构。
- 分布式训练 checkpoint 目录必须位于所有相关 Pod 可见的共享持久化存储中。

## 后续建议

后续可以继续补充：

- DeepSpeed / HF DeepSpeed 模板。
- verl 模板参数可视化。
- 作业详情页展示 tracker 文件内容和识别来源。
- 从 checkpoint 注册模型产物的流程。
- 对 FSDP、Megatron、DeepSpeed shard checkpoint 的展示优化。
