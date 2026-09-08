# GitHub 与跨设备发布指南

核实日期：2026-09-09。本指南作为当前跨设备开发与发布入口，旧部署记录中的“尚未安装 / 需要重装服务器”是历史状态，不要照做。

## 当前结构

- GitHub 私有仓库：https://github.com/p5222/aigc-short-drama-factory
- 默认分支：`main`；日常开发分支：`codex/<任务名>`。
- 腾讯云轻量应用服务器：`43.139.101.102`，SSH 用户 `ubuntu`。
- 生产源码：`/opt/manjiao`；服务器 Git：`/opt/git/aigc-short-drama-factory.git`。
- 网站：https://manjiao.cloud；健康检查：https://manjiao.cloud/health。
- GitHub 是日常代码入口。PR 合并到 main 后，手动运行 `pnpm deploy:server`，服务器已有的 post-receive hook 负责备份、解包、重建和健康检查。
- GitHub push 本身不会自动更新生产。服务器 `main` 表示已接收版本，`deployed` 才表示通过部署健康检查的版本。

## 1. 换一台电脑拉代码

安装 Git、Node.js 24、pnpm 11.7.0；本地运行后端还需要 Docker。使用自己的 GitHub 账号登录，账号必须有这个私有仓库的权限。

```bash
gh auth login
gh auth setup-git
git clone https://github.com/p5222/aigc-short-drama-factory.git
cd aigc-short-drama-factory
git switch -c codex/my-feature
pnpm install --frozen-lockfile
```

将仓库根目录 `.env.example` 复制为 `.env`（Windows PowerShell：`Copy-Item .env.example .env`；macOS/Linux：`cp .env.example .env`），按需填入开发环境配置。

```bash
docker compose up -d postgres redis
pnpm --filter @aifilm/shared build
pnpm --filter @aifilm/api db:generate
pnpm --filter @aifilm/api db:push
pnpm dev
```

前端 http://localhost:5173；API http://localhost:4000/health。这里的 `db:push` 仅用于本地开发数据库。生产数据库、生成素材和真实密钥没有放进 GitHub；clone 不会下载它们。用本地测试数据开发，开发密钥通过安全渠道单独配置。

## 2. 每次开发、提交与合并

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c codex/my-next-feature
# 修改代码后
pnpm --filter @aifilm/api db:generate
pnpm --filter @aifilm/shared build
pnpm test
pnpm typecheck
pnpm build
git diff --check
git status --short
git add <逐个确认的文件路径>
git commit -m "feat: describe the change"
git push -u origin HEAD
gh pr create --base main --fill
```

在 GitHub 审查并合并 PR，其他环境从最新 main 再建分支；继续已有分支时使用 `git switch <分支名>` 和 `git pull --ff-only origin <分支名>`。不要把旧本地 main 直接当成服务器最新版本，也不要通过强推覆盖分叉历史。

## 3. 新设备连接服务器：给设备加公钥

GitHub 登录与服务器 SSH 是两套权限。仅开发和 push GitHub 不需要服务器权限；需要发布的设备才配置下面内容。

在新设备执行（每台设备使用自己的密钥，按提示设置口令）：

```bash
ssh-keygen -t ed25519 -f ~/.ssh/manjiao_git -C manjiao-new-device
```

把 `~/.ssh/manjiao_git.pub` 公钥交给已有服务器权限的管理员，私钥 `manjiao_git` 留在新设备。管理员在原来已配置 `manjiao` SSH 别名的 Windows 电脑、项目目录内运行：

```powershell
.\scripts\grant_manjiao_git_access.ps1 -PublicKeyFile C:\path\manjiao_git.pub
```

也可以由管理员从腾讯云网页终端将该公钥文件上传后运行仓库内的 `deploy/grant_git_key.sh <公钥文件路径>`，应以 `ubuntu` 用户运行。

在新设备的 `~/.ssh/config`（Windows 是用户目录下 `.ssh/config`）追加：

```sshconfig
Host manjiao-git
  HostName 43.139.101.102
  User ubuntu
  IdentityFile ~/.ssh/manjiao_git
  IdentitiesOnly yes
```

首次连接时核对服务器主机指纹。验证使用 Git 命令：

```bash
git ls-remote ssh://manjiao-git/opt/git/aigc-short-drama-factory.git
```

这类公钥限制为 Git 命令，`ssh manjiao-git "echo OK"` 会被拒绝，这是正常的。具备 main 推送权限意味着可以部署代码，仍只应授权可信设备。设备丢失时从 `ubuntu` 的 `~/.ssh/authorized_keys` 删除对应公钥。

Windows 也可以使用 `scripts/bootstrap_manjiao_git.ps1` 辅助接入，它生成无口令的设备密钥；需要口令时优先使用上面的手动步骤。

## 4. 腾讯云“只允许个人电脑”限制在哪里打开

本次只读检查结果：服务器 UFW 已对所有来源开放 SSH、80、443；SSH 公钥登录已启用，密码登录已禁用；当前 authorized_keys 未发现 `from=` 来源限制。尚未读取腾讯云控制台规则，不能据此断言云端防火墙也已放开。

进入 [腾讯云轻量应用服务器控制台](https://console.cloud.tencent.com/lighthouse/instance)，选择 `43.139.101.102` → **防火墙** → 查看 Linux 登录 / SSH 的 TCP 22 规则：

| 需求 | 来源 | 协议 / 端口 | 策略 |
| --- | --- | --- | --- |
| 允许任意网络的已授权设备登录 | `0.0.0.0/0` | TCP / 22 | 允许 |
| 只允许指定新网络 | 新设备所在网络的公网 IP，掩码 `/32` | TCP / 22 | 允许 |

如果来源目前是原电脑的公网 IP `/32`，改成 `0.0.0.0/0` 即取消 IPv4 来源限制；保留密钥登录即可，无需启用密码。只改 SSH 这条规则，不需要开放全部端口。规则从上往下匹配，要确认没有优先级更高的拒绝规则拦截。若实际实例属于 CVM，入口是对应实例的 **安全组 → 入站规则**。

- SSH 超时：检查公网 IP、云端防火墙、当前网络是否允许出站 TCP 22。
- `Permission denied (publickey)`：网络已通，检查用户名、私钥路径、服务器是否添加了这台设备的公钥。
- `Could not resolve hostname manjiao-git`：新环境尚未配置 SSH 别名。
- GitHub 的 `Repository not found`：检查 GitHub 登录账号和私有仓库权限。

官方说明：[轻量应用服务器管理防火墙](https://cloud.tencent.cn/document/product/1207/44577)、[使用 SSH 终端登录](https://cloud.tencent.com/document/product/1207/44643)。

## 5. 从任何已授权环境发布

PR 合并后，在安装了项目依赖工具的新设备执行：

```bash
git switch main
git pull --ff-only origin main
pnpm deploy:server --check
pnpm deploy:server
```

`--check` 仅检查当前提交是否是 GitHub main，以及服务器 Git 是否可读，不发布、不运行构建，也不保证写权限。正式发布会安装锁定依赖、生成 Prisma Client、运行测试、类型检查和构建，再向服务器 main 普通推送，核对 deployed 提交和公网健康。已部署同一提交时仅核对部署标记和健康状态。未跟踪文件不打包，已跟踪文件存在未提交修改则停止。

默认使用 `manjiao-git` SSH 别名。已有管理员电脑可使用现有 `manjiao` 别名：

```powershell
$env:MANJIAO_GIT_REMOTE = "ssh://manjiao/opt/git/aigc-short-drama-factory.git"
pnpm deploy:server
```

macOS/Linux 对应写法：

```bash
MANJIAO_GIT_REMOTE=ssh://manjiao/opt/git/aigc-short-drama-factory.git pnpm deploy:server
```

同一时间只发布一个版本。现有服务器 hook 没有并发部署锁；部署失败后 main 可能已更新，重复推送相同提交不会重新执行 hook，应先查看 `/tmp/manjiao_git_deploy_<提交前8位>.log` 并处理。当前备份和回滚沿用旧部署助手；备份失败可能仅告警，且源码回滚不能自动恢复数据库。当前生产 Compose 启动会执行带 `--accept-data-loss` 的 Prisma db push，因此涉及表结构修改时先审查 SQL 并确认数据库备份可恢复。

此流程保留服务器上的 `.env.production`、数据库卷和生成素材卷。旧的 `pnpm ship:server` 是直接推服务器的备用入口，可能造成 GitHub 落后；日常优先走本指南。
