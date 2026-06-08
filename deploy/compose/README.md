# Orbit Compose 本地后台运行

这套 Compose 配置用于把 Orbit 前端、后端、storage、checkpoint-scanner 和 Postgres 固定端口跑在后台。

## 端口

- 前端：`http://127.0.0.1:18080`
- 后端：`http://127.0.0.1:18088`
- Storage：`http://127.0.0.1:17320`
- Checkpoint Scanner：`http://127.0.0.1:17330`

Postgres 只在 Compose 网络内暴露，不占用宿主机 `5432`。

## 启动

先在宿主机构建本地运行产物：

```bash
./hack/compose/build-local.sh
```

然后在仓库根目录执行：

```bash
docker compose up -d --build
```

默认会挂载 `${KUBECONFIG:-$HOME/.kube/config}`。如果要指定 Kubernetes 配置：

```bash
KUBECONFIG=/path/to/kubeconfig docker compose up -d --build
```

后端容器启动时会把 kubeconfig 内的 `https://127.0.0.1:<port>` 或 `https://localhost:<port>` 自动改成 `https://host.docker.internal:<port>`，并补充 `tls-server-name: localhost`，让容器可以访问宿主机上的 Kubernetes API，同时仍按 Kubernetes 证书里的 `localhost` 做 TLS 校验。

## 迭代

只改前端：

```bash
./hack/compose/build-local.sh frontend
docker compose up -d --build frontend
```

只改后端：

```bash
./hack/compose/build-local.sh backend
docker compose up -d --build backend storage checkpoint-scanner migrate
```

查看日志：

```bash
docker compose logs -f backend
docker compose logs -f frontend
```

停止：

```bash
docker compose down
```

清掉 Compose 数据卷：

```bash
docker compose down -v
```

## 默认账号

首次初始化数据库时，`migrate` 服务会创建默认管理员：

- 用户名：`admin`
- 密码：`admin123`

如果已有 `orbit-postgres-data` 数据卷，修改默认账号环境变量不会覆盖已有数据库。
