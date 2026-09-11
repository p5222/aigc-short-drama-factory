# 新电脑与开发智能体接手指南

修订：2026-09-12。统一流程是：从 GitHub 拉取 → 功能分支修改 → 验证 → 提交并推送 → PR 合并 main → 独立发布服务器 → 业务验收。个人开发也可以按这一流程自查；多人协作时由另一位开发者审查 PR。

## 交接什么

提供仓库地址 `https://github.com/p5222/aigc-short-drama-factory.git`、当前功能分支、最后提交号、目标需求、测试结果和未完成事项即可。真实环境配置另走受控渠道，不能放进提示词、截图或提交。代码、提交历史和操作文档随 GitHub 同步，生产数据库、生成素材、`.env` 与私钥不会随 clone 下载。

给接手开发者的任务说明可以是：

```text
请阅读 README.md、docs/operations/github-and-multi-device-deployment.md 和当前 Git 状态。
确认目标分支已包含远端最新提交；使用 codex/<任务名> 功能分支开发。
不要提交 .env、私钥、访问令牌、输出目录或临时快照。
完成后生成 Prisma Client、构建 shared，再运行 pnpm test、pnpm typecheck 和 pnpm build。
审查 diff，逐项添加文件，提交并 push 功能分支，返回分支、提交号与验证结果。
GitHub push 不等于生产部署；生产需合并 main 后独立执行发布与验收。
```

## 新电脑首次接入

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
git switch -c codex/my-task
pnpm install --frozen-lockfile
```

继续已存在的远端功能分支时，执行 `git fetch origin` 和 `git switch --track origin/codex/分支名`；本地已有该分支则 `git switch` 后 `git pull --ff-only`。离开旧电脑前先 push，单独 commit 不能让其他电脑获得进展。

本地运行需要 Docker、独立开发数据库与 `.env`。首次配置、启动和冲突处理见 [跨设备指南](./github-and-multi-device-deployment.md)。不要把本地 `.env` 指向生产数据库。使用图形界面可启动 [Git Workbench](../../tools/git-workbench/README.md)，左侧「操作手册 · 换电脑」也可离线阅读；无需安装 Codex。

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

GitHub CI 还运行隔离 PostgreSQL / Redis 集成测试和生产镜像检查，不能仅凭本地单元测试代替。冲突需要理解双方业务改动后再合并，不要强推共享分支或丢弃未确认文件。完整需求通过 PR 合并 main 后才进入发布队列。

## 新设备的服务器权限

仅开发和 push GitHub 不需要服务器权限；发布者需要设备专属 SSH 公钥授权。新电脑自己生成密钥，私钥留在新电脑，只将 `.pub` 公钥交给管理员。不要让管理员分发共用私钥。

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

首次升级必须由管理员按 [部署升级说明](../../deploy/UPGRADE.md) 安装新版 hook；仓库代码不会自动替换已经安装的 hook。合并 PR 后，在干净项目目录中执行：

```bash
git switch main
git pull --ff-only origin main
pnpm deploy:server --check
pnpm deploy:server
```

`--check` 是只读连通性和提交一致性检查，不会构建，也不证明服务器写权限或业务通过。正式发布验证本地代码后，服务器串行执行经过校验的备份、镜像构建、非破坏 schema 同步、API 就绪检查与前端更新。`main` 是服务器收到的提交，`deployed` 是通过发布就绪检查的提交；Git push 成功不等于部署成功。

同一提交失败后，先由管理员检查 `/opt/manjiao-deploy-logs/` 并修复原因，再运行 `pnpm deploy:server --retry`。代码回退优先通过 revert PR 发布新提交；自动源码恢复不会恢复数据库和客户素材。`RECOVERY_FAILED` 不能视作已恢复。

旧的 `一键发布到服务器.bat`、`pnpm ship:server` 与 `deploy/deploy_to_manjiao.bat` 已转到统一入口，不能跳过 GitHub main，也不再替你提交代码。不要根据旧版本文档绕过 GitHub 直接发布。GitHub 不可用时保留本地工作，恢复连通后继续审查与推送。

发布后完成 [发布验收单](./release-acceptance.md)，包括真实任务、积分、私有媒体、导出和后台运营流程。只在证据完整时记录“已部署并验收”。

## 每次交接记录

- 分支、GitHub PR、最后提交号与服务器 deployed 提交号。
- 已完成行为、遗留问题、测试命令及结果。
- 是否已发布、验收人、验收时间、备份和日志路径。
- 涉及 schema 或环境配置的变更、兼容性和恢复步骤。

不在交接记录中包含任何密钥、令牌、真实客户数据或备份内容。
