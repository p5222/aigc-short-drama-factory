# 漫角 VPS 测试部署指南

本项目建议先部署到一台 Linux VPS 做真实测试，不建议测试期就拆成多台服务。当前系统包含前端 SPA、Node API、PostgreSQL、Redis、生成图片/视频文件、长耗时模型调用，单机 Docker Compose 最容易排查问题。

## 1. 推荐服务器

- 系统：Ubuntu 22.04 LTS 或 24.04 LTS
- 配置：最低 2 vCPU / 4GB RAM / 60GB SSD；更推荐 4 vCPU / 8GB RAM / 100GB SSD
- 安全组：先开放 `22`、`80`；绑定域名和 SSL 后再开放 `443`
- 测试阶段可以先用服务器 IP，正式演示再绑定域名

## 2. 本地如何启动测试

在 Windows 工作区双击：

```bat
E:\AI漫剧\start_admin_server.bat
```

启动后访问：

- 前台：`http://localhost:5173`
- 后台：`http://localhost:5173/admin`
- API 健康检查：`http://localhost:4000/health`
- 依赖检查：`http://localhost:4000/api/system/health/dependencies`

默认账号：

- 前台演示：`demo@aifilm.local` / `demo123456`
- 也可用手机号：`13900000002` / `demo123456`
- 后台管理员：`admin@aifilm.local` / `admin123456`

## 3. 服务器安装基础环境

用 SSH 登录服务器后执行：

```bash
sudo apt update
sudo apt install -y ca-certificates curl git ufw
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc >/dev/null
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw enable
```

重新登录一次 SSH，让 Docker 用户组生效。

## 4. 上传或拉取项目

如果代码已经在 Git 仓库：

```bash
mkdir -p /opt/manjiao
cd /opt/manjiao
git clone YOUR_REPO_URL .
```

如果还没有远程仓库，可以从本地打包上传，注意不要上传 `.env`、`.env.local`、`node_modules`、`storage` 以外的临时日志。

## 5. 配置生产环境变量

在服务器项目目录执行：

```bash
cp .env.production.example .env.production
nano .env.production
```

必须修改：

- `POSTGRES_PASSWORD`
- `DATABASE_URL` 里的数据库密码
- `ADMIN_SEED_PASSWORD`
- `WEB_ORIGIN` 和 `PUBLIC_API_BASE_URL`，先填 `http://服务器IP`
- 真实模型密钥：`DEEPSEEK_API_KEY`、`DASHSCOPE_API_KEY`、`DOUBAO_API_KEY`、`ARK_API_KEY`、`ZML_API_KEY`

不要把 `.env.production` 提交到 Git。

## 6. 首次启动

```bash
docker compose -f docker-compose.prod.yml up -d postgres redis
docker compose -f docker-compose.prod.yml up web
docker compose -f docker-compose.prod.yml up -d api nginx
docker compose -f docker-compose.prod.yml ps
```

检查：

```bash
curl http://127.0.0.1/health
docker compose -f docker-compose.prod.yml logs -f api
```

浏览器访问：

- 前台：`http://服务器IP`
- 后台：`http://服务器IP/admin`

## 7. 本地数据迁移到服务器

### 7.1 迁移数据库

本地 Windows PowerShell：

```powershell
docker exec aigc_drama_postgres pg_dump -U aigc -d aigc_drama -Fc -f /tmp/aigc_drama.dump
docker cp aigc_drama_postgres:/tmp/aigc_drama.dump E:\AI漫剧\backups\aigc_drama.dump
scp E:\AI漫剧\backups\aigc_drama.dump root@服务器IP:/opt/manjiao/backups/aigc_drama.dump
```

服务器：

```bash
docker compose -f docker-compose.prod.yml stop api
docker cp /opt/manjiao/backups/aigc_drama.dump manjiao-postgres-1:/tmp/aigc_drama.dump
docker compose -f docker-compose.prod.yml exec postgres sh -lc 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" --if-exists && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose -f docker-compose.prod.yml exec postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists /tmp/aigc_drama.dump
docker compose -f docker-compose.prod.yml up -d api
```

容器名可能随目录名变化，先用 `docker ps` 查看真实 Postgres 容器名。

### 7.2 迁移生成文件

本地：

```powershell
Compress-Archive -Path E:\AI漫剧\storage\* -DestinationPath E:\AI漫剧\backups\storage.zip -Force
scp E:\AI漫剧\backups\storage.zip root@服务器IP:/opt/manjiao/backups/storage.zip
```

服务器：

```bash
mkdir -p /tmp/manjiao-storage
unzip -o /opt/manjiao/backups/storage.zip -d /tmp/manjiao-storage
docker compose -f docker-compose.prod.yml cp /tmp/manjiao-storage/. api:/app/storage
docker compose -f docker-compose.prod.yml restart api nginx
```

## 8. 绑定域名和 HTTPS

域名解析到服务器 IP 后，可以先用 Nginx Proxy Manager 或 Caddy 简化 HTTPS。测试阶段也可以继续只用 IP。

正式上线建议：

- `WEB_ORIGIN=https://你的域名`
- `PUBLIC_API_BASE_URL=https://你的域名`
- Nginx 增加 443 证书
- 防火墙开放 `443/tcp`

## 9. 当前真实模型测试结论

- 前台/后台登录 API 已验证成功。
- 豆包 Seedream 生图已真实返回图片 URL，模型 ID 使用 `doubao-seedream-5-0-lite-260128`。
- 豆包 Seedance 视频已真实提交任务，返回任务 ID；成片 URL 需要继续轮询或在正式任务队列里等待完成。
- ZML / GPT Image 当前会超时，后端已改为返回可读失败结果，不再导致 API 进程崩溃。

## 10. 我实际帮你迁移时需要的信息

- 服务器 IP
- SSH 用户名
- 登录方式：密码或 SSH 私钥
- 是否有域名，域名是什么
- 是否允许我把本地数据库和 `storage` 上传到服务器
- 生产环境是否继续使用当前模型 Key

拿到这些信息后，可以按本文档执行实际部署、数据迁移和前后台访问验证。
