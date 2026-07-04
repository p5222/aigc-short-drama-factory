# 服务器部署记忆

更新时间：2026-07-04

这份文件只记录非敏感信息，方便后续继续部署。不要把服务器密码、SSH 私钥、数据库密码、API Key 写进来。

## 服务器信息

- 服务商：腾讯云轻量应用服务器
- 公网 IPv4：`43.139.101.102`
- 地域：广州 / 广州六区
- 控制台显示的实例名：`OpenCloudOS-TxPf`
- 控制台显示配置：4 核 CPU，4 GB 内存，40 GB SSD，300 GB/月流量
- 控制台显示到期时间：2027-07-04 15:05:40
- 当前系统：待确认
- 推荐系统：`Ubuntu 24.04 LTS`
- SSH 用户名：`ubuntu`
- 登录方式：密码已由用户设置好；密码不记录
- 域名：`manjiao.cloud`
- 实际系统：`Ubuntu 24.04.4 LTS`

## 项目信息

- 本地项目目录：`E:\AI漫剧`
- 技术栈：React/Vite 前端、Express/TypeScript 后端、PostgreSQL、Redis、Nginx
- 生产 Docker Compose 文件：`docker-compose.prod.yml`
- Nginx 配置：`deploy/nginx.conf`
- 生产环境变量模板：`.env.production.example`
- 本地生成文件目录：`storage`
- 2026-07-04 统计：`storage` 大约 87 MB

## 当前部署目标

- 服务器项目目录：`/opt/manjiao`
- 对外访问地址：`http://manjiao.cloud`
- 备用 IP 访问地址：`http://43.139.101.102`
- 后台地址：`http://manjiao.cloud/admin`
- 健康检查地址：`http://manjiao.cloud/health`

## 当前状态

- SSH 用户名：`ubuntu`
- SSH 登录方式：密码已设置好，但不记录明文
- 域名：`manjiao.cloud`
- 腾讯云防火墙：
  - `22/tcp`：需要开放，用于 SSH 登录
  - `80/tcp`：需要开放，用于 HTTP 网站访问
  - `443/tcp`：需要开放，用于后续 HTTPS
- 服务器基础环境：未安装
- Docker / Docker Compose：未安装
- 服务器 `.env.production`：未创建
- 服务器基础环境：已安装
- Docker / Docker Compose：已安装
- Caddy：已安装并接管 `manjiao.cloud` / `www.manjiao.cloud`
- 服务器 `.env.production`：已创建，权限 `600`
- 模型 Key：已从本地环境同步到服务器 `.env.production`，明文不记录
- 数据库迁移：已完成
- `storage` 文件迁移：已完成
- 线上访问验证：已完成

## 已观察到的情况

- 2026-07-04：从本地测试 `43.139.101.102:22` 成功，说明 SSH 端口大概率已开放。
- 2026-07-04：从本地测试 `43.139.101.102:80` 失败。网站还没部署前这是正常的，但仍需在腾讯云防火墙确认 `80/tcp` 已允许。
- 2026-07-04：用户确认腾讯云防火墙已开放。
- 2026-07-04：DNS 已确认：`manjiao.cloud` -> `43.139.101.102`，`www.manjiao.cloud` -> `43.139.101.102`。
- 2026-07-04：从本地测试 `43.139.101.102:22` 仍成功。
- 2026-07-04：从本地测试 `43.139.101.102:80` 和 `:443` 仍失败或超时。当前网站服务尚未启动，这不一定代表腾讯云防火墙错误。
- 2026-07-04：当前 Codex 会话无法访问本机 Docker，所以暂时不能直接从本地 Docker 导出数据库。后续可以修复 Docker 权限后再迁移，也可以用数据库连接信息迁移。
- 2026-07-04：已创建部署包 `E:\AI漫剧\backups\manjiao_source_20260704_155750.tar.gz`，约 6.2 MB。这个包不包含 `.env`、`.env.local`、`.env.production`、`.git`、`node_modules`、`storage`、`backups`、`outputs` 和日志。
- 2026-07-04：已创建修复后的新部署包 `E:\AI漫剧\backups\manjiao_source_20260704_165804.tar.gz`，约 6.2 MB。后续优先使用此包。
- 2026-07-04：服务器基础环境完成：Ubuntu 24.04.4 LTS、Docker 29.1.3、Docker Compose 2.40.3、Caddy active。
- 2026-07-04：项目已上传到 `/opt/manjiao`。
- 2026-07-04：已配置 Docker 镜像加速：`docker.m.daocloud.io`、`dockerproxy.com`、`mirror.ccs.tencentyun.com`。
- 2026-07-04：已配置 Caddy：`manjiao.cloud, www.manjiao.cloud -> 127.0.0.1:8080`。
- 2026-07-04：修复生产部署构建配置：
  - `packages/shared` 改为输出 JS 到 `dist`
  - `packages/shared/package.json` 指向 `dist/index.js`
  - `docker-compose.prod.yml` 在 web/api 构建前先构建 `@aifilm/shared`
  - 补传 `apps/api/src/storage/objectStorage.ts`
- 2026-07-04：线上健康检查通过：
  - `https://manjiao.cloud/` 返回 200
  - `https://manjiao.cloud/admin` 返回 200
  - `https://manjiao.cloud/health` 返回 200
  - `https://www.manjiao.cloud/health` 返回 200
- 2026-07-04：真实数据迁移完成，本地与云端数据库数量一致：
  - `User`: 3
  - `Project`: 17
  - `GenerationTask`: 55
  - `Asset`: 181
  - `Storyboard`: 123
  - `ModelProvider`: 13
- 2026-07-04：`storage` 已迁移到云端 Docker volume，云端 `/app/storage` 大约 87.4 MB，约 88 个文件。
- 2026-07-04：演示账号 `demo@aifilm.local / demo123456` 已验证可登录线上并读取工作台。
- 2026-07-04：后台管理员账号存在：`admin@aifilm.local`，但密码来自迁移后的本地数据库；`admin123456` 验证失败。需要用户决定是否重置管理员密码。

## 系统选择决定

- 推荐重装为：`Ubuntu 24.04 LTS`
- 如果腾讯云没有 24.04，就选：`Ubuntu 22.04 LTS`
- 原因：
  - Docker 官方支持 Ubuntu 24.04 和 22.04。
  - 新手部署资料最多。
  - 后续排查问题更容易。
- 注意：
  - 重装系统会清空服务器系统盘。
  - 当前服务器还没有正式部署数据，所以可以重装。

## 当前暂不处理 sub2api

- 用户说明：`sub2api` 在本地使用 `8080` 端口。
- 当前决定：先不部署 `sub2api`。
- 说明：本地电脑的 `8080` 和云服务器的端口不是一回事，不影响当前 AI 漫剧项目上云。
- 后续如果要部署到同一台服务器，再单独设计端口或域名，避免冲突。

## 敏感信息清单

这些信息需要配置，但不要写进本文档：

- 服务器 SSH 密码
- SSH 私钥内容
- `POSTGRES_PASSWORD`
- `DATABASE_URL` 里的数据库密码
- `ADMIN_SEED_PASSWORD`
- 各模型服务 API Key，例如 `DASHSCOPE_API_KEY`、`DEEPSEEK_API_KEY`、`DOUBAO_API_KEY`、`ARK_API_KEY`、`ZML_API_KEY`

## 需要用户提供的信息

1. 服务器是否已完成 Ubuntu 重装。
2. 可自动登录服务器的方式：
   - 推荐：在腾讯云绑定 SSH 密钥，然后告诉我本地私钥文件路径。
   - 或者：用户打开腾讯云 OrcaTerm/网页终端，我提供命令，用户粘贴执行。
   - 不推荐：把密码写进命令或文档。
3. 是否迁移本地数据。
   - 先部署空环境也可以。
   - 之后再迁移本地数据库和 `storage` 文件。

## 后续计划

1. 重置后台管理员密码，方便用户进入后台。
2. 线上测试模型调用：
   - 文本模型连接测试
   - 生图模型连接测试
   - 视频模型配置/提交测试
3. 建立后续迭代流程：
   - 本地开发
   - 预发布验证
   - 生产发布
   - 数据备份
   - 可回滚部署

## 后续迭代建议

短期可以继续在当前 Codex 对话里迭代，我可以直接修改本地项目并同步到云服务器。

更正式的无感迭代方案：

1. 代码进入 Git 仓库。
2. 服务器保留生产目录 `/opt/manjiao`。
3. 另建预发布目录 `/opt/manjiao-staging`，使用独立端口，例如 `127.0.0.1:8081`。
4. 新功能先部署到 `staging.manjiao.cloud` 验证。
5. 验证通过后发布到生产。
6. 发布前自动备份数据库和 `storage`。
7. 发布失败时切回上一版代码和上一份数据库备份。

无感发布的核心是：

- 不直接在生产目录边改边试。
- 先在预发布环境跑通。
- 生产发布时只切换 Caddy 代理或替换已构建好的版本。
- 数据库变更先备份，再迁移。
