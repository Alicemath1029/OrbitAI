Orbit 实验中心第一阶段设计
功能背景
Orbit 目前已经具备训练平台的底座能力：用户可以提交 Jupyter、WebIDE、PyTorch、TensorFlow、Custom 等作业，平台能管理 GPU/CPU/内存资源、账户配额、镜像、数据集挂载、日志、监控、checkpoint 和作业生命周期。

但当前平台的核心视角仍然是 Job。Job 能回答：

谁提交了作业？
用了多少资源？
运行状态是什么？
日志是什么？
有没有 checkpoint？
它还不能很好回答训练平台用户更关心的问题：

这批训练属于哪个实验？
哪次 run 最好？
这次 loss/accuracy 曲线怎么样？
当时用了什么超参数？
代码 commit 是哪个？
用了哪些数据集和镜像？
最终模型/报告在哪里？
能不能基于这次重新跑？
因此需要在现有 Job 之上增加一层“实验语义”。这个功能不是替代 Kubernetes Job，也不是一开始做完整 MLflow，而是为 Orbit 补齐训练过程的记录、对比和复现能力。

企业级训练平台通常会把能力拆成三层：

控制面：创建实验、创建作业、权限、查询
采集面：接收 SDK 上报的 metric/param/artifact
文件发现：扫描 checkpoint/model/artifact 文件
第一阶段先不拆独立 collector，而是在 Orbit backend 内实现轻量采集 API，降低复杂度，同时把 API 和数据模型设计成未来可拆。

Summary
第一阶段目标是实现轻量实验中心：

Experiment 实验
└── ExperimentRun 一次训练
├── 绑定现有 Job
├── 记录超参/代码/数据/镜像快照
├── 接收 SDK 上报指标
├── 记录模型/报告/checkpoint 等产物元信息
└── 支持前端对比和复现入口
核心链路：

用户创建训练作业
-> 选择/新建 Experiment
-> backend 创建 ExperimentRun
-> backend 注入 ORBIT_RUN_ID / ORBIT_RUN_TOKEN
-> 训练代码通过 Python SDK 上报 metric/param/artifact
-> backend 写 Postgres
-> 前端展示 Run 对比、曲线、产物、复现信息
Key Changes
新增后端模型：

experiments
experiment_runs
run_metrics
run_artifacts
experiment_runs 绑定现有 Job：

experiment_runs.job_id   -> jobs.id，可空
experiment_runs.job_name -> jobs.job_name，用于异步回填
创建 Job 请求扩展 experiment 字段：

{
"experiment": {
"experimentId": 12,
"runName": "lr-1e-4-bs-32",
"hyperparams": {
"lr": 0.0001,
"batch_size": 32
},
"code": {
"repo": "https://github.com/team/project",
"commit": "abc123",
"branch": "main"
},
"tags": ["baseline", "sft"]
}
}
新增 backend API：

GET    /api/v1/experiments
POST   /api/v1/experiments
GET    /api/v1/experiments/:id
PUT    /api/v1/experiments/:id
GET    /api/v1/experiments/:id/runs

GET    /api/v1/experiments/runs/:runID
GET    /api/v1/experiments/runs/:runID/metrics
POST   /api/v1/experiments/runs/:runID/metrics
POST   /api/v1/experiments/runs/:runID/params
POST   /api/v1/experiments/runs/:runID/tags
GET    /api/v1/experiments/runs/:runID/artifacts
POST   /api/v1/experiments/runs/:runID/artifacts
新增 Python SDK：

import orbit

orbit.init()
orbit.log_param("lr", 1e-4)
orbit.log_metric("loss", loss, step=step)
orbit.log_artifact("final_model", "./outputs/model", type="model")
orbit.finish(status="succeeded")
平台自动注入：

ORBIT_RUN_ID
ORBIT_RUN_TOKEN
ORBIT_API_BASE
ORBIT_OUTPUT_DIR
Implementation
后端实现：

新增 dao/model/experiment.go，定义 Experiment、ExperimentRun、RunMetric、RunArtifact。
新增数据库迁移，并运行 GORM Gen 更新 query 代码。
新增 internal/service/experiment_service.go，负责实验、run、指标、产物、token 校验和状态同步。
新增 internal/handler/experiment.go，按现有 handler.Manager 模式注册路由。
扩展现有 CreateJobCommon，增加 Experiment *ExperimentRunConfig。
创建 Job 时，如果带 experiment，则先创建 run，再把 ORBIT_RUN_ID、ORBIT_RUN_TOKEN 注入训练容器。
Job reconciler 或 runtime 同步 Job DB 时，用 job_name 回填 experiment_runs.job_id，并同步 running/succeeded/failed 状态。
SDK 实现：

第一版只支持 Python。
metric 批量上报，默认每 20 条或 2 秒 flush。
API 失败不影响训练，只写 warning，并追加到 $ORBIT_OUTPUT_DIR/.orbit/offline_metrics.jsonl。
log_artifact 只记录路径和元数据，不上传大文件。
提供 orbit sync <jsonl> 用于离线补传。
前端实现：

新增 /portal/experiments 实验列表。
新增 /portal/experiments/$id 实验详情和 Run 表格。
新增 /portal/experiments/runs/$runID Run 详情。
训练作业创建页增加“实验信息”折叠区。
Run 详情页展示超参、代码快照、数据快照、镜像快照、metric 曲线、artifact、checkpoint、Job 详情入口和日志入口。
支持多 Run 勾选对比 metric 曲线和超参数差异。
MVP Boundary
第一阶段做：

实验 / Run / 指标 / 超参 / 标签 / 产物元信息 / Run 对比 / 复现入口
第一阶段不做：

独立 experiment-collector
Kafka/NATS/Redis Stream
ClickHouse/TimescaleDB
大文件上传
自动 HPO
复杂 Pipeline
完整模型注册中心
强数据集版本系统
Test Plan
后端模型迁移：新表、索引、JSON 字段、软删除。
ExperimentService：创建实验、创建 run、job_name 回填 job_id、状态同步。
Ingest API：run token 校验、metric batch upsert、param merge、artifact create。
Job 创建集成：带 experiment 时注入 env/annotation，不带 experiment 时行为保持不变。
SDK 单测：环境变量读取、批量 flush、失败落 JSONL、artifact metadata。
前端验证：实验列表、实验详情、Run 详情、metric 曲线空态/加载态/多 Run 对比。
回归测试：现有 Job 创建、checkpoint、日志、资源监控不受影响。
Assumptions
第一阶段只支持 Python SDK。
第一阶段 metrics 存 PostgreSQL。
第一阶段 artifact 只记录共享存储路径和元数据。
不接 SDK 的用户仍可使用实验中心，但只能看到 Job 元数据、日志、资源、checkpoint，无法看到训练曲线。
后续如果写入量上升，可把 ingest API 平滑迁移到独立 experiment-collector。