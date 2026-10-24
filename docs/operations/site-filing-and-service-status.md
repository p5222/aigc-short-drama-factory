# 网站备案与服务状态记录

## 当前状态

- 备案状态：已通过
- ICP 主体备案号：`粤ICP备2026098451号`
- 网站悬挂链接：`https://beian.miit.gov.cn/`
- 恢复时间：2026-07-20（Asia/Shanghai）
- 主站：https://manjiao.cloud/
- 主站别名：https://www.manjiao.cloud/
- 漫角 API：https://manjiao.cloud/api/
- 就绪检查：https://manjiao.cloud/ready（应返回 `ok=true` 和当前完整提交号）
- `api.manjiao.cloud` 当前是独立的 Sub2API 网关，不作为漫角应用的健康检查目标。
- 主站验证：HTTP 200
- 最近路由只读复核：2026-10-24，主站与 `www` 的 `/ready` 返回相同漫角版本；独立网关的 `/ready` 返回网关 HTML，不能视为漫角健康。

## 生产架构

- 服务器项目目录：`/opt/manjiao`
- Docker Compose 文件：`docker-compose.prod.yml`
- 主站入口：Docker `nginx` 服务，监听 `127.0.0.1:8080`
- 公网入口：系统 `caddy` 服务
- 漫角 API 代理：主站 `/api/` 经 Nginx 转至容器 `api:4000`，应用不直接暴露宿主端口。
- Caddy 同时服务其他项目。漫角日常启停应只操作漫角容器，不能停用共享 Caddy。

## 恢复网站

```bash
cd /opt/manjiao
docker compose -f docker-compose.prod.yml start nginx
```

以上只适用于已有容器被临时停止。容器缺失或版本升级按[生产发布流程](./production-hardening-20261024.md)操作，确保指定精确镜像版本，勿用默认 `local` 标签重建。恢复后检查：

```bash
docker compose -f /opt/manjiao/docker-compose.prod.yml ps
systemctl is-active caddy
curl -I https://manjiao.cloud/
curl -I https://www.manjiao.cloud/
curl --fail https://manjiao.cloud/ready
```

## 临时关闭网站

只关闭漫角入口，不修改代码、数据库、上传文件或构建产物，其他项目继续使用共享 Caddy：

```bash
cd /opt/manjiao
docker compose -f docker-compose.prod.yml stop nginx
```

## 操作历史

- 2026-07-11：备案期间停止 Docker `nginx`，并停用系统 `caddy`。
- 2026-07-20：备案通过，启动 Docker `nginx`，并启用系统 `caddy`；主站、`www` 与 API 健康检查均恢复为 HTTP 200。
