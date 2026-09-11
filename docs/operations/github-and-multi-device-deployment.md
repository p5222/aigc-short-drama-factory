# GitHub 与跨设备发布指南

手册修订：2026-09-12。本指南覆盖新电脑接续开发和服务器平台发布。平台入口为 [https://manjiao.cloud/ops/](https://manjiao.cloud/ops/)，管理员账号 `p5222`，密码独立私密交付，不是 GitHub 密码，也不写入文档。平台内可随时打开 [操作手册 · 换电脑](https://manjiao.cloud/ops/handbook.html)。服务器 hook 的安装与维护由管理员按 [部署升级说明](../../deploy/UPGRADE.md) 处理；文档或 CI 配置更新本身不代表当前版本已经通过发布验收。

## 当前结构

- GitHub 私有仓库：https://github.com/p5222/aigc-short-drama-factory
- 默认分支：`main`；日常开发分支：`codex/<任务名>`。
- 腾讯云轻量应用服务器：`43.139.101.102`，SSH 用户 `ubuntu`。
- 生产源码：`/opt/manjiao`；服务器 Git：`/opt/git/aigc-short-drama-factory.git`。
- 网站：https://manjiao.cloud；存活检查：`/health`；新版就绪检查：`/ready`。
- GitHub 是日常代码入口。PR/CI 通过并合并到 main 后，使用 Project Hub 同步并发布；需要直接从设备发布的维护者也可使用 `pnpm deploy:server`。服务器 post-receive hook 负责加锁、校验备份、构建镜像、同步 schema 和就绪检查。
- GitHub push 本身不会自动更新生产。服务器 `main` 表示已接收版本，`deployed` 才表示通过部署健康检查的版本。

## 1. 换一台电脑拉代码

只想用网页同步、查看或发布服务器项目：新电脑打开 [Project Hub](https://manjiao.cloud/ops/) 登录，从侧栏选择已有项目即可。无需安装 Git、复制工具、登录新电脑的 GitHub，也无需复制生产密钥或开通该电脑的 SSH；GitHub 与发布操作使用服务器已配置的凭据。结束后点“退出登录”。平台当前只有维护者账号，登录后可操作全部已注册项目，不提供每项目成员权限。

需要开发代码时，选择本机开发或第 3 节的 Remote SSH 开发。网页管理的是服务器工作副本，不会读取你电脑的目录，也不内置 AI 编程环境。

希望通过本机网页操作本机文件，可选用 [Git Workbench 便携版](../../tools/git-workbench/README.md)：Windows 双击 `tools/git-workbench/start-windows.bat`；macOS / Linux 运行 `sh tools/git-workbench/start-unix.sh`。它与服务器平台是两个独立工具；本机手册地址为 `http://127.0.0.1:4318/manual`。

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
git switch main
git pull --ff-only origin main
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

在 GitHub PR 中审查差异，并查看 `Verify project` CI 的实际结果；通过后再合并。该工作流包含测试、类型检查、构建、隔离数据库/Redis 集成测试与生产镜像检查。工作流文件存在不代表本次检查成功；失败或未运行时先处理原因。其他环境从最新 main 再建分支；继续已有分支时使用 `git switch <分支名>` 和 `git pull --ff-only origin <分支名>`。不要把旧本地 main 直接当成服务器最新版本，也不要通过强推覆盖分叉历史。

首次接续只有远端存在的分支，执行 `git fetch origin` 和 `git switch --track origin/codex/任务名`。旧电脑离开前必须完成 push，单独 commit 只保存在那台电脑。

### 两台电脑修改了同一分支

先审查并提交本机需要保留的内容，确认工作区干净，再执行：

```bash
git fetch origin
git merge origin/codex/your-feature
```

把示例替换为当前功能分支。出现冲突时，在编辑器逐个理解并保留需要的双方改动，删除冲突标记，运行验证，只 `git add` 已确认文件，然后 `git commit` 完成合并并 push。无法确认时用 `git merge --abort` 退出这次合并；它依赖开始前工作区干净。不要用强推、`reset --hard` 或一键覆盖双方文件来解决未知冲突。

## 3. 新设备连接服务器：给设备加公钥

平台登录、GitHub 权限与服务器 SSH 是三套权限。仅本机开发和 push GitHub 不需要服务器 SSH；通过 `/ops/` 网页发布也不需要给新电脑配置 SSH。只有使用 Remote SSH 开发或在设备终端直接发布时，才另行申请相应权限。

### Remote SSH 开发

由管理员为新电脑的独立公钥开通开发账号、目录和必要的 SSH 功能，再用编辑器的 Remote SSH 连接。打开专用开发工作副本，用 `git remote -v` 和 `git status` 确认仓库与分支，然后使用已配置的 AI/编辑器修改和测试；不要直接编辑 `/opt/manjiao` 生产运行目录。

如需由网页审查这些未提交文件，编辑器与 Project Hub 必须指向同一个由管理员确认的工作副本，并保证文件归属和权限兼容。否则在远端开发目录提交、push GitHub，再到平台拉取。不要在终端和网页同时对同一工作副本执行 Git 写操作。

下面的 Git-only 密钥仅供终端直接发布使用，不能代替 Remote SSH 开发授权。

### 可选：设备终端直接发布的 Git-only 公钥

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

通过 HTTPS 使用 Project Hub 不需要开放新电脑的 SSH 权限。只有终端 SSH 连接受阻时才检查以下设置；不要为了网页登录开放更多端口。

历史检查记录：2026-09-09，实例 `lhins-2fz9aroh` 的 TCP 22、80、443 为「全部 IPv4 地址 / 允许」，主机启用 SSH 公钥登录、禁用密码登录，授权公钥未发现 `from=` 来源限制。该记录说明当时没有绑定原电脑 IP，不代表防火墙此后没有变化。换设备使用 SSH 仍需管理员授权新设备公钥。

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

### 使用服务器平台发布

1. 在 GitHub 确认 PR 已通过审查和 CI 并合并，记下要发布的 `main` 提交。
2. 登录 [Project Hub](https://manjiao.cloud/ops/)，从侧栏选择仓库为 `p5222/aigc-short-drama-factory` 的项目。避免重复添加已有副本。
3. 点“刷新远端分支”，等待任务完成；下拉框选择 `main`，点“切换分支”，再点“拉取当前分支”。当前工作区有改动时先在编辑器处理，不能直接覆盖。
4. 核对当前仓库、`main` 和提交号，点“确认并发布 main”。在弹层核对完整提交并输入项目名称，再点“发布此提交”。服务端会校验确认的版本未变化且与 GitHub `main` 一致。
5. 在“操作记录与日志”查看本项目任务。显示“服务器已接收代码，线上版本尚未核验”时继续检查日志，稍后点“核验线上版本”；只有“线上版本已核验”才表示部署版本核对通过。
6. 平台会核对服务器 `main`、`deployed` 与 [公网 `/ready`](https://manjiao.cloud/ready) 的完整 40 位提交一致，且就绪响应为 `ok: true`。同版本重试还需确认发布请求已完成。之后按 [发布验收单](./release-acceptance.md) 检查业务效果。

添加其他项目时，点“添加”并填写 GitHub HTTPS 仓库地址。服务器凭据必须有该仓库权限；仓库可同步不代表它已经可发布。管理员需在服务器私有配置中按仓库设置可信 `remote`、`verifyUrl` 和相应发布 hook，网页不能输入任意命令或部署地址。具体配置见 [Project Hub README](../../tools/project-hub/README.md)。

### 可选：从已授权设备的终端直接发布

这种方式才需要第 3 节的 Git-only SSH 授权。PR 合并后，在安装了项目依赖工具的新设备执行：

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

此流程保留服务器 `.env.production`、数据库和生成素材卷。旧的 `pnpm ship:server`、`deploy_to_manjiao` 和一键发布入口已转到统一流程；不会自动提交，也不再跳过 GitHub main。服务器 hook 需要由管理员安装与升级，仓库中的脚本变化不会自动替换已安装版本；以实际发布日志、deployed 与就绪版本为准，不把历史检查记录作为当前部署状态。

## 6. 失败重试、回滚与发布验收

Git post-receive 执行失败不会撤销服务器已接收的 main，因此 Git push 返回成功不足以证明服务更新成功。保留本次提交号、日志和备份路径。新版日志位于 `/opt/manjiao-deploy-logs/`；Git-only 设备应把路径交给有终端权限的管理员读取。

| 状态 | 含义与处置 |
| --- | --- |
| 备份失败 | 尚未覆盖源码；修复数据库、素材卷或磁盘问题后重试。 |
| `RELEASE_FAILED` 且旧版本就绪已验证 | 发布未完成，deployed 保持旧版本；修复原因后重新发布。 |
| `RECOVERY_FAILED` | 自动恢复未通过，必须人工恢复和重新验收。 |
| main 与 deployed 不同 | 接收代码与运行版本不一致；不要把它记录为上线成功。 |

使用平台时，先点“刷新记录”并选择对应发布任务，管理员处理实际失败原因后点“重试同一版本发布”，再次核对项目和提交、输入项目名称并确认。按钮只对当前完整提交与持久待核验记录一致的情况启用；核验已通过、提交已变化或没有原始记录时不能按此流程重试。重试后仍需“核验线上版本”。

直接使用设备终端发布的维护者，在管理员处理失败原因后，同一提交重试使用：

```bash
pnpm deploy:server --retry
```

HEAD 必须同时等于 GitHub main 和服务器 main。专用命令通过一次性请求 ref 重新触发新版 hook，并检查请求完成标记；普通重复 push 相同 main 不会触发部署。

常规代码回滚是在 `codex/revert-release` 分支对问题提交执行 `git revert`，验证并通过 PR 合并，再按第 5 节发布新的 main。合并提交需要明确主线，不能盲目套用命令；不要强推共享 main。紧急源码恢复及旧镜像选择由管理员按 [部署升级说明](../../deploy/UPGRADE.md) 执行。

源码回滚不撤回数据库和客户素材的新写入。恢复数据前先保留当前数据库，在隔离库验证备份，再停止写入并执行经过确认的恢复方案。当前迁移历史尚无完整 baseline，禁止直接 `migrate reset`、删除生产卷或用 `--accept-data-loss` 绕过 schema 阻断。

发布后核对 deployed、GitHub SHA 与公网 `/ready` 的 revision 一致，再验证真实登录、项目创建、任务恢复、积分结算、私有素材预览与 MP4 下载，以及后台运营流程。完整记录见 [发布验收单](./release-acceptance.md)。CI、HTTP 200 或一次编码成功都不能代替这份业务验收。
