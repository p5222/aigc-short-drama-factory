# 开发状态记录

## 已完成

- 建立 monorepo 工程。
- 建立 `apps/web` 前端应用。
- 建立 `apps/api` 后端 API。
- 建立 `packages/shared` 共享业务类型。
- 建立 Docker Compose 依赖：PostgreSQL、Redis、MinIO。
- 完成 U 漫式前台页面：
  - 工作台
  - 创作向导
  - 我的剧本
  - 剪辑中心
  - 任务中心
  - 积分充值
  - 积分明细
  - 设置
  - 帮助中心
  - 后台管理
- 完成 API 占位：
  - 工作台数据
  - 项目列表
  - 创作估算
  - 创建项目
  - 任务中心
  - 积分账户
  - 积分流水
  - 套餐
  - 模型供应商
  - 提示词模板
  - 后台总览
- 完成 MVP 内容生成流水线：
  - 有 `DEEPSEEK_API_KEY` 或 `OPENAI_COMPATIBLE_API_KEY` 时调用真实 OpenAI-compatible/DeepSeek 模型。
  - 未配置 key 时使用本地结构化生成器，保证策划、剧本、角色、资产、分镜全链路跑通。
  - 生成后自动进入项目生产台。
- 完成项目生产台：
  - AI 剧本
  - 角色一致性资产
  - 资产库
  - 镜头级分镜表
- 完成前端主题升级：
  - 默认浅色柔和视觉。
  - 支持浅色/深色切换。
  - 浅色主题采用更适合女性用户的柔和粉、薄荷绿、淡紫与白色工作台组合。
- 完成 Toonflow 复用策略文档。
- 完成 Excel 分镜导入模板。
- 完成模型路由与计费骨架：
  - `model_providers` 供应商目录。
  - `model_prices` 模型计费表。
  - 创作向导支持文本模型选择。
  - 后台管理展示模型列表和模型计费项。
- 完成真实 DeepSeek 文本模型连通验证。
- 完成分镜图 mock 生成闭环：
  - 余额预检查。
  - 新增资产数统计。
  - 积分扣费流水。
  - 重复生成不重复创建资产，不重复扣费。
- 完成视频草稿 mock 生成闭环。
- 完成任务中心筛选真实生效。

## 已验证

- `pnpm install` 通过。
- `pnpm typecheck` 通过。
- `pnpm build` 通过。
- `pnpm --filter @aifilm/api db:push` 通过。
- API 健康检查通过：`http://localhost:4000/health`。
- 模型计费表接口通过：`http://localhost:4000/api/model-prices`。
- DeepSeek 模型测试通过：`deepseek-v4-pro`。
- Web 首页可访问：`http://localhost:5173`。
- 浏览器首屏渲染正常。
- 创作向导页面切换正常。
- 前端“样例故事 -> 生成 -> 项目生产台”流程通过。
- 接口“创建项目 -> 队列生成 -> 剧本/角色/资产/分镜落库”通过。
- 接口“生成分镜图 -> 新增图片资产 -> 扣费流水”通过。
- 接口“生成视频草稿 -> 新增视频资产 -> 项目计数”通过。
- 项目生产台可显示 AI 剧本、角色一致性资产、资产库和镜头级分镜表。
- 浏览器控制台无 error。

## 2026-06-28 更新

- 登录注册已改为真实数据库逻辑：注册写入 `users`，密码使用 `scrypt` 加盐哈希保存，不再明文存储；登录会校验密码并记录 `lastLoginAt`。
- 项目、任务、积分账户、积分流水已按登录用户隔离，创建项目、生成分镜图、生成视频草稿都会绑定当前用户。
- `projects` 已记录三条模型路由：`textProvider/textModel`、`imageProvider/imageModel`、`videoProvider/videoModel`。
- 创作向导已把模型选择拆成三段：内容生成、分镜生图、视频生成。
- 图片 MVP 默认改为 `dashscope-image + qwen-image`，`image2/gpt-image-2` 继续作为中转站高质量入口保留。
- 新增 `/api/settings/image-model-test`，可从前端测试图片模型连接并显示返回状态。
- 通义万相/DashScope 真实生图验证通过：`qwen-image` 可返回真实图片地址，测试耗时约 8.7s。
- 启动流程已调整：Docker 默认只启动 PostgreSQL + Redis，MinIO 进入 `storage` profile，避免对象存储镜像拉取失败阻断 MVP。
- 数据已做真假分离：运营配置种子在 `apps/api/src/seed/catalogData.ts`，演示数据在 `apps/api/src/seed/testData.ts`，可用 `SEED_DEMO_DATA=false` 关闭演示项目写入。
- 后台管理已支持编辑套餐、模型供应商启停/模型列表/说明、模型计费单价；保存后前端重新读取数据库。
- 生成扣费开始读取后台价格：文本生成和分镜生图优先使用 `model_prices` 中启用的积分单价。

## 2026-06-29 计费与后台闭环更新

- 计费口径改为人民币 1:1 积分，不再按美元倍率放大。
- 默认价格已降为：
  - `deepseek-v4-flash`：4 积分 / 次
  - `deepseek-v4-pro`：8 积分 / 次
  - JXB DeepSeek：5 积分 / 次
  - `gpt-5.5`：30 积分 / 次，作为高质量/专业模式
  - 豆包 Seedream / Qwen Image：8 积分 / 张
  - `gpt-image-2`：30 积分 / 张，成本参考 0.31 元
- 前台默认模型改为低成本闭环：DeepSeek flash + 豆包 Seedream，保留 `gpt-5.5` 和 `gpt-image-2` 作为专业模式入口。
- 新增兑换码体验额度：
  - `TRIAL300`
  - `CREATOR1000`
- 新增会员方案配置：月度额度 + 权益折扣 + 优先队列，不做无限量。
- 后台新增用户积分手动调整，调整后写入积分流水，适合线下收款入账、测试闭环和人工补偿。
- 后台新增兑换码、会员方案、套餐、供应商、模型单价的统一配置页。
- 后台生图测试会返回分镜测试图预览 URL，不再隐藏图片结果。
- 真实 provider 失败不再自动 fallback 到 mock 并扣费；只有明确 mock provider 才生成本地占位图。
- 新增 `start_admin_server.bat`，一键启动 PostgreSQL、Redis、API 和 Web/Admin。

## 本次已验证

- `pnpm typecheck` 通过。
- `pnpm build` 通过。
- `pnpm --filter @aifilm/api db:push` 通过。
- API 健康检查通过：`http://localhost:4000/health`。
- 后台 API 闭环通过：会员方案、兑换码、用户列表、模型计费表均能从数据库读取。
- 后台手动充值通过：demo 用户加 1 积分后，前台账户余额同步变化。
- DeepSeek 文本模型真实连接通过。
- `gpt-5.5` 文本模型真实连接通过。
- DashScope / Qwen Image 使用分镜 prompt 真实返回图片 URL。
- 完整低成本闭环通过：创建项目 -> 真实文本生成剧本/角色 -> 生成 9 条分镜 -> 真实生图 1 张入库 -> 扣费 8 积分。
- 当前中转站图片测试结果：
  - `jxb-image + gpt-image-2` 返回 401，当前本地未配置可用 JXB 图片 Key。
  - 已删除 `relay-image + gpt-image-2` 渠道，`gpt-image-2` 统一走 `jxb-image` 独立图片 Key。
  - 代码路径已能真实暴露上游错误，不会被 mock 掩盖。

## 当前边界

- 视频生成使用 mock。
- 图片生成已支持真实 DashScope；本地 `.env` 需要填写 `DASHSCOPE_API_KEY`，建议 MVP 使用 `qwen-image` 小批量测试。
- 积分支付为演示逻辑，真实支付后续接入。
- Docker Compose 默认启动 PostgreSQL、Redis；MinIO 为可选对象存储，命令为 `docker compose --profile storage up -d minio`。
- 后台模型价格、套餐、供应商、兑换码、会员和用户积分调整已支持页面内编辑；真实支付订单仍是下一阶段。
- Auth 仍是 MVP 级 token：用户、密码和业务数据已入库，但服务重启后需要重新登录；后续可替换为 JWT/Redis Session。
- TTS、字幕、FFmpeg 合成导出还未接入。

## 下一阶段优先级

1. 后台手动充值：完成积分增减和流水管理页。
2. Excel 分镜表导入解析。
3. 分镜表行内编辑，编辑后重新生成单镜头图片/视频。
4. 角色参考图真实生成，把 Toonflow 式角色一致性资产链路完整做出来。
5. ComfyUI Provider：作为高级模式接入。
6. 图生视频 Provider：接入真实视频模型并按秒计费。
7. TTS + 字幕 + FFmpeg 合成导出。
8. 后台角色权限、JWT/Redis Session、管理员用户管理。
