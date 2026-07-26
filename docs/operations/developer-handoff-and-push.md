# 新电脑与开发智能体接手指南

本仓库的远端是 `https://github.com/p5222/aigc-short-drama-factory.git`。代码、提交历史和交接文档都应进入 GitHub；真实密钥只保存在本机或服务器环境变量中，禁止提交 `.env`、私钥或访问令牌。

## 1. 给开发者或智能体什么

提供以下信息即可，不需要复制旧 Codex 的聊天记录：

- GitHub 仓库地址
- 要继续开发的分支名和目标需求
- 本文档路径：`docs/operations/developer-handoff-and-push.md`
- 需要联调时，单独通过安全渠道提供 `.env` 所需密钥，不能放进提示词、提交或截图

推荐提示词：

```text
请克隆 https://github.com/p5222/aigc-short-drama-factory.git，阅读 README.md、
docs/operations/developer-handoff-and-push.md 和当前 git 状态。基于最新远端分支开发，
不要提交 .env、密钥、输出目录或本机工具目录。完成后运行 pnpm test、pnpm typecheck、
pnpm build，review diff，提交并 push 到 codex/<任务名> 分支，然后返回 commit 和分支名。
```

## 2. 新电脑首次接入

安装 Git、Node.js 24+、pnpm 11+ 和 GitHub CLI，然后执行：

```powershell
gh auth login
gh auth setup-git
git clone https://github.com/p5222/aigc-short-drama-factory.git
cd aigc-short-drama-factory
pnpm install --frozen-lockfile
git switch -c codex/<task-name>
```

GitHub 账号必须是仓库协作者，或使用有仓库写权限的组织账号。验证权限：

```powershell
gh auth status
git remote -v
git push -u origin HEAD
```

若不希望共享个人账号，在 GitHub 仓库 `Settings > Collaborators` 邀请每位开发者自己的账号。不要多人共用 PAT。服务器部署权限与 GitHub 推送权限分开管理。

## 3. 每次开发与推送

最短路径（仅修改已跟踪文件时）：

```powershell
pnpm push:safe -- "feat: describe the change"
```

该命令自动运行测试、类型检查、构建、diff 检查、提交和 push。发现未跟踪文件时会停止，先用 `git add <明确的新文件>` 确认后再运行。

```powershell
git fetch origin
git switch <branch>
git pull --ff-only
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
git status --short
git diff --check
git add <明确的文件列表>
git commit -m "feat: describe the change"
git push -u origin HEAD
```

不要使用 `git add .` 或 `git add -A` 代替审查。提交前检查 `git status`，确认没有 `.env`、密钥、`output/`、设计插件副本、服务器快照或临时文件。

## 4. 合并与默认分支

日常开发推送到 `codex/<task-name>`。通过 Pull Request review 后合并到 `main`：

```powershell
gh pr create --fill --base main --head codex/<task-name>
```

新环境默认克隆 `main`，所以可交付功能最终必须合并到 `main`；仅推送功能分支不等于完成发布。

## 5. 生产服务器部署

GitHub 推送成功不等于生产上线。生产部署需要单独的 SSH 私钥或服务器管理员授权。Windows 环境应配置 `~/.ssh/config`：

```sshconfig
Host manjiao
  HostName 43.139.101.102
  User ubuntu
  IdentityFile ~/.ssh/manjiao_tencent
  IdentitiesOnly yes
```

先验证：

```powershell
ssh manjiao "echo SSH_OK"
```

生产部署只接受干净、已提交、已推送的当前分支：

```powershell
.\deploy\deploy_to_manjiao.bat
```

脚本会执行本地验证、推送、服务器备份、上传、重建、健康检查和失败回滚。SSH 私钥必须由服务器管理员逐人发放；离职或设备丢失时从服务器 `~/.ssh/authorized_keys` 删除对应公钥。

GitHub 不可用时的最短交付路径：

```powershell
pnpm ship:server -- "feat: describe the change"
```

该命令会提交已跟踪改动、push 到服务器私有 Git 仓库并部署生产。新文件需先执行 `git add <文件>`。其他电脑可直接获取服务器最新代码：

```powershell
git clone manjiao:/opt/git/aigc-short-drama-factory.git
```

服务器 Git 的 `main` 始终对应最近一次成功发起的服务器交付；GitHub 恢复后执行 `git push origin main` 完成同步。

### 新设备首次授权

新设备运行公开的接入脚本，生成设备专属 key：

```powershell
.\scripts\bootstrap_manjiao_git.ps1
```

把输出的 `.pub` 公钥文件安全地发给服务器管理员。管理员在已授权电脑运行：

```powershell
.\scripts\grant_manjiao_git_access.ps1 -PublicKeyFile C:\path\device.pub
```

授权后，新设备重新运行并直接 clone：

```powershell
.\scripts\bootstrap_manjiao_git.ps1 -CloneTo D:\aigc-short-drama-factory
```

该 key 被强制限制为 Git 命令，不能获得服务器终端、端口转发或任意命令权限。push `main` 后服务器 hook 自动部署并检查健康状态。

## 6. 最小交接记录

每次交接至少说明：当前分支、最后 commit、已完成内容、未完成内容、测试结果、是否已部署、生产备份目录。不要用聊天记录替代仓库内文档和 commit。
