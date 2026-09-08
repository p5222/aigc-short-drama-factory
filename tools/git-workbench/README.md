# Git Workbench 便携版

在 Windows、macOS、Linux 上运行的本地 GitHub 项目工作台。无 npm 依赖，无需安装到 Codex。整个文件夹可复制到其他电脑。

## 完整操作手册

启动工具后，在左侧点击「操作手册 · 换电脑」，或打开 http://127.0.0.1:4318/manual 。未启动时也可直接双击 public/handbook.html 离线阅读。手册包括旧电脑提交、新电脑安装与登录、克隆、接续分支、运行项目、SSH 公钥授权、服务器发布和故障排查。

## 新电脑第一次使用

1. 安装 Git、Node.js 24 和 GitHub CLI。
2. 在终端执行 gh auth login、gh auth setup-git，登录有仓库权限的 GitHub 账号。使用 git config --global user.name "你的名字" 和 git config --global user.email "提交邮箱" 配置提交身份。
3. Windows 双击 start-windows.bat。macOS / Linux 在本目录运行 sh start-unix.sh。
4. 浏览器打开 http://127.0.0.1:4318 ，使用期间保留启动终端，Ctrl+C 停止。
5. 输入本地项目的绝对路径打开已有项目；或填入 GitHub HTTPS 地址与一个尚不存在的新文件夹路径，点击克隆。

也可以执行 node server.mjs /绝对路径/项目，启动时直接连接该项目。端口冲突时设置 PORT 环境变量，启动日志会显示实际地址。

## 每次迭代

切换 main → 拉取当前分支 → 创建 codex/需求名 → 在编辑器修改和测试 → 刷新状态 → 逐个预览、勾选文件 → 填写提交说明 → 提交 → 推送 → 打开 GitHub PR 页面审查并合并。

工具仅显示本地分支。要接手另一台电脑创建的远端分支，先在终端执行 git fetch origin 和 git switch --track origin/分支名，再刷新工具。它不提供代码编辑器、测试运行器、自动解决冲突、自动合并或服务器部署按钮。

只有干净工作区才能切换 / 创建分支和拉取；不会清空未提交文件。有既存暂存内容或冲突时，请在编辑器 / Git 客户端处理。主分支不能在工具里直接提交或推送，采用 PR 合并。网络认证失败时在终端完成 GitHub 登录或 SSH 密钥解锁，再回到工具重试。

文件预览 / 提交上限 5 MB；环境配置与常见密钥文件被保护；凭据格式扫描不能代替人工审查。该工具通过本机 Git 执行命令，因此只打开你信任的仓库，其 Git hooks 和 Git 配置仍会生效。无需把 PAT、密码或私钥填入网页。不要向工具目录复制 .env 或 .ssh。

仅绑定 127.0.0.1，拒绝跨站 API 请求，所有 API 使用每次启动生成的令牌。不要把这个管理工具部署到公网服务器。每台电脑运行自己的副本即可。运行时不保存仓库路径或登录凭据到便携目录。

## 漫角服务器发布

GitHub 拉取 / 推送不等于生产上线。合并 PR 后，已授权发布设备在项目终端执行：

    git switch main
    git pull --ff-only origin main
    pnpm deploy:server --check
    pnpm deploy:server

新电脑的 SSH 公钥授权步骤见项目 docs/operations/github-and-multi-device-deployment.md。生产数据、素材和环境密钥不通过 Git 同步。

## 网络代理（按需）

如果本机 Git 直连 GitHub 不稳定，可只为本次启动设置 HTTPS_PROXY 环境变量。代理端口使用你自己电脑上的设置。

PowerShell：

    $env:HTTPS_PROXY = 'http://127.0.0.1:7890'
    node server.mjs

macOS / Linux：

    HTTPS_PROXY=http://127.0.0.1:7890 node server.mjs

研发流程参考：[GitHub flow](https://docs.github.com/en/get-started/using-github/github-flow)。
