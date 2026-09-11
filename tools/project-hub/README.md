# Project Hub：服务器上的多项目同步平台

入口为 `https://manjiao.cloud/ops/`。平台使用独立管理员登录，管理自己的 GitHub 仓库工作副本、分支、差异、提交、推送和服务器发布。上一个 `tools/git-workbench` 便携工具继续用于本机；服务器版不要求换电脑后复制整个平台。

## 一次完整迭代

1. 在新电脑登录 GitHub，克隆仓库并拉取最新 main，创建需求分支。
2. 用 AI 与编辑器开发，检查差异，运行项目测试，然后提交并推送需求分支。
3. 在 GitHub 创建 PR，检查 CI、差异及实际效果，通过后合并 main。
4. 打开服务器平台，选择该项目，切换 main、拉取，再核对提交号。
5. 已配置发布目标的项目可提交发布；查看日志与部署版本核对结果。Git 接收代码并不代表应用已更新。

AI 开发仍在本机或 Remote SSH 开发副本中进行。平台提供同步、审查及发布管理，不内置浏览器 AI 编码器，也不会自动解决 Git 冲突。不要在生产运行目录直接让 AI 改文件。

## 接入更多项目

登录后填写项目名称和 `https://github.com/账号/仓库`，平台会建立独立工作副本。仓库必须是当前服务器 GitHub 登录能够访问的仓库。每次操作明确选择项目，不会切换其他项目的分支；不同项目的任务互不混用。

新增项目默认可同步 GitHub。发布目标需要管理员在服务器私有 `config.json` 的 `deployments` 中按仓库地址配置，不能通过网页输入任意命令。每个项目需先具备自己的测试、备份、发布 hook 与就绪接口，再配置 `remote` 和 `verifyUrl`。服务器不会根据仓库内容自动执行安装或任意 shell 脚本。

漫角的发布流程使用该仓库 `deploy/UPGRADE.md` 所述 hook。其他项目只有配置了对应服务，才可实现发布闭环。网页会区分“已推送，待核验”和“线上版本已验证”，未核验时不要继续重复发布。

## 换电脑

服务器平台直接使用浏览器登录，无需迁移 GitHub token、SSH 私钥或服务端项目目录。开发电脑仍需安装 Git、Node.js 24、项目依赖和 AI 开发工具；按仓库手册运行。离开旧电脑前必须完成 push，单独 commit 不会上传。

两台电脑共同修改分支时，先保存本机改动，再 fetch/merge 并逐项处理冲突、测试和推送。避免强推覆盖另一台电脑的提交。项目 `.env`、数据库和生成媒体独立管理，不通过 Git 传播。

完整使用说明在平台侧栏“操作手册”。便携工具说明见 `../git-workbench/README.md`。

## 服务器管理员配置

配置契约见 [API.md](API.md)。生产目录为 `/opt/project-hub/config`、`data`、`workspaces`、`releases`。配置与令牌 mode 600，目录 mode 700，容器 UID/GID 10001。镜像没有 Docker socket，根文件系统只读，仅数据和项目工作副本可写，端口只绑定主机 loopback，经 Caddy 的 `/ops/` 路由访问。

GitHub token 从现有授权登录经安全输入存入 `config/github-token`，不得写入仓库、网页或命令参数。发布使用专用 Git-only SSH 密钥及已核对的主机公钥。停用一台旧开发电脑不影响服务器平台；撤销服务器平台时同时删除其 GitHub 授权与服务器专用公钥。

首次密码由部署过程随机生成，个人交付文件保存在本机忽略目录中。平台不提供默认公共密码。修改密码时通过安全标准输入调用 `auth.mjs` 的 `hashPassword`，只更新私有配置中的 `passwordHash` 并重启平台；旧会话随重启失效。配置样例不能包含真实 token 或私钥。

## 发布平台自身

以已通过检查的提交构建 `deploy/project-hub/Dockerfile`，镜像标签使用提交号；设置 `PROJECT_HUB_RELEASE` 后运行对应 Compose。升级前备份私有配置、数据与未提交工作副本，保留旧镜像。失败时恢复上一个镜像标签；不要删除挂载卷。

首次安装 Caddy 路由使用 `deploy/project-hub/install_caddy_route.py` 生成候选，再执行 Caddy validate、备份原配置并原子替换、reload。脚本遇到未知现有路由会拒绝覆盖，必须先检查。不要直接把便携工具的 localhost token 页面反向代理到公网。

## 验证

```sh
node --test tools/project-hub/projectHub.test.mjs
python3 -m unittest discover -s deploy/project-hub -p test_caddy_route.py -v
docker build -f deploy/project-hub/Dockerfile -t project-hub-verify .
```

本地测试覆盖真实隔离 Git 仓库、认证、CSRF、多项目与任务隔离、提交文件范围、远端跟踪及版本核对。生产还需要验证实际 GitHub clone/push、已配置服务器发布和浏览器使用；测试未完成的项目不得标注为已验收。
