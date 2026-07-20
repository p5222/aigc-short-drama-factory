# 网站备案与服务状态记录

## 当前状态

- 备案状态：已通过
- 恢复时间：2026-07-20（Asia/Shanghai）
- 主站：https://manjiao.cloud/
- 主站别名：https://www.manjiao.cloud/
- API 站点：https://api.manjiao.cloud/
- 主站验证：HTTP 200
- API 健康检查：https://api.manjiao.cloud/health，HTTP 200

## 生产架构

- 服务器项目目录：`/opt/manjiao`
- Docker Compose 文件：`docker-compose.prod.yml`
- 主站入口：Docker `nginx` 服务，监听 `127.0.0.1:8080`
- 公网入口：系统 `caddy` 服务
- API 公网代理：`api.manjiao.cloud` 转发至 `127.0.0.1:18080`

## 恢复网站

```bash
cd /opt/manjiao
docker compose -f docker-compose.prod.yml up -d nginx
sudo systemctl enable --now caddy
```

恢复后检查：

```bash
docker compose -f /opt/manjiao/docker-compose.prod.yml ps
systemctl is-active caddy
curl -I https://manjiao.cloud/
curl -I https://www.manjiao.cloud/
curl -I https://api.manjiao.cloud/health
```

## 临时关闭网站

只关闭公网入口，不修改代码、数据库、上传文件或构建产物：

```bash
cd /opt/manjiao
docker compose -f docker-compose.prod.yml stop nginx
sudo systemctl disable --now caddy
```

## 操作历史

- 2026-07-11：备案期间停止 Docker `nginx`，并停用系统 `caddy`。
- 2026-07-20：备案通过，启动 Docker `nginx`，并启用系统 `caddy`；主站、`www` 与 API 健康检查均恢复为 HTTP 200。
