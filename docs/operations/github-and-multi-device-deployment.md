# GitHub 与跨设备发布指南

手册修订：2026-09-12。本指南是跨设备开发与发布入口。以下新版发布流程需要先安装对应服务器 hook，首次升级见 [部署升级说明](../../deploy/UPGRADE.md)。文档更新不代表生产已经部署这个版本。

## 当前结构

- GitHub 私有仓库：https://github.com/p5222/aigc-short-drama-factory
- 默认分支：`main`；日常开发分支：`codex/<任务名>`。
- 腾讯云轻量应用服务器：`43.139.101.102`，SSH 用户 `ubuntu`。
- 生产源码：`/opt/manjiao`；服务器 Git：`/opt/git/aigc-short-drama-factory.git`。
- 网站：https://manjiao.cloud；存活检查：`/health`；新版就绪检查：`/ready`。
- GitHub 是日常代码入口。PR 合并到 main 后，手动运行 `pnpm deploy:server`，新版 post-receive hook 负责加锁、校验备份、构建镜像、同步 schema 和就绪检查。
- GitHub push 本身不会自动更新生产。服务器 `main` 表示已接收版本，`deployed` 才表示通过部署健康检查的版本。

## 1. 换一台电脑拉代码

希望通过网页操作 Git，可使用仓库内的 [Git Workbench 便携版](../../tools/git-workbench/README.md)。工具左侧「操作手册 · 换电脑」提供完整步骤，也可打开 `http://127.0.0.1:4318/manual`。Windows 双击 `tools/git-workbench/start-windows.bat`；macOS / Linux 运行 `sh tools/git-workbench/start-unix.sh`。工具在本机网页运行，每台电脑使用自己的 GitHub 登录，服务器发布仍使用本文第 5 节的独立命令。

安装 Git、Node.js 24、GitHub CLI 和 pnpm 11.7.0；本地运行后端还需要 Docker。使用自己的 GitHub 账号登录，账号必须有这个私有仓库的权限。Windows 便携工作台已经验证运行；macOS / Linux 提供启动脚本，但仍需在目标设备验收。无需安装 Codex。

```bash
gh auth login
gh auth setup-git
gh auth status
git config --global user.name "你的名字"
git config --global user.email "你的GitHub提交邮箱"
npm install -g pnpm@11.7.0
git clone https://github.com/p5222/aigc-short-drama-factory.git
cd aigc-short-drama-factory
git switch -c codex/my-feature
pnpm install --frozen-lockfile
```

仅在本地配置尚不存在时，将仓库根目录 `.env.example` 复制为 `.env`（Windows PowerShell：`Copy-Item .env.example .env`；macOS/Linux：`cp .env.example .env`），按需填入开发环境配置；不要覆盖已有配置。

```bash
docker compose up -d postgres redis
pnpm --filter @aifilm/shared build
pnpm --filter @aifilm/api db:generate
pnpm --filter @aifilm/api db:push
pnpm dev
```

前端 http://localhost:5173；API 存活检查 http://localhost:4000/health；新版依赖与任务执行器就绪检查 http://localhost:4000/ready。这里的 `db:push` 仅用于本地开发数据库。生产数据库、生成素材和真实密钥不随代码同步；clone 不会下载它们。用本地测试数据开发，开发密钥通过安全渠道单独配置，不能把开发数据库地址改成生产库。

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

首次接续只有远端存在的分支，执行 `git fetch origin` 和 `git switch --track origin/codex/任务名`。旧电脑离开前必须完成 push，单独 commit 只保存在那台电脑。

### 两台电脑修改了同一分支

先审查并提交本机需要保留的内容，确认工作区干净，再执行：

```bash
git fetch origin
git merge origin/codex/your-feature
```

把示例替换为当前功能分支。出现冲突时，在编辑器逐个理解并保留需要的双方改动，删除冲突标记，运行验证，只 `git add` 已确认文件，然后 `git commit` 完成合并并 push。无法确认时用 `git merge --abort` 退出这次合并；它依赖开始前工作区干净。不要用强推、`reset --hard` 或一键覆盖双方文件来解决未知冲突。

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

本次只读检查结果：服务器 UFW 已对所有来源开放 SSH、80、443；SSH 公钥登录已启用，密码登录已禁用；当前 authorized_keys 未发现 `from=` 来源限制。2026-09-09 已进一步在腾讯云控制台核实：实例 `lhins-2fz9aroh` 共 3 条规则，TCP 22、80、443 均为「全部 IPv4 地址 / 允许」。云端没有绑定原电脑来源 IP，本次无需修改防火墙。换设备仍需授权新设备的 SSH 公钥。

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

新版服务器 hook 为整个发布加锁，使用独立临时目录，并要求数据库 dump 可列出内容、素材归档可读取且源码备份完整才继续。构建带 FFmpeg 和中文字库的应用镜像；schema 同步不接受可能的数据丢失；API 数据库、Redis 和任务执行器通过 `/ready` 后才更新前端和 deployed。普通容器重启不执行依赖安装或 schema 变更。

此流程保留服务器 `.env.production`、数据库和生成素材卷。旧的 `pnpm ship:server`、`deploy_to_manjiao` 和一键发布入口已转到统一流程；不会自动提交，也不再跳过 GitHub main。首次升级必须先由管理员安装新版 hook，否则以上保障不成立。2026-09-12 只读检查时，服务器仍是旧 hook，所需 rsync、python3、flock 等命令已经存在；这不是新版本已上线的记录。

## 6. 失败重试、回滚与发布验收

Git post-receive 执行失败不会撤销服务器已接收的 main，因此 Git push 返回成功不足以证明服务更新成功。保留本次提交号、日志和备份路径。新版日志位于 `/opt/manjiao-deploy-logs/`；Git-only 设备应把路径交给有终端权限的管理员读取。

| 状态 | 含义与处置 |
| --- | --- |
| 备份失败 | 尚未覆盖源码；修复数据库、素材卷或磁盘问题后重试。 |
| `RELEASE_FAILED` 且旧版本就绪已验证 | 发布未完成，deployed 保持旧版本；修复原因后重新发布。 |
| `RECOVERY_FAILED` | 自动恢复未通过，必须人工恢复和重新验收。 |
| main 与 deployed 不同 | 接收代码与运行版本不一致；不要把它记录为上线成功。 |

管理员处理失败原因后，同一提交重试使用：

```bash
pnpm deploy:server --retry
```

HEAD 必须同时等于 GitHub main 和服务器 main。专用命令通过一次性请求 ref 重新触发新版 hook，并检查请求完成标记；普通重复 push 相同 main 不会触发部署。

常规代码回滚是在 `codex/revert-release` 分支对问题提交执行 `git revert`，验证并通过 PR 合并，再按第 5 节发布新的 main。合并提交需要明确主线，不能盲目套用命令；不要强推共享 main。紧急源码恢复及旧镜像选择由管理员按 [部署升级说明](../../deploy/UPGRADE.md) 执行。

源码回滚不撤回数据库和客户素材的新写入。恢复数据前先保留当前数据库，在隔离库验证备份，再停止写入并执行经过确认的恢复方案。当前迁移历史尚无完整 baseline，禁止直接 `migrate reset`、删除生产卷或用 `--accept-data-loss` 绕过 schema 阻断。

发布后核对 deployed、GitHub SHA 与公网 `/ready` 的 revision 一致，再验证真实登录、项目创建、任务恢复、积分结算、私有素材预览与 MP4 下载，以及后台运营流程。完整记录见 [发布验收单](./release-acceptance.md)。CI、HTTP 200 或一次编码成功都不能代替这份业务验收。
