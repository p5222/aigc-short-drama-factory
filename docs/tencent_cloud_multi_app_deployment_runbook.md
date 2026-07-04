# 腾讯云部署手把手记录

更新时间：2026-07-04

这份文档只写“小白照着做”的步骤。敏感信息不要写进文档，例如服务器密码、数据库密码、API Key、SSH 私钥内容。

## 先回答你现在最关心的几个问题

### 0. 为什么推荐 Ubuntu，不推荐 Windows Server？

Windows Server 不是不好，它只是“不适合这个项目作为第一选择”。

这个项目是典型的 Web 服务部署：

- Node.js 后端
- React/Vite 前端
- PostgreSQL 数据库
- Redis 队列
- Nginx/Caddy 反向代理
- Docker Compose 一键编排

这些东西在 Linux，尤其是 Ubuntu 上是服务器部署的主流组合。对新手来说，Ubuntu 的好处是：

1. Docker 在 Linux 上是原生运行，安装和维护最简单。
2. 服务器资料、教程、报错解决方案最多。
3. 占用资源更少。你的服务器是 4 核 4GB，Ubuntu 比 Windows Server 更轻。
4. 后续上 HTTPS、域名、反向代理、自动重启、日志排查都更顺。
5. 云服务器通常用 SSH 管理，Ubuntu 的命令和工具链更适合长期运维。

Windows Server 更适合这些情况：

- 项目必须用 IIS。
- 项目是 ASP.NET / Windows 桌面程序 / 依赖 Windows 软件。
- 你必须远程桌面操作图形界面。

当前 AI 漫剧项目不属于这些情况，所以推荐 Ubuntu。

### 1. Ubuntu 怎么安装？

你不是在自己电脑上安装 Ubuntu，而是在腾讯云服务器里“重装系统”成 Ubuntu。

你在腾讯云控制台操作：

1. 打开腾讯云轻量应用服务器控制台。
2. 进入这台服务器：`43.139.101.102`，名字大概是 `OpenCloudOS-TxPf`。
3. 右上角点“更多操作”。
4. 选择“重装系统”。
5. 镜像类型选择“系统镜像”。
6. 系统选择：
   - 首选：`Ubuntu 24.04 LTS`
   - 如果没有：`Ubuntu 22.04 LTS`
7. 登录方式选择“密码登录”最简单。
8. 设置一个新的服务器登录密码。
9. 确认重装。

注意：重装系统会清空服务器系统盘。你现在是新服务器，还没部署正式数据，所以可以重装。

### 2. 要安装 Docker 吗？

要装，但你不用自己手动研究。

这个项目包含这些服务：

- 前端网页
- 后端 API
- PostgreSQL 数据库
- Redis 队列
- Nginx 静态网页和接口代理

用 Docker 可以把这些服务一起装好、启动、停止、迁移。否则手动安装 Node、PostgreSQL、Redis、Nginx 会更容易出错。

等你把 Ubuntu 重装好、把 SSH 登录信息给我之后，我来在服务器上安装 Docker 和部署项目。

### 3. 现在先不处理 sub2api

已暂停 `sub2api` 部署计划。

你说它在本地是 `8080` 端口，这不影响当前 AI 漫剧项目上云。电脑本地端口和云服务器端口不是同一个东西。

以后如果要把 `sub2api` 也放到同一台云服务器，我会再给它单独安排端口或域名，避免冲突。

### 4. 防火墙怎么开放？

在腾讯云网页里操作，不是在你电脑上操作。

进入服务器详情页后，点上方标签里的“防火墙”，然后看有没有下面几条规则。

需要开放：

| 用途 | 协议 | 端口 | 来源 | 策略 |
| --- | --- | --- | --- | --- |
| SSH 登录服务器 | TCP | 22 | 0.0.0.0/0 | 允许 |
| 网站 HTTP 访问 | TCP | 80 | 0.0.0.0/0 | 允许 |
| 网站 HTTPS 访问 | TCP | 443 | 0.0.0.0/0 | 允许 |

如果没有，就点“添加规则”：

1. 应用类型：选“自定义”。
2. 协议：选 `TCP`。
3. 端口：填 `22`、`80` 或 `443`，一条规则填一个端口最不容易出错。
4. 来源：填 `0.0.0.0/0`，或者留空如果页面提示默认全部 IPv4。
5. 策略：选“允许”。
6. 备注：
   - `22` 写 `SSH`
   - `80` 写 `HTTP`
   - `443` 写 `HTTPS`
7. 点“确定”。

当前我已经测过：`22` 能连，`80` 暂时不能连。`80` 不能连可能是因为网站还没部署，也可能是防火墙没开放。你只要先确认防火墙里有 `80/tcp` 允许规则即可。

## 当前部署目标

- 服务器公网 IP：`43.139.101.102`
- 服务器系统：建议重装为 `Ubuntu 24.04 LTS`
- 项目目录：`/opt/manjiao`
- 对外访问地址：`http://43.139.101.102`
- 后台地址：`http://43.139.101.102/admin`
- 健康检查：`http://43.139.101.102/health`

## 你现在需要做的事

只做这三件：

1. 把服务器重装为 `Ubuntu 24.04 LTS`。
2. 在“防火墙”里确认开放 `22`、`80`、`443`。
3. 把下面信息发给我：
   - 服务器登录用户名，通常是 `root` 或 `ubuntu`
   - 服务器登录方式：密码登录，还是 SSH 密钥登录
   - 如果是密码登录，只需要告诉我“密码已设置好”，不要写进文档

拿到这些后，我继续完成：

1. 登录服务器。
2. 安装 Docker。
3. 安装 Caddy/Nginx 代理。
4. 上传项目。
5. 配置生产环境。
6. 启动数据库、后端、前端。
7. 检查网站和后台是否能打开。

## 后续我会执行的服务器命令

这部分你不用现在操作，我放在这里是为了留档。

安装 Docker：

```bash
sudo apt update
sudo apt install -y ca-certificates curl git ufw unzip tar
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

服务器内部防火墙：

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

## 参考资料

- 腾讯云官方文档：轻量应用服务器重装系统
- 腾讯云官方文档：轻量应用服务器管理防火墙
- Docker 官方文档：Install Docker Engine on Ubuntu
