# Project Hub：服务器上的多项目同步平台

生产入口：[https://manjiao.cloud/ops/](https://manjiao.cloud/ops/)。平台管理员账号为 `p5222`；密码独立私密交付，不是 GitHub 密码，不写入文档或仓库。代码仓库为 GitHub 私库 [p5222/aigc-short-drama-factory](https://github.com/p5222/aigc-short-drama-factory)。

平台管理服务器上的 GitHub 仓库工作副本、分支、差异、提交、推送和发布。新电脑只用网页同步或发布时，打开入口并登录即可，无需安装 Git，也无需复制生产密钥或整个工具。[在线操作手册](https://manjiao.cloud/ops/handbook.html) 可从侧栏“操作手册 · 换电脑”打开。原来的 [Git Workbench 便携工具](../git-workbench/README.md) 继续用于操作本机代码目录。

## 一次完整迭代

1. 在新电脑登录有仓库权限的 GitHub 账号，克隆仓库。接续已有功能分支时先 `git fetch origin`，再 `git switch --track origin/codex/分支名`；新需求从最新 `main` 创建 `codex/<任务名>`。
2. 用本机或 Remote SSH 中的 AI 与编辑器开发，检查差异，运行项目测试、类型检查和构建，然后提交并推送功能分支。旧电脑离开前必须完成 push。
3. 在 GitHub 创建 PR，查看 `Verify project` CI 的真实结果，审查差异与实际效果，通过后合并 `main`。CI 配置存在不代表本次检查已经通过。
4. 打开平台并选择正确项目，点击“刷新远端分支”，在下拉框选择 `main` 后点“切换分支”，再点“拉取当前分支”。每步等待任务完成，核对仓库、当前分支和提交号。
5. 对已配置发布目标的项目，点击“确认并发布 main”，核对完整提交并输入项目名称，再点“发布此提交”。工作区需干净，提交必须与 GitHub `main` 一致；平台绑定的是本次确认的提交。
6. 查看“操作记录与日志”。“服务器已接收代码，线上版本尚未核验”只表示接收成功；点击“核验线上版本”，等待“线上版本已核验”，再打开网站验收本次功能。

AI 开发仍在本机或 Remote SSH 开发副本中进行。平台提供同步、审查及发布管理，不内置浏览器 AI 编码器，也不会自动解决 Git 冲突。不要在生产运行目录直接让 AI 改文件。

## 接入更多项目

登录后点击侧栏“添加”，填写项目名称和 `https://github.com/账号/仓库`，再点击“添加并克隆到服务器”。仓库必须在服务器 GitHub 凭据的授权范围内；新电脑自己的 GitHub 登录不会自动改变服务器权限。若已有该项目，直接从侧栏选择；需要同仓库的另一个独立工作副本时再添加并用名称区分。每次操作明确选择项目，不会切换其他项目的分支；不同项目的任务互不混用。

新增项目默认可同步 GitHub。发布目标需要管理员在服务器私有 `config.json` 的 `deployments` 中按仓库地址配置，不能通过网页输入任意命令。每个项目需先具备自己的测试、备份、发布 hook 与就绪接口，再配置 `remote` 和 `verifyUrl`。添加或同步仓库时，Project Hub 不自动安装依赖或运行仓库脚本；发布时由服务器预先配置并审查过的 hook 执行该项目的构建和更新流程。

漫角的发布流程使用 [部署升级说明](../../deploy/UPGRADE.md) 所述 hook，就绪地址为 [https://manjiao.cloud/ready](https://manjiao.cloud/ready)。其他项目只有配置了可信 `remote`、`verifyUrl` 和对应服务，才可实现发布闭环。“核验线上版本”会检查服务器 `main`、`deployed` 与健康接口的完整提交一致，健康响应还需为 `ok: true`；同版本重试另需确认请求已被 hook 处理。HTTP 200 或 Git push 成功不能替代这些条件。

平台当前使用单一维护者账号，登录者可操作全部已注册项目，没有每项目成员权限。仅向可信维护者交付平台登录，不把它当作面向不同客户隔离权限的协作系统。

## 换电脑

仅使用服务器平台：新电脑浏览器访问 `/ops/`，用平台账号登录、选择已有项目；操作结束点击“退出登录”。无需迁移 GitHub Token、SSH 私钥或服务端目录，也无需为网页发布给这台电脑开 SSH 权限。

继续本机开发：电脑需要安装 Git、项目声明的运行时和 AI 开发工具。漫角使用 Node.js 24、pnpm 11.7.0；完整命令见 [跨设备指南](../../docs/operations/github-and-multi-device-deployment.md)。每个人使用自己的 GitHub 账号，需先获得私库权限。开发 `.env` 从样例建立并单独配置，生产环境变量、数据库和媒体留在服务器，不要复制生产密钥到新电脑。

使用 Remote SSH 开发：请管理员单独授权当前设备的开发 SSH 公钥和工作副本目录，私钥留在当前设备。平台登录、GitHub 权限、SSH 开发权限是三套独立授权；Git-only 发布密钥不能用于 Remote SSH。编辑器和网页要看到同一批改动，必须操作同一个经管理员确认的开发副本，不能把生产运行目录当开发目录。

两台电脑共同修改分支时，先保存本机改动，再 fetch/merge 并逐项处理冲突、测试和推送。避免强推覆盖另一台电脑的提交。项目 `.env`、数据库和生成媒体独立管理，不通过 Git 传播。

## 失败重试与回滚

请求超时或任务“已中断”时，先点“刷新记录”并重新读取状态，不直接重复提交。查清是否已部分执行；克隆失败可在原项目点“重试克隆”。

发布已接收但尚未核验时，先查看对应任务日志，再由服务器管理员检查构建、备份与就绪状态。原因修复后，如果当前完整提交与持久的待核验发布记录一致，点“重试同一版本发布”，再次输入项目名称并确认。重试同样需要核验成功；普通重复推送相同 `main` 不会重新触发 hook。

常规代码回滚：在新的 `codex/revert-<任务名>` 分支撤回问题改动，验证后通过 PR/CI 合并为新的 `main`，再使用平台发布并核验。平台没有一键回滚或强推按钮。数据库与客户素材不会随代码回滚，紧急恢复由管理员按 [部署升级说明](../../deploy/UPGRADE.md) 和备份计划操作。

## 服务器管理员配置

配置契约见 [API.md](API.md)。生产目录为 `/opt/project-hub/config`、`data`、`workspaces`、`releases`。配置与令牌 mode 600，目录 mode 700，容器 UID/GID 10001。镜像没有 Docker socket，根文件系统只读，仅数据和项目工作副本可写，端口只绑定主机 loopback，经 Caddy 的 `/ops/` 路由访问。

GitHub token 从现有授权登录经安全输入存入 `config/github-token`，不得写入仓库、网页或命令参数。发布使用专用 Git-only SSH 密钥及已核对的主机公钥。停用一台旧开发电脑不影响服务器平台；撤销服务器平台时同时删除其 GitHub 授权与服务器专用公钥。

首次密码由部署过程随机生成，个人交付文件保存在本机忽略目录中。平台不提供默认公共密码。修改密码时通过安全标准输入调用 `auth.mjs` 的 `hashPassword`，只更新私有配置中的 `passwordHash` 并重启平台；旧会话随重启失效。配置样例不能包含真实 token 或私钥。

## 发布平台自身

以已通过检查的提交构建 `deploy/project-hub/Dockerfile`，镜像标签使用提交号；设置 `PROJECT_HUB_RELEASE` 后运行对应 Compose。升级前备份私有配置、数据与未提交工作副本，保留旧镜像。失败时恢复上一个镜像标签；不要删除挂载卷。

首次安装 Caddy 路由使用 `deploy/project-hub/install_caddy_route.py` 生成候选，再执行 Caddy validate、备份原配置并原子替换、reload。脚本遇到未知现有路由会拒绝覆盖，必须先检查。不要直接把便携工具的 localhost token 页面反向代理到公网。

## 验证

```sh
node --test tools/project-hub/projectHub.test.mjs tools/project-hub/ui.test.mjs
python3 -m unittest discover -s deploy/project-hub -p test_caddy_route.py -v
docker build -f deploy/project-hub/Dockerfile -t project-hub-verify .
```

本地测试覆盖真实隔离 Git 仓库、认证、CSRF、多项目与任务隔离、提交文件范围、远端跟踪及版本核对。生产还需要验证实际 GitHub clone/push、已配置服务器发布和浏览器使用；测试未完成的项目不得标注为已验收。
