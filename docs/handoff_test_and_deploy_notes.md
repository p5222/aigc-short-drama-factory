# 漫角落地测试与部署差距说明

更新时间：2026-06-30

## 本次已落地

- 前台首页登录页：复刻 U 漫登录页骨架，保留本地循环视频背景；左侧内容扩大到首屏左侧约 45%；登录卡降低黑色透明度；输入框改为浅蓝白底深色文字；按钮为红色主按钮。
- 首页模型图标：改为圆底托 + 模型名称，目前只展示 OpenAI、Claude、Gemini、DeepSeek，删除通义/豆包占位展示。
- 后台登录页：浅蓝全屏背景、白色登录卡、白色输入框、蓝色主按钮，默认管理员提示保留。
- 通义千问生图：`qwen-image/qwen-image-plus` 改为 DashScope 异步生图接口 `text2image/image-synthesis`，提交后轮询 `/tasks/{task_id}`，拿到真实 `results[].url` 后再保存到本地 `/storage/images`。
- 真实生图防假成功：分镜图、单镜头重生、角色参考图如果走真实渠道但没返回图片 URL，会直接报错，不再自动落 mock/SVG 占位图。
- 分镜 JSON 修复：对模型返回的分镜 JSON 增加清理控制字符、去尾逗号、自动补齐括号/引号的解析兜底，降低坏 JSON 报错概率。
- 数据清理能力：新增 `POST /api/projects/prune-to-latest`，登录后可只保留当前用户最新作品，删除旧项目及其任务/流水关联，不动用户、模型、套餐、兑换码。
- 目录清理：删除临时 dev 日志，保留唯一启动脚本 `start_admin_server.bat`。

## 启动与测试地址

一键启动：

```bat
E:\AI漫剧\start_admin_server.bat
```

启动成功后打开：

- 前台：`http://localhost:5173`
- 后台管理：`http://localhost:5173/admin`
- API 健康检查：`http://localhost:4000/health`
- 数据库/Redis 检查：`http://localhost:4000/api/system/health/dependencies`

测试账号：

- 前台创作者：`demo@aifilm.local / demo123456`
- 后台管理员：`admin@aifilm.local / admin123456`

前台首页像素微调：

- 打开 `http://localhost:5173/?layout=1`
- 可调左侧文案 X/Y、标题字号、整体缩放、模型间距、登录框 X/Y/宽度。
- 数值保存在当前浏览器 localStorage。

## 推荐测试流程

1. 启动 `start_admin_server.bat`。
2. 打开前台，使用 demo 账号登录。
3. 进入“新建漫剧”，输入样例故事，确认全局设定。
4. 先生成“核心剧情/剧本/角色卡”。
5. 进入项目生产台，按“下一步”依次生成分镜表、角色参考图、分镜图、视频草稿。
6. 进入“分镜图画廊”，检查图片是否是真实 `/storage/images/*.png` 或上游 URL，而不是 SVG/mock。
7. 打开后台，测试用户积分、兑换码批量生成、模型渠道启停、模型连接测试。
8. 如需清理旧测试作品，登录前台后调用 `POST /api/projects/prune-to-latest`，或后续在后台加按钮调用该接口。

## 本次验证结果

- `pnpm --filter @aifilm/api typecheck`：通过
- `pnpm --filter @aifilm/api build`：通过
- `pnpm --filter @aifilm/web typecheck`：通过
- `pnpm --filter @aifilm/web build`：通过
- 前台 UI 计算样式验证：登录输入框为浅蓝白底深色字，红色按钮；左侧内容约 45%；模型图标 4 个带圆底托和名称。
- 后台 UI 计算样式验证：浅蓝背景、白卡、白输入框、蓝色按钮。

## 当前模型测试结论

- 通义千问/Qwen Image：当前 `.env` 里 `DASHSCOPE_API_KEY` 为空，所以真实生图测试失败原因是 `Missing DASHSCOPE_API_KEY`。填入阿里云百炼 DashScope Key 后再测。
- DeepSeek：当前 `.env` 里 `DEEPSEEK_API_KEY` 为空，所以文本测试进入本地结构化生成器；填入 Key 后会走真实 DeepSeek。
- Gemini：`.env` 里有 `GEMINI_API_KEY`，但本机访问 `https://generativelanguage.googleapis.com` 超时，属于网络/代理访问问题。需要开启可访问 Google API 的代理，或把 `GEMINI_BASE_URL` 改成可用中转地址。
- Docker Desktop：当前 Docker engine 返回 API 版本 500 错误，导致 Postgres/Redis 不能启动。需要重启 Docker Desktop 或更新/修复 Docker Engine 后再跑完整数据库流程。

## 部署上线前待完成

- 修复 Docker Desktop/部署环境的 Postgres、Redis、对象存储可用性。
- 在生产 `.env` 配置真实 `DEEPSEEK_API_KEY`、`DASHSCOPE_API_KEY`，如需 Gemini 则配置可访问 Google API 的网络或中转。
- 后台补一个“清理旧作品，只保留最新作品”的可视化按钮，调用已存在接口。
- 真正接入视频 Provider，目前视频草稿仍是占位资产。
- TTS、字幕、FFmpeg 合成导出还未接入。
- 支付/订单/发票/充值回调还未接入，当前是后台手动积分和兑换码体系。
- 管理员权限分级已有后端雏形，仍需在后台 UI 上按角色隐藏/禁用模块。
- 日志监控、队列失败重试、备份脚本已有基础能力，生产环境还需接入定时任务和可视化告警。
- sub2api 风格统一网关目前是策略预览与数据结构，完整兼容 `/v1/chat/completions`、`/v1/images`、`/v1/videos` 还需继续开发。
