# Orbit 后端代码梳理

本文档面向需要接手或改造 Orbit 后端的开发者，按“进程、启动链路、路由、业务模块、数据层、控制器、部署”的顺序梳理代码。它不是接口使用手册，而是一份代码地图，用来快速判断某个功能应该从哪里读起、改动会影响哪些组件。

## 一、后端范围

后端代码主要位于 `backend/`，这是一个独立 Go module：

- `cmd/orbit/`：主后端进程，包含 Gin API Server 和 controller-runtime Manager。
- `cmd/storage-server/`：独立文件服务进程，提供 WebDAV 与文件/数据集访问接口。
- `cmd/checkpoint-scanner/`：独立 checkpoint 扫描进程，读取共享存储并返回 checkpoint manifest。
- `cmd/gorm-gen/`：数据库迁移和 GORM Gen 代码生成工具。
- `internal/`：业务 HTTP handler、service、middleware、storage 实现。
- `pkg/`：可复用基础能力，包括 Kubernetes controller、CR client、监控、镜像构建、定时任务、清理策略、预排队 watcher 等。
- `dao/model/`：GORM 模型定义。
- `dao/query/`：GORM Gen 生成的类型安全查询代码。
- `etc/example-config.yaml`：后端配置样例。
- `deployments/`：后端依赖组件的安装配置，例如 Volcano、Prometheus、GPU Operator、OpenEBS 等。

仓库层面的部署资产在 `charts/orbit/` 和 `docker-compose.yml`。Helm 是生产/集群部署主路径，Compose 是本地联调路径。

## 二、运行进程

后端实际由多个进程协作：

| 进程 | 入口 | 主要职责 | 默认端口 |
| --- | --- | --- | --- |
| 主后端 | `backend/cmd/orbit/main.go` | API、鉴权、业务编排、Kubernetes controller、定时任务 | `8088` |
| Storage Server | `backend/cmd/storage-server/main.go` | WebDAV、文件浏览、上传下载、数据集文件访问 | `7320` |
| Checkpoint Scanner | `backend/cmd/checkpoint-scanner/main.go` | 扫描共享存储中的 checkpoint 文件 | `7330` |
| DB Migrator | `backend/cmd/gorm-gen/models/migrate.go` | 数据库建表、迁移、初始化默认数据 | 无常驻端口 |

主后端并不是纯 API 服务。它启动后也会创建 controller-runtime manager，监听 Kubernetes 资源变化，并将作业、镜像构建、模型下载等状态同步回数据库。

## 三、主后端启动链路

主入口是 `backend/cmd/orbit/main.go`。启动顺序可以按下面理解：

1. 注入版本信息  
   `AppVersion`、`CommitSHA`、`BuildType`、`BuildTime` 通过 Makefile 或镜像构建时的 ldflags 注入；没有注入时使用本地默认值。

2. 加载配置  
   `helper.NewConfigInitializer()` 内部调用 `config.GetConfig()`。配置加载逻辑在 `backend/pkg/config/config.go`：
   - Gin debug 模式：优先读 `ORBIT_DEBUG_CONFIG_PATH`，否则读 `./etc/debug-config.yaml`。
   - release 模式：读 `/etc/config/config.yaml`。
   - 配置读取后会执行 `ValidateConfig()`，缺少关键项会直接退出。

3. 加载调试环境变量  
   debug 模式下读取 `.debug.env`，主要用于覆盖 `ORBIT_BE_PORT`。

4. 初始化 Kubernetes 与数据库依赖  
   `InitializeRegisterConfig()` 会：
   - 通过 `ctrl.GetConfigOrDie()` 读取 kubeconfig。
   - 创建 Kubernetes clientset。
   - 初始化 GORM DB，并设置 `query.SetDefault(query.GetDB())`。
   - 创建 Prometheus client。

5. 创建 controller-runtime manager  
   `ManagerSetup.CreateCRDManager()` 注册 Kubernetes 基础 scheme 和 scheduler-plugins scheme，配置 leader election、health probe、metrics bind 等。

6. 初始化服务和后台组件  
   `SetupManagerDependencies()` 会创建：
   - `ConfigService`
   - `BillingService`
   - `PrequeueService`
   - `GpuAnalysisService`
   - `CronJobManager`
   - `ServiceManager`
   - `PrequeueWatcher`

7. 注册 Kubernetes controllers  
   `SetupCustomCRDAddon()` 根据配置注册 AIJob、SEACS、镜像构建、模型下载、Volcano Job、Indexer 和 PrequeueWatcher。

8. 启动 manager 与 HTTP server  
   `ServerRunner.StartManager()` 先后台启动 manager 并等待 cache sync；随后 `StartServer()` 创建 Gin 路由并监听配置中的端口。

## 四、配置结构

配置模型在 `backend/pkg/config/config.go`，样例见 `backend/etc/example-config.yaml`。关键配置分组如下：

| 配置段 | 作用 |
| --- | --- |
| `host` / `port` | 后端暴露地址和监听端口 |
| `enableLeaderElection` | controller-runtime leader election |
| `namespaces.job` / `namespaces.image` | 作业运行 namespace，以及 BuildKit daemon 等镜像构建基础组件所在 namespace |
| `prometheusAPI` | Prometheus HTTP API 地址 |
| `postgres` | PostgreSQL 连接参数 |
| `storage` | RWX/ROX PVC 名称和用户、账号、公共空间路径前缀 |
| `checkpointScanner` | checkpoint-scanner 服务地址和超时 |
| `modelDownload` | 模型下载 Job 使用的镜像 |
| `secrets` | TLS、转发、镜像拉取 Secret |
| `registry` | Harbor 和镜像构建工具配置 |
| `smtp` | 邮件通知配置 |
| `auth` | JWT、LDAP、本地注册/登录配置 |
| `schedulerPlugins` | EMIAS AIJob 和 SEACS SPJob 开关 |

鉴权 token 配置由 `backend/pkg/config/token.go` 转成 `TokenConf`，默认 access token 1 小时、refresh token 168 小时。

## 五、HTTP 路由注册机制

路由入口在 `backend/internal/route.go`。

后端使用统一 Manager 插件模式。每个 handler 实现 `backend/internal/handler/interface.go` 中的接口：

```go
type Manager interface {
    GetName() string
    RegisterPublic(group *gin.RouterGroup)
    RegisterProtected(group *gin.RouterGroup)
    RegisterAdmin(group *gin.RouterGroup)
}
```

模块通过 `init()` 把构造函数追加到 `handler.Registers`。启动时 `internal/register.go` 用 blank import 加载子包，然后统一调用 `registerManagers()`。

路由分三类：

| 路由前缀 | 鉴权 | 用途 |
| --- | --- | --- |
| `/api/<manager>` | 无统一登录鉴权 | 登录、鉴权模式、公开指标等 |
| `/api/v1/<manager>` | `AuthProtected()` | 普通登录用户接口 |
| `/api/v1/admin/<manager>` | `AuthProtected()` + `AuthAdmin()` | 平台管理员接口 |

另有 `PublicV1Manager`，用于 `/api/v1/<manager>` 下但不走统一登录鉴权的接口。目前主要给实验 Run Token 上报使用。

## 六、鉴权和权限

主 API 鉴权在 `backend/internal/middleware/jwt.go`：

- 普通 HTTP 请求从 `Authorization: Bearer <token>` 读取 token。
- WebSocket 请求从 query 参数 `token` 读取。
- token 由 `backend/internal/util/token.go` 校验。
- 非 GET 请求会额外查询数据库，校验用户平台角色、账户角色和账户访问模式是否仍与 token 一致。
- `/api/v1/auth/switch` 是权限刷新入口，跳过账户级二次校验。
- 管理员接口要求 `RolePlatform == RoleAdmin`。

token 中保存的核心上下文包括：

- `UserID` / `Username`
- `AccountID` / `AccountName`
- 平台角色 `RolePlatform`
- 账户角色 `RoleAccount`
- 账户访问模式 `AccountAccessMode`
- 公共空间访问模式 `PublicAccessMode`

## 七、主要 API 模块

下面按 Manager 名称梳理主要 handler。完整路由请看各文件中的 `RegisterPublic`、`RegisterProtected`、`RegisterAdmin`。

| Manager | 文件 | 主要功能 |
| --- | --- | --- |
| `auth` | `internal/handler/auth.go` | 登录、注册、刷新 token、切换账户、鉴权模式 |
| `context` | `internal/handler/context.go` | 当前用户上下文、额度、预排队状态、计费摘要、用户属性和邮箱 |
| `users` | `internal/handler/user.go` | 用户详情、用户列表、角色、属性、计费余额 |
| `accounts` | `internal/handler/account.go` | 账户/队列、成员、账户额度、账户计费配置 |
| `vcjobs` | `internal/handler/vcjob/` | Volcano 作业创建、删除、详情、日志关联、计费、checkpoint、Jupyter/WebIDE/训练任务 |
| `aijobs` | `internal/handler/aijob/` | EMIAS AIJob 作业接口 |
| `spjobs` | `internal/handler/spjob/` | SEACS/SPJob 作业接口 |
| `images` | `internal/handler/image/` | 镜像构建、上传、镜像列表、共享、CUDA 基础镜像、Harbor |
| `dataset` | `internal/handler/dataset.go` | 数据集/模型元数据、共享给用户或账户 |
| `model-download` | `internal/handler/modeldownload.go` | 模型下载任务创建、暂停、恢复、重试、日志、删除 |
| `experiments` | `internal/handler/experiment.go` | 实验、Run、指标、参数、artifact、复现 |
| `resources` | `internal/handler/resource.go` | GPU/网络/vGPU 资源、计费单价、资源同步 |
| `nodes` | `internal/handler/node.go` | 节点列表、节点详情、GPU 信息、标签/污点/驱逐 |
| `queue-quotas` | `internal/handler/queue_quota.go` | 预排队队列额度配置 |
| `approvalorder` | `internal/handler/approvalorder.go` | 审批工单 |
| `system-config` | `internal/handler/system_config.go` | LLM、GPU 分析、预排队、计费开关 |
| `gpu-analysis` | `internal/handler/gpu_analysis.go` | GPU 低利用分析记录和手动触发 |
| `statistics` | `internal/handler/statistics.go` | 统计概览 |
| `metrics` | `internal/handler/metrics.go` | Prometheus 指标查询代理 |
| `namespaces` | `internal/handler/tool/podcontainer.go` | Pod 事件、容器、日志、Ingress/NodePort、资源调整 |
| `websocket` | `internal/handler/tool/websocket.go` | Pod 容器终端 WebSocket |
| `operations` | `internal/handler/operations/operations.go` | 运维清理、定时任务配置、锁定时间、白名单 |
| `operation-logs` | `internal/handler/operations/operation_log.go` | 管理员操作日志 |
| `storage` | `internal/handler/jwttoken.go` | storage token 校验辅助 |

常见开发定位：

- 新增普通业务接口：先找对应 `internal/handler/*.go` 或新建 Manager，再在 service/dao 中补逻辑。
- 新增管理员接口：实现到 `RegisterAdmin()`，并确认平台角色要求。
- 新增训练任务类型：优先看 `internal/handler/vcjob/` 和 `internal/service/vcjob/`，它们负责构造 Volcano Job。
- 新增作业状态同步行为：看 `pkg/reconciler/vcjob-reconciler.go`。

## 八、业务服务层

`internal/service/` 放的是跨 handler 复用、带业务状态的逻辑。

| Service | 文件 | 职责 |
| --- | --- | --- |
| `ConfigService` | `internal/service/config_service.go` | 系统配置默认值播种、LLM 配置、GPU 分析开关、预排队配置 |
| `BillingService` | `internal/service/billing_service.go`、`billing_amount.go` | 计费功能开关、周期发放、运行中结算、作业完成结算、余额重置 |
| `PrequeueService` | `internal/service/prequeue_service.go` | 队列额度解析、资源限制检查、用户资源占用汇总 |
| `GpuAnalysisService` | `internal/service/gpu_analysis_service.go` | 低 GPU 利用分析，串联 Kubernetes exec、Prometheus、LLM 和数据库 |
| `ExperimentService` | `internal/service/experiment_service.go` | 实验、Run、指标、Artifact、复现和 Run Token |
| `StatisticsService` | `internal/service/statistics.go` | 平台统计 |
| `OperationLog` | `internal/service/operation_log.go` | 操作日志记录 |
| `vcjob` 子包 | `internal/service/vcjob/` | 作业运行时配置、挂载计数、调度参数、checkpoint 处理 |

### GPU 分析链路

GPU 分析入口在 `GpuAnalysisService`：

1. 查找运行中的 Volcano Job 和 Pod。
2. 从 Prometheus 查询 GPU/进程相关指标。
3. 通过 Kubernetes exec 在容器内读取进程列表和脚本内容。
4. 读取数据库里的 LLM 配置。
5. 分两阶段调用 LLM：先识别可疑进程，再结合脚本内容评分。
6. 写入 `GpuAnalysis` 记录，并由管理员确认、忽略或触发停作业。

是否启用由 `system-config` 中的 GPU 分析配置控制，定时触发由 `CronJobManager` 和 `pkg/patrol` 协同。

### 计费链路

计费配置存在 `SystemConfig`、`Account`、`UserAccount`、`Job` 等表里。主要行为：

- `BillingService.UpdateStatus()` 更新功能开关、运行中结算间隔、默认发放额度等。
- 功能首次启用或激活时，会初始化账户/用户账户发放状态。
- 运行中的作业按间隔结算，完成/删除时做最终结算。
- 创建作业前可做计费预检查，余额不足时阻止提交。
- `CronJobManager` 可驱动 base loop，周期性发放和结算。

## 九、数据层

### GORM 与查询代码

数据库连接在 `backend/dao/query/db.go`：

- 使用 PostgreSQL。
- DSN 来自 `config.GetConfig().Postgres`。
- 默认连接池：`MaxIdleConns=5`、`MaxOpenConns=10`、`ConnMaxLifetime=1h`。

模型定义在 `backend/dao/model/`。`backend/dao/query/*.gen.go` 是 GORM Gen 生成代码，不应手写修改。修改模型后按流程运行：

```bash
cd backend
make migrate
make curd
```
/
4. 运行 `make curd` 重新生成 `dao/query/*.gen.go`。
5. 再改 handler/service 中的业务逻辑。

Helm 部署时，`charts/orbit/templates/orbit-backend/deployment.yaml` 会通过 initContainer 先执行 `/migrate`，再启动主后端。

### 关键模型

| 模型 | 文件 | 含义 |
| --- | --- | --- |
| `User` / `UserAccount` | `dao/model/user.go`、`account.go` | 平台用户、用户与账户关系、角色和访问模式 |
| `Account` | `dao/model/account.go` | 账户/队列，映射 Volcano Queue 概念 |
| `Job` | `dao/model/job.go` | Volcano 作业记录、资源、状态、checkpoint、诊断和计费状态 |
| `Kaniko` / `Image` | `dao/model/image.go` | 镜像构建记录和可用镜像记录 |
| `Dataset` | `dao/model/dataset.go` | 数据集、模型、共享文件元数据 |
| `ModelDownload` | `dao/model/modeldownload.go` | 模型下载任务 |
| `Experiment` / `ExperimentRun` / `RunMetric` / `RunArtifact` | `dao/model/experiment.go` | 实验追踪数据 |
| `Resource` / `ResourceNetwork` / `ResourceVGPU` | `dao/model/resource.go` | GPU、网络、vGPU 资源 |
| `ApprovalOrder` | `dao/model/approvalorder.go` | 审批工单 |
| `SystemConfig` / `PrequeueConfig` / `QueueQuotaLimit` | `dao/model/system_config.go`、`prequeue_config.go`、`queue_quota.go` | 系统配置、预排队运行配置、队列额度 |
| `CronJobConfig` / `CronJobRecord` | `dao/model/cron_job.go` | 定时任务配置和执行记录 |
| `GpuAnalysis` | `dao/model/gpu_analysis.go` | GPU 利用率分析记录 |
| `JobCheckpoint` | `dao/model/job_checkpoint.go` | checkpoint 扫描结果和恢复来源 |

## 十、Kubernetes 集成

后端大量依赖 Kubernetes API 和 CRD。

### controller-runtime Manager

Manager 创建在 `backend/cmd/orbit/helper/manager.go`。它注册：

- Kubernetes core scheme。
- scheduler-plugins scheme。
- Volcano `batch` 和 `scheduling` scheme。
- Orbit 自定义 `AIJob` scheme。
- `recommenddljob` scheme。

### Reconciler

| Reconciler | 文件 | 监听资源 | 主要行为 |
| --- | --- | --- | --- |
| `VcJobReconciler` | `pkg/reconciler/vcjob-reconciler.go` | Volcano `batch.Job` | 同步作业状态、采集 profile/事件/终止状态、触发通知、最终计费、实验 Run 状态 |
| `BuildKitReconciler` | `pkg/reconciler/build-reconciler.go` | Kubernetes `batch.Job` | 同步镜像构建状态，构建完成后查询 Harbor 镜像大小并创建 `Image` 记录 |
| `ModelDownloadReconciler` | `pkg/reconciler/modeldownload-reconciler.go` | Kubernetes `batch.Job` | 同步模型下载进度/状态，下载完成后创建模型数据集 |
| `AIJobReconciler` | `pkg/reconciler/aijob-reconciler.go` | Orbit `AIJob` | EMIAS AIJob 状态同步 |

`BuildKitReconciler` 和 `ModelDownloadReconciler` 都监听 Kubernetes `batch.Job`，通过 namespace 和 label 区分具体业务。

### CR client 和任务构造

`pkg/crclient/` 封装 Kubernetes 资源操作，例如：

- `jobclient.go`：作业相关资源操作。
- `service.go`：Service、Ingress、NodePort 等服务暴露。
- `imagepackclient.go`：镜像构建相关资源。
- `recommenddljobclient.go`：推荐深度学习作业 CR。
- `nodeclient.go`：节点操作。

`internal/handler/vcjob/` 和 `internal/service/vcjob/` 会基于用户请求构造 Volcano Job 模板，涉及镜像、资源、数据挂载、checkpoint、Jupyter/WebIDE 暴露、实验参数注入等。

### Prequeue Watcher

预排队 watcher 在 `pkg/prequeuewatcher/`：

- 由 `SetupManagerDependencies()` 创建。
- 由 `ManagerSetup.setupVolcano()` 添加到 manager。
- 实现 `NeedLeaderElection() == true`，适配 controller-runtime 生命周期。
- 周期扫描和信号触发结合，负责从数据库找出可激活的 `Prequeue` 作业。
- 激活时会结合 `PrequeueService` 的队列额度和资源限制。

## 十一、定时任务与运维清理

定时任务管理在 `pkg/cronjob/`，底层使用 `robfig/cron`。配置和执行记录分别在 `CronJobConfig`、`CronJobRecord`。

主要任务来源：

- `pkg/cleaner/`：低 GPU 利用、长时间运行、长时间等待的作业清理。
- `pkg/patrol/`：GPU 分析巡检、计费 base loop。
- `internal/handler/operations/`：管理员手动触发清理、调整定时任务配置、查看执行记录。
- `ConfigService` / `BillingService`：功能开关变更时同步 cron 状态。

## 十二、Storage Server

入口是 `backend/cmd/storage-server/main.go`。它与主后端共用配置和数据库，但作为独立进程运行。

启动逻辑：

1. debug 模式尝试加载 `.debug.env` 或 `.env`。
2. 加载后端配置并初始化数据库。
3. 从 `ORBIT_STORAGE_PORT` 或 `PORT` 读取端口，默认 `7320`。
4. 从 `ORBIT_STORAGE_ROOT`、`ROOTDIR` 读取存储根目录，默认 `/orbit`。
5. 调用 `storage.RegisterRoutes(r)` 注册路由。

路由在 `backend/internal/storage/router.go`：

- WebDAV 方法：`PUT`、`MKCOL`、`PROPFIND`、`PROPPATCH`，挂在 `/api/ss`。
- 文件接口：`/api/ss/files`、`/api/ss/rwfiles`、`/api/ss/download/*path`、`/api/ss/delete/*path`。
- 空间接口：`/api/ss/userspace`、`/api/ss/queuespace`。
- 数据集文件接口：`/api/ss/dataset/:id`。
- 管理员文件接口：`/api/ss/admin/files`。
- 移动/恢复：`/api/ss/move/*path`、`/api/ss/datasets/:id/move`、`/api/ss/datasets/restore`。

权限判断在 `backend/internal/storage/file.go`：

- token 仍使用主后端 JWT。
- 管理员拥有读写。
- 当前账户空间按 `AccountAccessMode` 控制。
- 公共空间按 `PublicAccessMode` 控制。
- 路径会从逻辑路径重定向到真实存储路径，例如用户、账户、公共空间前缀。

## 十三、Checkpoint Scanner

入口是 `backend/cmd/checkpoint-scanner/main.go`。它是只读扫描服务，生产环境中与 storage 共享同一个 PVC。

环境变量：

- `ORBIT_CHECKPOINT_SCANNER_ROOT`：扫描根目录，默认 `internal/service/vcjob/checkpoint` 中定义的默认挂载路径。
- `ORBIT_CHECKPOINT_SCANNER_PORT`：端口，默认 `7330`。
- `ORBIT_CHECKPOINT_SCANNER_CONCURRENCY`：并发扫描数，默认 `4`。

接口：

- `GET /healthz`
- `GET /readyz`
- `POST /scan`

checkpoint 业务逻辑位于 `backend/internal/service/vcjob/checkpoint/`：

- `scanner_client.go`：主后端调用 scanner 服务。
- `scanner_service.go`：扫描服务协议。
- `scanner.go` / `cluster_scanner.go`：扫描入口。
- `manifest.go`：manifest 表示。
- `validator.go`、`normalizer.go`、`policy.go`、`processor.go`：校验、规范化、保留策略和处理。
- `annotations.go`、`env.go`：作业注解和环境变量。

`vcjobs` 的 checkpoint API 会触发扫描、清理、恢复、删除等操作。

## 十四、镜像构建链路

镜像相关 API 在 `internal/handler/image/`，构建抽象在 `pkg/packer/`。

支持的构建来源包括：

- Dockerfile
- Pip/Apt 表单构建
- Snapshot
- EnvdAdvanced
- EnvdRaw

构建任务会创建 Kubernetes Job。`BuildKitReconciler` 监听这些 Job：

1. 根据 label `app=image-create` 识别镜像构建任务。
2. 从 Job annotation 还原用户、镜像地址、描述、构建脚本、标签、架构等。
3. 写入或更新 `Kaniko` 构建记录。
4. 构建完成后通过 Harbor client 获取镜像大小。
5. 创建 `Image` 记录，供作业创建时选择。

Harbor 集成在 `pkg/imageregistry/`，构建工具镜像和代理配置来自 `registry.buildTools`。

## 十五、实验中心链路

实验中心 API 在 `internal/handler/experiment.go`，主要业务在 `internal/service/experiment_service.go`。

核心概念：

- `Experiment`：实验容器，按用户和账户隔离，支持 private/account 可见性。
- `ExperimentRun`：一次作业或一次复现实验的运行记录。
- `RunMetric`：训练指标，支持 step、timestamp、context。
- `RunArtifact`：产物记录，可关联 checkpoint 等来源。

训练作业创建时可以注入：

- `ORBIT_RUN_ID`
- `ORBIT_RUN_TOKEN`
- `ORBIT_API_BASE`
- `ORBIT_OUTPUT_DIR`

Run Token 接口通过 `PublicV1Manager` 注册到 `/api/v1/experiments/runs/:runID/...`，用于训练容器内上报指标、参数、标签、artifact 和结束状态，不走普通用户 JWT。

## 十六、部署资产

### Helm

主 Chart 在 `charts/orbit/`。

关键模板：

- `templates/orbit-backend/deployment.yaml`：主后端 Deployment 和 migration initContainer。
- `templates/orbit-backend/configmap.yaml`：生成 `/etc/config/config.yaml`。
- `templates/storage-server/deployment.yaml`：WebDAV/storage server。
- `templates/checkpoint-scanner/deployment.yaml`：checkpoint scanner，只读挂载共享 PVC。
- `templates/buildkit/`：BuildKit 相关 StatefulSet/ConfigMap。
- `templates/job/`：训练作业启动脚本 ConfigMap。
- `templates/ingress/`：frontend、backend、storage、grafana-proxy Ingress。

`charts/orbit/values.yaml` 中的 `backendConfig` 会渲染成后端配置文件。生产部署需要重点检查：

- PostgreSQL 连接。
- `namespaces.job` / `namespaces.image`，其中镜像构建 Job 运行在 job namespace，BuildKit daemon 等基础组件使用 image namespace。
- `storage.pvc.readWriteMany`。
- `checkpointScanner.endpoint`。
- `registry` 和 Harbor。
- JWT secret。
- SMTP、LDAP、Prometheus。

### Docker Compose

根目录 `docker-compose.yml` 提供本地联调：

- `postgres`
- `migrate`
- `backend`
- `storage`
- `checkpoint-scanner`
- `frontend`

配置文件是 `deploy/compose/backend-config.yaml`。主后端映射到宿主机 `18088`，storage 映射到 `17320`，scanner 映射到 `17330`。

### 镜像

- `backend/Dockerfile`：生产后端镜像，包含 `controller`、`migrate`、`checkpoint-scanner`。
- `backend/storage-server.Dockerfile`：storage-server 独立镜像。
- `backend/Dockerfile.compose`：Compose 联调镜像，包含 `orbit`、`storage-server`、`checkpoint-scanner`、`migrate`。

## 十七、本地开发命令

进入 `backend/` 后常用命令：

| 命令 | 作用 |
| --- | --- |
| `make prepare` | 创建 `.debug.env` |
| `make run` | 格式化、生成 Swagger、启动主后端 |
| `make run-storage` | 启动 storage-server |
| `make migrate` | 执行数据库迁移 |
| `make curd` | 生成 GORM Gen 查询代码 |
| `make docs` | 生成 Swagger 文档 |
| `make lint` | 格式化、imports 检查、golangci-lint |
| `make build` | 构建主后端二进制 |
| `make build-storage` | 构建 storage-server |
| `make build-checkpoint-scanner` | 构建 checkpoint scanner |
| `make build-migrate` | 构建迁移二进制 |

本地运行主后端至少需要：

- 可访问的 PostgreSQL。
- 可用 kubeconfig。
- `backend/etc/debug-config.yaml` 或通过 `ORBIT_DEBUG_CONFIG_PATH` 指定配置。
- `.debug.env` 中的 `ORBIT_BE_PORT`。

## 十八、改动入口建议

| 需求 | 优先阅读/修改 |
| --- | --- |
| 新增 API | `internal/handler/<module>.go`，必要时补 `internal/service/` |
| 调整作业创建表单字段 | `internal/handler/vcjob/`、`internal/service/vcjob/`、`dao/model/job.go` |
| 调整作业状态同步 | `pkg/reconciler/vcjob-reconciler.go` |
| 调整镜像构建 | `internal/handler/image/`、`pkg/packer/`、`pkg/reconciler/build-reconciler.go` |
| 调整模型下载 | `internal/handler/modeldownload.go`、`pkg/reconciler/modeldownload-reconciler.go` |
| 调整文件权限/路径 | `internal/storage/file.go`、`dao/model/const.go`、`pkg/config/config.go` |
| 调整 checkpoint | `internal/handler/vcjob/checkpoint*.go`、`internal/service/vcjob/checkpoint/`、`cmd/checkpoint-scanner/` |
| 调整预排队 | `internal/service/prequeue_service.go`、`pkg/prequeuewatcher/`、`internal/handler/queue_quota.go` |
| 调整计费 | `internal/service/billing_service.go`、`internal/handler/system_config.go`、`internal/handler/account.go` |
| 调整 GPU 分析 | `internal/service/gpu_analysis_service.go`、`internal/handler/gpu_analysis.go`、`pkg/patrol/` |
| 调整数据库结构 | `dao/model/`、`cmd/gorm-gen/models/migrate.go`、`dao/query/` |
| 调整部署配置 | `charts/orbit/values.yaml`、`charts/orbit/templates/`、`deploy/compose/backend-config.yaml` |

## 十九、风险点和注意事项

- `dao/query/*.gen.go` 是生成代码，模型变化后重新生成，不要手工维护。
- 主后端同时运行 API 和 controllers，改动启动逻辑、配置或 manager 注册时要考虑两类行为。
- `BuildKitReconciler` 和 `ModelDownloadReconciler` 都监听 Kubernetes `batch.Job`，新增 Job 类型时要用 namespace/label 做好过滤。
- 非 GET 请求会校验数据库中的实时角色/权限，改 token 字段或权限模型时要同步 middleware、auth 和 storage。
- storage-server 与主后端共享 JWT 和数据库，但它是独立进程；改配置或 token 逻辑时要验证两个进程。
- checkpoint scanner 生产环境只读挂载共享 PVC；扫描、清理、恢复由主后端和 scanner 协同，不要只测单进程。
- Helm 部署会先跑 migration initContainer；破坏性迁移必须额外考虑备份、回滚和老版本兼容。
- 预排队 watcher 参与 leader election；多副本部署时要确认只有 leader 执行激活逻辑。
- 计费逻辑涉及账户、用户账户和作业三类余额/结算状态，修改前应补服务层测试。

## 二十、推荐阅读顺序

如果是第一次接手，建议按下面顺序读：

1. `backend/cmd/orbit/main.go`
2. `backend/cmd/orbit/helper/config.go`
3. `backend/cmd/orbit/helper/manager.go`
4. `backend/internal/route.go`
5. `backend/internal/handler/interface.go`
6. `backend/internal/middleware/jwt.go`
7. 目标业务的 `internal/handler/` 文件
8. 目标业务的 `internal/service/` 文件
9. 对应的 `dao/model/` 模型
10. 相关 `pkg/reconciler/` 或 `pkg/crclient/`

这样可以先建立“请求如何进来、依赖如何创建、状态如何同步”的整体图，再进入具体业务细节。
