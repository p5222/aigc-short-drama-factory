# Project Hub API v1

服务公开前缀固定 `/ops/`，API `/ops/api`。这是项目同步、审查与发布平台；代码编辑仍使用本机或 Remote SSH 工作副本。

## 私有配置（不经 API 返回）

`PROJECT_HUB_CONFIG_FILE=/config/config.json`：

```json
{
  "publicOrigin": "https://example.com",
  "username": "admin",
  "passwordHash": "scrypt$16384$8$1$BASE64_SALT$BASE64_HASH",
  "workspaceRoot": "/workspaces",
  "dataDir": "/data",
  "trustedProxyAddresses": [],
  "gitIdentity": { "name": "Project Hub", "email": "your-github-noreply@example.com" },
  "deployments": [
    { "githubUrl": "https://github.com/OWNER/REPO", "remote": "ssh://git@example.com/~/manjiao.git", "verifyUrl": "https://example.com/public/ready" }
  ]
}
```

监听 `BIND_HOST=127.0.0.1`、`PORT=4319`；容器可 `BIND_HOST=0.0.0.0`。GitHub 凭据仅由 `PROJECT_HUB_GITHUB_TOKEN_FILE` 读入 Git 网络子进程的 `GH_TOKEN`；固定 `gh auth git-credential` helper。可设 `PROJECT_HUB_SSH_CONFIG_FILE=/config/ssh/config`，发布只使用私有配置内 remote。摘要可由 `auth.mjs` 的 `hashPassword(password)` 生成（不要把明文密码作为 shell 参数）。registry/jobs/audit 持久化在 dataDir；所有工作副本只存于 workspaceRoot/项目 UUID。首次运行 registry 为空，UI 克隆注册项目；相同仓库可有多个独立工作副本。

经 Caddy 代理时，`trustedProxyAddresses` 填入实测的 Docker bridge 网关 peer 地址（最多 8 个明确 IP，不接受通配或整个私网）。只有请求来自这些 peer，才读取 Caddy 必须覆盖设置的 `X-Project-Hub-Client-IP`；缺失或无效时拒绝登录。其他 peer 的转发头一律忽略。每个真实客户端地址独立限速，15 分钟最多 10 次失败尝试，最多同时 4 次密码计算；没有可被未登录流量触发的全站 15 分钟锁定。

## 认证

- `POST /auth/login` `{username,password}` → `{authenticated:true,csrfToken,username}`。不需要 CSRF，但必须带精确匹配 publicOrigin 的 `Origin`。
- `GET /auth/session` → `{authenticated:false}` 或 `{authenticated:true,csrfToken,username}`。
- `POST /auth/logout` `{}` → `{ok:true}`。
- 所有其余接口要求会话，未认证 `401 {error}`。所有 POST 必须 `Content-Type: application/json`、精确 Origin（不接受缺失/跨域），登录外还须 `X-CSRF-Token`。浏览器默认同源 Cookie。Cookie HttpOnly / SameSite=Strict，HTTPS 时 Secure；会话 8 小时。

## 项目与操作

- `GET /projects` → `{projects:[{id,name,githubUrl,createdAt,deployEnabled}],jobs:[Job]}`（jobs 最近 30 条）。不返回服务器路径/凭据。
- `POST /projects` `{name,githubUrl}` → `202 {project,job}`。只接受无凭据的 github.com HTTPS；服务生成 UUID 后异步 clone。clone 失败保留项目并显示失败任务，可执行 `clone` 重试。
- `GET /projects/:id/status` → `{project,branch,head,upstream,ahead,behind,branches:[string],remoteBranches:[string],files:[{name,code,blocked,original?}],clean,prUrl,lastDeployment:{deployment,commit,verification?}|null,job:Job|null}`。lastDeployment 来自持久记录，不受最近 30 条任务窗口限制。remoteBranches 去除 `origin/` 前缀，prUrl 用于打开 GitHub PR 页面。仓库尚未克隆返回 `409 {error}`。
- `GET /projects/:id/diff?file=...` → `{diff}`。只预览已改变且不属于密钥/环境配置的文件，最大 120 KB。项目正在操作时返回 409。
- `POST /projects/:id/actions` `{action,...}` → `202 {job}`。同一项目只能有一个任务，冲突 409。全部动作必须明确项目 UUID。

| action | 额外字段 | 规则 |
|---|---|---|
| clone | 无 | 仅重试尚未成功的克隆 |
| fetch | 无 | 刷新 origin 分支 |
| pull | 无 | 工作区干净，当前分支 fast-forward only |
| branch | branch | 工作区干净，基于 HEAD 创建功能分支 |
| switch | branch | 工作区干净；支持已有本地分支或 origin 同名跟踪分支 |
| commit | files:string[], message:string | 功能分支；仅选择的 1–200 个文件，预存暂存/冲突拒绝；凭据扫描 |
| push | 无 | 功能分支推送 origin，禁止 main/master 主线，随后用 prUrl 提 PR |
| deploy | expectedCommit?:string | UI 传确认时的完整 HEAD；服务端核对未变化。必须配置发布目标；干净 main，fetch 后 HEAD 完全等于 origin/main；仅推送该提交到配置的服务器 main |
| retryDeploy | expectedCommit:string | 必须独立确认，且完整 HEAD 等于此前 accepted 记录及服务器 main；推送唯一 deploy-requests ref 触发同版本重试。此前 verified、缺失确认或服务器 main 已变化均拒绝 |
| verify | 无 | 仅 GET 私有配置固定健康 URL，核对已提交部署版本，不重新部署 |

- `GET /jobs/:id` → `{job}`。
- `GET /projects/:id/audit` → `{entries:[{id,projectId,action,status,createdAt,finishedAt?,message?}]}` 最近 100 条，不含路径/凭据或提交内容。

`Job={id,projectId,action,status:'running'|'succeeded'|'failed'|'interrupted',createdAt,finishedAt?,log,result?}`。
`result` 普通操作 `{message}`；发布 `{message,deployment:'accepted'|'verified',commit,verification?,retryRef?}`。接受 Git 推送只代表 accepted；只有服务器 main 与 deployed ref 都等于该完整提交、重试请求 ref 已被 hook 删除、健康端点 HTTP 成功且 JSON `ok:true`、完整 40 位 revision 精确匹配时才 verified。版本字段兼容 `revision`/`commit`/`gitCommit`/`version`/`build.commit`/`deployment.commit`。未配置/未匹配均不能显示部署成功；之后可 verify。待确认的重试 ref 会持久保留在发布记录中，不能用此前同版本的健康响应冒充本次重试成功。

普通 deploy 发现服务器 main 已接受相同提交但 deployed 尚未确认时，会拒绝再次做无效的 up-to-date 推送；应先检查服务器发布日志、修复原因，再显式确认 retryDeploy。服务端脚本只在成功后删除本次 `refs/heads/deploy-requests/<时间戳>-<UUID>`，Hub 不自行删除失败请求或变更服务器 deployed ref。

错误统一 `{error:string}`，400 输入错误，401 未登录，403 Origin/CSRF，404 未知项目/路径，409 状态冲突，429 登录限速。重启后未完成任务标为 interrupted，审计持久保留，用户重新检查状态后选择安全动作。
