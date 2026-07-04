# 运维上线检查清单

## 对象存储

- 本地默认使用 `storage/` 目录作为持久化对象目录。
- Docker Compose 已预留 MinIO：`docker compose --profile storage up -d minio`。
- 生产环境建议改为 S3/OSS/COS，并把生成图片、视频、导出文件从数据库 URL 切换为对象存储 URL。

## 日志监控

- API 已增加请求日志：错误请求默认打印，设置 `API_ACCESS_LOG=true` 可打印全部请求。
- 建议生产接入：进程日志采集、错误告警、任务失败率监控、模型供应商延迟监控。

## 队列重试

- BullMQ 生成任务已启用指数退避重试。
- 可配置：
  - `GENERATION_JOB_ATTEMPTS=3`
  - `GENERATION_JOB_BACKOFF_MS=5000`
  - `GENERATION_CONCURRENCY=1`

## 权限分级

- 当前已区分 `admin`、`operator`、`finance`、`support`、`creator`。
- 后台接口已加模块权限：
  - `admin`：全部后台权限。
  - `operator`：运营总览、模型路由、兑换码、模板查看。
  - `finance`：运营总览、套餐会员、价格策略、用户查看、积分调整。
  - `support`：运营总览、用户查看、积分调整。
  - `creator`：无后台入口。

## 备份

- 本地备份命令：
  `powershell -ExecutionPolicy Bypass -File scripts/backup_postgres.ps1`
- 建议生产至少每日自动备份 PostgreSQL，并保留 7 天日备、4 周周备、6 个月月备。

## 限流

- API 已增加内存限流：
  - 登录接口默认 60 秒 30 次。
  - 普通接口默认 60 秒 180 次。
- 可配置：
  - `API_RATE_LIMIT_WINDOW_MS=60000`
  - `API_RATE_LIMIT_MAX=180`
- 多实例部署时应改为 Redis 限流。
