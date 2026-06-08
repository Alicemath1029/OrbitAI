# Checkpoint 删除存储控制

Checkpoint 的物理文件删除由 `checkpoint-scanner` 服务执行，主 backend 只负责鉴权、业务状态更新和 RunArtifact 同步。

标准部署下 backend 不假设挂载共享 PVC。`DELETE /checkpoints/:id` 和 cleanup 会调用 scanner 的 `/delete` 控制接口，由 scanner 在受控根目录内删除 checkpoint 文件、对应的 `<checkpoint>.orbit.json` manifest，以及匹配的 `latest_checkpointed_iteration.txt` marker。删除成功后 backend 将 `job_checkpoints.status` 标记为 `deleted`，刷新 latest metadata，并清理对应 RunArtifact。

安全边界：

- scanner 只接受 storage root 下的相对路径，拒绝目录逃逸。
- scanner 的 PVC 默认以读写方式挂载，以支持删除和 cleanup。
- checkpoint 删除链路不提供 backend 本地存储 fallback。
- 如果 scanner endpoint 未配置或服务不可用，DELETE/cleanup 会直接失败，不会静默走错误的生产架构。

相关配置：

```yaml
checkpointScanner:
  endpoint: http://checkpoint-scanner-service.orbit-workspace.svc.cluster.local:7330
  timeoutSeconds: 30
  intervalSeconds: 0
  batchSize: 100
```

Helm values:

```yaml
checkpointScanner:
  enabled: true
  readOnly: false
```
