# 新电脑与开发智能体接手指南

修订：2026-09-12。统一流程是：从 GitHub 拉取 → 本机或 Remote SSH 中使用 AI/编辑器修改功能分支 → 验证 → 提交并推送 → PR/CI 通过并合并 main → Project Hub 同步与发布 → ready 版本核验 → 业务验收。个人开发也可以按这一流程自查；多人协作时由另一位开发者审查 PR。

服务器平台入口：[https://manjiao.cloud/ops/](https://manjiao.cloud/ops/)。平台管理员账号 `p5222`，密码独立私密交付，不使用 GitHub 密码，不写入交接文档。完整 [在线操作手册](https://manjiao.cloud/ops/handbook.html) 包含换电脑与发布步骤。

## 交接什么

提供仓库地址 `https://github.com/p5222/aigc-short-drama-factory.git`、当前功能分支、最后提交号、目标需求、测试结果和未完成事项即可。真实环境配置另走受控渠道，不能放进提示词、截图或提交。代码、提交历史和操作文档随 GitHub 同步，生产数据库、生成素材、`.env` 与私钥不会随 clone 下载。

给接手开发者的任务说明可以是：

```text
请阅读 README.md、docs/operations/github-and-multi-device-deployment.md 和当前 Git 状态。
确认目标分支已包含远端最新提交；使用 codex/<任务名> 功能分支开发。
不要提交 .env、私钥、访问令牌、输出目录或临时快照。
完成后生成 Prisma Client、构建 shared，再运行 pnpm test、pnpm typecheck 和 pnpm build。
审查 diff，逐项添加文件，提交并 push 功能分支，返回分支、提交号与验证结果。
GitHub push 不等于生产部署；生产需 PR/CI 通过并合并 main 后，在 Project Hub 同步、明确确认提交并发布，再核验 ready 版本与实际业务。
```

## 新电脑首次接入

仅通过网页查看、同步或发布服务器项目，使用浏览器登录平台并选择已有项目即可。无需在新电脑安装 Git、复制平台程序、持有服务器 GitHub Token 或生产 SSH 私钥。平台当前是单一维护者账号，登录后可操作全部登记项目，不具备按项目划分成员权限；只向可信维护者私密交付登录。

下面的本机环境用于编辑与运行代码。平台不会读取本机目录，也不内置浏览器 AI 编码器。

安装 Git、Node.js 24、GitHub CLI；运行项目或发布时使用 pnpm 11.7.0。每个人登录自己的 GitHub 账号，由仓库管理员添加协作者；不要共享账号或 PAT。

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
git switch -c codex/my-task
pnpm install --frozen-lockfile
```

继续已存在的远端功能分支时，执行 `git fetch origin` 和 `git switch --track origin/codex/分支名`；本地已有该分支则 `git switch` 后 `git pull --ff-only`。离开旧电脑前先 push，单独 commit 不能让其他电脑获得进展。

本地运行需要 Docker、独立开发数据库与 `.env`。首次配置、启动和冲突处理见 [跨设备指南](./github-and-multi-device-deployment.md)。从样例建立开发配置，按需提供开发环境凭据，不把生产 `.env` 或生产密钥复制到新电脑，也不要把本地 `.env` 指向生产数据库。使用本机图形界面可选 [Git Workbench](../../tools/git-workbench/README.md)，它操作本机代码；服务器工作副本使用 Project Hub，二者不能混为同一目录。无需安装特定 AI 工具，使用团队选定且具备当前工作副本访问能力的编辑器即可。

## 每次迭代与合并

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c codex/my-next-task
# 在编辑器修改后
pnpm --filter @aifilm/api db:generate
pnpm --filter @aifilm/shared build
pnpm test
pnpm typecheck
pnpm build
git diff --check
git status --short
git add <逐个审查确认的文件路径>
git commit -m "feat: describe the change"
git push -u origin HEAD
gh pr create --fill --base main
```

GitHub 的 `Verify project` CI 还运行隔离 PostgreSQL / Redis 集成测试和生产镜像检查，不能仅凭本地单元测试代替。查看当前 PR 的实际运行结果，不能因为工作流文件存在就视为通过；CI 失败或没有运行时先处理原因。冲突需要理解双方业务改动后再合并，不要强推共享分支或丢弃未确认文件。完整需求通过 PR/CI 并合并 main 后才进入发布。

## 新设备的服务器权限

平台登录、GitHub 权限与服务器 SSH 是独立授权。仅本机开发和 push GitHub 不需要服务器权限；使用 Project Hub 网页发布也不要求给新电脑开 SSH。下面的设备公钥只用于维护者从终端直接发布，或按另行授权方式进行 Remote SSH 开发。

Remote SSH 开发需要管理员提供专门开发账号、目录和所需 SSH 功能。新电脑自己生成密钥，私钥留在新电脑，只将 `.pub` 公钥交给管理员。用编辑器打开专用开发副本，确认仓库和功能分支，再使用远端 AI/编辑器修改与验证；不能打开生产运行目录直接修改。若与 Project Hub 使用同一工作副本，管理员需确认目录映射和文件权限，避免终端与网页同时执行 Git 写操作；不同副本则通过 GitHub 提交与拉取衔接。

以下脚本授予的是受限 Git-only 发布权限，不能用于 Remote SSH 开发：

管理员在已有 `manjiao` 终端权限的电脑运行：

```powershell
.\scripts\grant_manjiao_git_access.ps1 -PublicKeyFile C:\path\device.pub
```

新设备配置 `manjiao-git` SSH 别名后，通过以下命令验证受限 Git 权限：

```bash
git ls-remote ssh://manjiao-git/opt/git/aigc-short-drama-factory.git
```

这种权限拒绝交互式 SSH、文件读取与端口转发，所以 `ssh manjiao-git "echo OK"` 失败是预期行为。具备生产 main 推送权限仍意味着能运行发布代码，只授权可信设备。设备丢失或成员离职时撤销对应公钥和 GitHub 权限。

密钥生成、SSH config、腾讯云防火墙与设备撤销的完整说明见 [跨设备指南第 3、4 节](./github-and-multi-device-deployment.md)。`bootstrap_manjiao_git.ps1` 是可选 Windows 接入工具，会生成无口令设备密钥；需要口令时使用手册里的手动步骤。日常代码来源仍是 GitHub。

## 发布与确认

服务器 hook 由管理员按 [部署升级说明](../../deploy/UPGRADE.md) 安装和维护；仓库代码不会自动替换已经安装的 hook。使用 Project Hub 的日常流程是：

1. 选择仓库地址为 `p5222/aigc-short-drama-factory` 的正确项目，点“刷新远端分支”。
2. 下拉选择 main，点“切换分支”，再点“拉取当前分支”，逐项等待任务完成。
3. 核对仓库、干净工作区与提交，点“确认并发布 main”。弹层核对完整提交，输入项目名称并点“发布此提交”。
4. 在“操作记录与日志”查看结果。“服务器已接收代码，线上版本尚未核验”还不能交接为已上线，需点“核验线上版本”。
5. 核验要求服务器 main、deployed 与公网 `/ready` 完整提交一致、响应 `ok: true`；同版本重试还要求请求已被处理。看到“线上版本已核验”后，再运行业务验收并记录证据。

更多项目可通过侧栏“添加”接入 GitHub 仓库；需要服务器凭据有该仓库访问权限。其他项目发布由管理员配置可信 `remote`、`verifyUrl` 及对应 hook，clone 成功不代表已经具备发布能力。

具备上述 Git-only 权限的维护者，也可选择从设备终端直接发布。在干净项目目录中执行：

```bash
git switch main
git pull --ff-only origin main
pnpm deploy:server --check
pnpm deploy:server
```

`--check` 是只读连通性和提交一致性检查，不会构建，也不证明服务器写权限或业务通过。正式发布验证本地代码后，服务器串行执行经过校验的备份、镜像构建、非破坏 schema 同步、API 就绪检查与前端更新。`main` 是服务器收到的提交，`deployed` 是通过发布就绪检查的提交；Git push 成功不等于部署成功。

同一提交失败后，先由管理员检查 `/opt/manjiao-deploy-logs/` 并修复原因。网页使用“重试同一版本发布”，再次核对并输入项目名称；当前完整提交必须与持久待核验记录一致。直接发布的设备可运行 `pnpm deploy:server --retry`。请求超时或任务中断时，先刷新记录和实际 Git 状态，避免重复提交。

代码回退优先创建新的功能分支撤回问题改动，经验证、PR/CI 合并为新的 main 后再次发布。平台没有一键回滚；源码回退不会恢复数据库和客户素材。`RECOVERY_FAILED` 不能视作已恢复，紧急恢复交给管理员按备份与运行手册处理。

旧的 `一键发布到服务器.bat`、`pnpm ship:server` 与 `deploy/deploy_to_manjiao.bat` 已转到统一入口，不能跳过 GitHub main，也不再替你提交代码。不要根据旧版本文档绕过 GitHub 直接发布。GitHub 不可用时保留本地工作，恢复连通后继续审查与推送。

发布后完成 [发布验收单](./release-acceptance.md)，包括真实任务、积分、私有媒体、导出和后台运营流程。只在证据完整时记录“已部署并验收”。

## 每次交接记录

- 分支、GitHub PR、最后提交号与服务器 deployed 提交号。
- 已完成行为、遗留问题、测试命令及结果。
- 是否已发布、验收人、验收时间、备份和日志路径。
- 涉及 schema 或环境配置的变更、兼容性和恢复步骤。

不在交接记录中包含任何密钥、令牌、真实客户数据或备份内容。
