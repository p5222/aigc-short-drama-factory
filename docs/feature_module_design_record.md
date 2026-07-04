# 功能模块设计记录

这份文档用于后续复盘、答辩、项目经历包装和继续开发。每个模块都按以下结构记录：

- 目标：为什么需要这个模块。
- 当前实现：现在工程里已经怎么做。
- 关键代码：主要代码位置。
- 数据流：前端、后端、数据库、队列之间如何协作。
- 后续扩展：商业化版本还可以补什么。
- 项目讲法：后续介绍项目时可以怎么表达。

## 1. 总体产品闭环

### 目标

实现“输入小说/故事/脑洞/剧本/Excel 分镜表 -> AI 生成剧本 -> AI 生成角色卡 -> AI 自动分镜 -> 生成图片 -> 图生视频 -> 配音字幕 -> 合成导出”的 AIGC 漫剧/短剧生产闭环。

### 当前实现

当前 MVP 已跑通：

1. 创作向导输入内容。
2. 选择文本模型。
3. 估算积分。
4. 创建项目和生成任务。
5. BullMQ 队列调度文本生成。
6. DeepSeek 生成剧本、角色、分镜。
7. 生成结果写入 PostgreSQL。
8. 项目生产台展示剧本、角色、资产、分镜。
9. 分镜图 mock 生成并扣积分。
10. 图生视频 mock 生成视频草稿资产。
11. 后台管理展示模型供应商、模型计费表和模板。

### 关键代码

- 前端入口：`apps/web/src/App.tsx`
- 创作向导：`apps/web/src/pages/WizardPage.tsx`
- 项目生产台：`apps/web/src/pages/ProjectWorkbenchPage.tsx`
- API 入口：`apps/api/src/server.ts`
- 队列：`apps/api/src/queue/generationQueue.ts`
- 内容生成：`apps/api/src/agents/generator.ts`
- 数据库：`apps/api/prisma/schema.prisma`

### 项目讲法

这是一个 Web SaaS 形态的 AI 短剧生产平台，核心不是单点生成，而是把内容、角色、分镜、资产、任务队列、积分计费和后台管理串成完整生产流程。

## 2. 创作向导模块

### 目标

支持多种输入来源，让用户从故事素材快速进入 AI 生产流程。

支持输入类型：

- 长篇小说
- 短篇故事
- 一句话脑洞
- 已有剧本
- Excel 分镜表

### 当前实现

创作向导支持：

- 作品名称
- 输入类型
- 题材
- 画幅
- 画风
- 故事正文
- 9 宫格、25 宫格、导演模式
- 文本模型供应商选择
- 文本模型选择
- 模型连通性测试
- 积分预估
- 开始生成

### 关键代码

- `apps/web/src/pages/WizardPage.tsx`
- `apps/api/src/server.ts`
- `apps/api/src/agents/workflow.ts`
- `packages/shared/src/index.ts`

### 数据流

1. 前端提交 `CreateProjectInput`。
2. API 用 Zod 校验参数。
3. `estimateCreation` 计算字数、预计集数、预估积分。
4. `createProjectAndTask` 创建项目、任务、冻结积分。
5. BullMQ 创建异步生成任务。
6. 任务完成后返回项目生产台。

### 后续扩展

- Excel 文件上传和解析。
- 小说章节拆分。
- 草稿保存。
- 生成前选择目标平台：抖音、快手、小红书、B 站。
- 分集规划和批量生成。

### 项目讲法

创作向导是整个生产链路的入口，我没有把它做成简单 prompt 输入框，而是做成结构化生产配置，方便后续控制成本、生成规格和任务质量。

## 3. 文本大模型生成模块

### 目标

调用真实文本大模型生成：

- 剧情梗概
- 剧本文本
- 角色设定
- 镜头级分镜
- 图片提示词
- 视频提示词

### 当前实现

当前支持：

- DeepSeek 官方/OpenAI-compatible 接口。
- 默认模型 `deepseek-v4-pro`。
- 已新增 `deepseek-v4-flash`，用于低成本快速生成，适合日常草稿、快速分镜。
- 已新增 OpenAI 上游中转站 `gpt-5.5`，支持 Responses API。
- 有 Key 时走真实模型。
- 无 Key 或调用失败时走本地结构化生成器兜底。
- 模型输出要求为 JSON，后端解析后标准化入库。

### 关键代码

- `apps/api/src/agents/generator.ts`
- `apps/api/src/queue/generationQueue.ts`
- `apps/api/src/server.ts`

### 数据流

1. 任务进入 BullMQ。
2. Worker 将任务状态改为 `running`。
3. `generateProjectContent` 判断是否有文本模型配置。
4. 有配置则调用 `callOpenAICompatible`。
5. 模型返回 JSON。
6. `normalizeOutput` 规范化为剧本、角色、资产、分镜。
7. Prisma transaction 写入数据库。
8. 成功后任务变为 `succeeded`，正式扣积分。
9. 失败后任务变为 `failed`，释放冻结积分。

### 后续扩展

- LiteLLM 模型网关。
- 多模型 fallback。
- `gpt-5.5` 用作高质量生成/复核模型，`deepseek-v4-flash` 用作快速草稿模型。
- 长篇小说分章摘要。
- Prompt 模板版本管理。
- 生成质量 Review Agent。
- 失败自动重试。

### 项目讲法

文本生成模块采用 OpenAI-compatible 抽象，当前先接 DeepSeek，后续可以无缝切换 Qwen、豆包、Claude、Gemini 或中转站模型。生成结果不是直接展示文本，而是转成结构化业务对象后落库。

## 4. 角色一致性模块

### 目标

解决 AI 漫剧/短剧生成中的核心问题：同一个角色在不同分镜、图片和视频里保持脸、发型、服装、气质一致。

### 当前实现

当前角色一致性采用“角色卡 + 稳定提示词 + 负面提示词 + 固定 seed + 资产引用”的方案。

每个角色生成：

- name：角色名
- identity：角色身份
- appearance：五官、年龄、身材、气质
- costume：固定服装、配饰、主色
- personality：性格
- prompt：角色参考图提示词
- negativePrompt：防换脸、防漂移、防多手、防低质
- seed：项目内稳定 seed
- consistencyLevel：一致性等级

### 关键代码

- `apps/api/src/agents/generator.ts`
- `packages/shared/src/index.ts`
- `apps/api/prisma/schema.prisma`
- `apps/web/src/pages/ProjectWorkbenchPage.tsx`

### 数据流

1. 文本模型先生成角色设定。
2. 后端用 `buildCharacterPrompt` 构建稳定角色提示词。
3. 用 `stableSeed(projectId, character.name, index)` 生成固定 seed。
4. 角色写入 `characters` 表。
5. 同步生成角色资产写入 `assets` 表，类型为 `role`。
6. 分镜生成时使用角色名匹配角色资产 ID。
7. 每条分镜的 `referenceAssetIds` 关联角色资产和场景资产。
8. 后续生图时可把角色参考图、角色 prompt、seed 和负面提示词传入图片模型。

### 当前规则

- 角色外貌只在角色卡定义。
- 分镜提示词主要描述动作、情绪、空间关系和镜头。
- 同一角色项目内固定 seed。
- 换装、变身需要建立衍生角色资产，不直接改主角色。
- 多人同框必须写清左右站位和朝向。

### 后续扩展

- 接入真实角色参考图生成。
- 支持 image2 / image-to-image。
- 增加角色衍生资产：换装、童年、战损、特殊造型。
- ComfyUI 工作流支持 ControlNet/IP-Adapter/FaceID。
- 角色一致性评分。
- 分镜生成前强制引用真实角色资产 ID。

### 项目讲法

角色一致性不是靠一句“保持一致”解决的。我把它拆成角色卡、固定 seed、角色参考资产、负面提示词和分镜资产引用，让每条分镜都引用同一套角色资产，而不是每次重新描述角色外貌。

## 5. 分镜生成模块

### 目标

把剧本拆成镜头级生产数据，让后续图片、视频、配音、字幕都能接着用。

### 当前实现

每条分镜包含：

- 集数
- 场次
- 镜头号
- 时长
- 景别
- 视角
- 运镜
- 出场角色
- 场景
- 画面描述
- 台词
- 旁白
- 环境声
- 音效
- 图片提示词
- 视频提示词
- 关联资产 ID
- 状态

### 关键代码

- `apps/api/src/agents/generator.ts`
- `apps/api/prisma/schema.prisma`
- `apps/web/src/pages/ProjectWorkbenchPage.tsx`
- `packages/shared/src/index.ts`

### 数据流

1. 文本模型输出 `storyboards` 数组。
2. 后端校验并补齐字段。
3. 自动计算时长。
4. 自动关联角色资产和场景资产。
5. 分镜写入 `storyboards` 表。
6. 项目生产台读取并展示镜头级分镜表。

### 后续扩展

- 分镜表行内编辑。
- Excel 导入/导出。
- 镜头重排。
- 分镜质量检查。
- 台词零删改校验。
- 长台词自动拆镜。

### 项目讲法

我把分镜设计成后续生产的中心数据结构，不只是展示文本。图片生成、视频生成、配音、字幕和导出都可以从分镜表继续往下游流转。

## 6. 素材库模块

### 目标

统一管理角色、场景、图片、视频、音频、字幕和封面等生产资产。

### 当前实现

当前 `assets` 表支持：

- role：角色参考资产
- role_derivative：角色衍生资产
- scene：场景资产
- prop：道具资产
- image：分镜图
- video：视频片段
- audio：配音
- subtitle：字幕
- cover：封面

### 关键代码

- `apps/api/prisma/schema.prisma`
- `apps/api/src/db/repository.ts`
- `apps/api/src/db/mappers.ts`
- `apps/web/src/pages/ProjectWorkbenchPage.tsx`

### 数据流

1. 文本生成阶段生成角色和场景资产。
2. 分镜图生成阶段新增 `image` 资产。
3. 视频草稿生成阶段新增 `video` 资产。
4. 项目生产台统一展示资产库。

### 后续扩展

- 上传用户自有图片。
- 上传角色参考图。
- 接 OSS/COS/S3/MinIO。
- 素材版本管理。
- 素材复用到多个项目。

### 项目讲法

素材库是短剧生产平台的资产中心。角色、场景和镜头图不散落在各个任务里，而是统一进入资产表，并通过 ID 和分镜关联。

## 7. 图片生成模块

### 目标

根据每条分镜的图片提示词生成分镜图，并保存为资产。

### 当前实现

当前采用可插拔 Provider：

- 默认 `Mock Image Adapter`，本地演示不产生真实费用。
- 预留 `DashScope / 通义万相`。
- 已新增 OpenAI-compatible / relay 图片适配器，可通过中转站调用 `image2`。
- 支持 `IMAGE_PROVIDER=dashscope` 切换真实图片生成。
- 支持 `IMAGE_PROVIDER=openai-compatible` 调用通用图片接口；JXB 的 `gpt-image-2` 统一走 `IMAGE_PROVIDER=jxb-image`。
- 图片生成前先检查积分余额。
- 重复生成不重复创建资产，不重复扣费。

### 关键代码

- `apps/api/src/providers/dashscopeImage.ts`
- `apps/api/src/db/repository.ts`
- `apps/web/src/pages/ProjectWorkbenchPage.tsx`

### 数据流

1. 前端点击生成分镜图。
2. API 查询项目分镜和已存在图片资产。
3. 过滤掉已生成镜头。
4. 按待生成数量预估积分。
5. 余额不足直接报错，不调用外部模型。
6. 调用图片 Provider。
7. 新增 `image` 资产。
8. 更新分镜状态。
9. 更新项目视觉资产数。
10. 扣积分并写流水。

### 后续扩展

- 通义万相真实开启。
- 中转站 image2 开启。
- 火山方舟图片模型。
- 硅基流动图片模型。
- ComfyUI 工作流。
- 批量并发和失败重试。
- 角色参考图注入 image2。

### 项目讲法

图片生成模块不是直接一键全量调用模型，而是先检查余额、过滤已生成镜头，再调用 Provider，避免重复扣费和重复生成。

## 8. 图生视频模块

### 目标

把分镜图转为视频片段，为后续配音、字幕和合成导出做准备。

### 当前实现

当前为 mock 视频生成：

- 创建 `video` 类型资产。
- 创建视频生成任务记录。
- 更新项目 `videoClips`。
- 不产生真实视频模型费用。

### 关键代码

- `apps/api/src/db/repository.ts`
- `apps/web/src/pages/ProjectWorkbenchPage.tsx`
- `packages/shared/src/index.ts`

### 数据流

1. 前端点击生成视频草稿。
2. API 查询分镜和已有视频资产。
3. 过滤已生成视频。
4. 创建 video 资产。
5. 创建任务记录。
6. 更新项目视频数量。

### 后续扩展

- 接真实图生视频模型。
- 按秒计费。
- 轮询异步视频任务。
- 视频失败重试。
- 视频预览播放器。
- 镜头级替换重生成。

### 项目讲法

视频生成成本高，所以 MVP 先把任务流、资产流和计费结构打通，真实模型作为可插拔 Provider 后续接入。

## 9. 任务队列模块

### 目标

AI 生成任务耗时长、容易失败、需要重试，不能直接阻塞接口。

### 当前实现

当前使用：

- Redis
- BullMQ
- Worker
- 任务状态：pending、running、succeeded、failed、canceled

### 关键代码

- `apps/api/src/queue/generationQueue.ts`
- `apps/api/src/server.ts`
- `apps/api/prisma/schema.prisma`
- `apps/web/src/pages/TaskCenterPage.tsx`

### 数据流

1. 创建项目时创建任务记录。
2. 添加 BullMQ job。
3. Worker 消费任务。
4. 更新任务进度。
5. 成功写入生成数据并扣费。
6. 失败写入 errorReason 并释放冻结积分。
7. 前端自动轮询刷新状态。

### 后续扩展

- 任务优先级。
- 并发控制。
- 自动重试。
- SSE/WebSocket 实时推送。
- 用户级任务限流。
- 后台取消任务。

### 项目讲法

我用队列把生成任务从 HTTP 请求中拆出来，避免接口长时间阻塞，同时为后续重试、并发、成本控制和任务中心打基础。

## 10. 积分计费模块

### 目标

实现商业化闭环：用户充值积分，平台统一调用模型，后台按任务代扣成本。

### 当前实现

当前数据库表：

- `credit_accounts`：余额、冻结余额、累计充值、累计消费。
- `credit_transactions`：充值、冻结、消费、退款、调整。
- `model_prices`：模型计费单位和积分价格。
- `generation_tasks`：预估积分和最终扣费。

当前流程：

- 文本生成：先冻结积分，成功后正式扣费，失败释放冻结积分。
- 图片生成：先余额预检查，再调用模型，成功后按实际新增图片扣费。
- 视频 mock：当前 0 积分，后续真实视频按秒扣费。

### 关键代码

- `apps/api/prisma/schema.prisma`
- `apps/api/src/db/repository.ts`
- `apps/api/src/db/seed.ts`
- `apps/api/src/data.ts`
- `apps/web/src/pages/CreditsPage.tsx`
- `apps/web/src/pages/AdminPage.tsx`

### 数据流

1. 用户发起生成。
2. 后端估算积分。
3. 检查可用余额：`balance - frozenBalance`。
4. 冻结或预检查。
5. 任务成功后扣费。
6. 写入流水。
7. 前端刷新余额和流水。

### 后续扩展

- 支付订单表。
- 微信/支付宝支付回调。
- 后台手动充值。
- 模型价格后台编辑。
- 用户套餐权益。
- 会员包月。
- 项目级预算上限。
- 成本和毛利报表。

### 项目讲法

计费不是写死在前端，而是拆成模型价格表、用户积分账户、任务扣费和流水记录。这样后续换模型、调价格、接支付都不影响主业务链路。

## 11. 模型供应商与模型网关模块

### 目标

支持多个模型供应商，用户或后台可以选择调用不同模型。

### 当前实现

当前供应商目录包含：

- OpenAI 上游中转站
- DeepSeek
- OpenAI-compatible 中转站
- Qwen / 通义千问
- 豆包 / 火山方舟
- 国际文本模型路由
- 通义万相 / DashScope 图片
- ComfyUI 高级工作流
- Mock 图片演示适配器
- Mock 视频可插拔接口

当前真正启用：

- OpenAI 上游中转站 `gpt-5.5`：需要配置 `OPENAI_API_KEY`。
- DeepSeek 文本。
- OpenAI-compatible 中转预留。
- Mock 图片。
- Mock 视频。

### 关键代码

- `apps/api/src/data.ts`
- `apps/api/prisma/schema.prisma`
- `apps/api/src/agents/generator.ts`
- `apps/api/src/providers/dashscopeImage.ts`
- `apps/web/src/pages/WizardPage.tsx`
- `apps/web/src/pages/AdminPage.tsx`

### 后续扩展

- 接 LiteLLM 做统一模型网关。
- 每个用户/项目独立预算。
- 模型降级和 fallback。
- 供应商健康检查。
- 按模型成本动态计费。

### 项目讲法

我没有把模型调用写成单一 DeepSeek，而是设计了 provider 和 model price 两层结构。MVP 先接 DeepSeek，后续可以接 LiteLLM 作为统一网关，让多个模型共用一套任务和计费系统。

## 12. 后台管理模块

### 目标

提供平台运营入口，管理用户、项目、任务、模型、计费、模板和数据。

### 当前实现

当前后台管理页包含：

- 注册用户数
- 项目数量
- 任务成功率
- 模型供应商列表
- 模型列表
- 提示词模板列表
- 模型计费表
- 管理入口按钮

### 关键代码

- `apps/web/src/pages/AdminPage.tsx`
- `apps/api/src/server.ts`
- `apps/api/src/db/repository.ts`

### 后续扩展

- 使用 Ant Design Pro 或 react-admin。
- 用户管理 CRUD。
- 项目审核。
- 任务日志。
- 模型价格编辑。
- 支付订单。
- 运营公告。
- 内容合规审核。
- 权限角色：管理员、运营、财务、创作者。

### 项目讲法

后台不是简单展示页，而是围绕商业化必需的模型、计费、任务、用户和模板管理设计。MVP 已经展示核心运营数据，后续可以引入成熟开源后台模板做 CRUD 强化。

## 13. 数据一致性设计

### 目标

避免前端显示、后端任务、数据库数量、积分流水不一致。

### 当前实现

关键策略：

- 创建项目、创建任务、冻结积分在同一个事务里完成。
- 文本生成成功后，剧本、角色、资产、分镜、项目状态、积分扣费、流水写在同一个事务里。
- 图片生成先过滤已生成资产，避免重复扣费。
- 图片生成按实际新增资产数返回。
- 视频生成按实际新增视频资产数更新。
- 前端生成后调用 `onRefresh` 重新从数据库读取最新状态。
- App 在 pending/running 任务期间自动轮询刷新。

### 关键代码

- `apps/api/src/db/repository.ts`
- `apps/api/src/queue/generationQueue.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/pages/ProjectWorkbenchPage.tsx`

### 后续扩展

- 乐观锁。
- 幂等 key。
- 任务去重。
- 分布式锁。
- SSE/WebSocket。
- 审计日志。

### 项目讲法

我重点处理了数据对等问题：所有关键写操作尽量在事务中完成，前端不自己猜状态，而是生成后从数据库刷新，保证任务、资产、项目统计和积分流水一致。

## 14. 开源工具复用策略

### Toonflow

可以学习：

- Agent 分层。
- Skill 文件化提示词。
- 角色一致性规则。
- 资产和分镜关联。
- 模型供应商配置。

不建议直接整包使用：

- 架构偏本地/Electron。
- 本项目是 Web SaaS。
- 商业化需要注意授权边界。

### LiteLLM

适合后续作为模型网关：

- 多模型统一 OpenAI-compatible API。
- 成本跟踪。
- 预算。
- fallback。
- 访问控制。

### Flexprice

适合后续作为更完整的 usage-based billing：

- credits。
- top-up。
- usage event。
- invoice。
- entitlement。

### Ant Design Pro / react-admin

适合后续做后台 CRUD：

- 用户表。
- 订单表。
- 任务表。
- 模型价格表。
- 模板表。

### 当前选择

MVP 不直接引入重型开源系统，而是先把核心业务表和流程做出来；后续根据复杂度接 LiteLLM、Flexprice 或后台模板。

### 项目讲法

我对开源项目采用“能力复用、架构重写”的策略：学习 Toonflow 的角色一致性和 Agent 思路，但用 Web SaaS 的数据库、队列、计费和后台系统重新实现。

## 15. 当前待办排期

## 16. UI 交互优化记录

### 目标

根据 U 漫剧和同类 AI 创作平台优化交互，让用户按步骤完成内容生产，而不是面对一堆表单和瀑布素材。

### 当前优化

- 全局浅蓝背景：参考中转站/运营后台常见的浅蓝色背景，降低刺眼感。
- 创作向导改为卡片式选择：
  - 输入类型
  - 题材方向
  - 发布画幅
  - 画面风格
- 默认模型改为 `deepseek-v4-flash`，降低等待时长和成本。
- 项目生产台分区：
  - 生产操作
  - 分镜图画廊
  - AI 剧本
  - 角色一致性资产
  - 基础素材库
  - 视频草稿
  - 镜头级分镜表

### 分镜图 UI 调整

之前问题：

- 分镜图和角色/场景素材混在一个瀑布流里。
- 图片占位过大。
- 镜头编号和状态不清楚。
- 用户不知道哪张图对应哪一条分镜。

现在方案：

- 新增“分镜图画廊”独立区块。
- 按镜头顺序生成固定比例卡片。
- 每张卡显示：
  - 镜头号
  - 状态
  - 景别/运镜/时长
  - 画面描述
  - 图片预览或待生成占位
- 基础素材库只放角色、场景、道具，不再混入分镜图。

### 项目讲法

这次交互优化重点是把“素材瀑布流”改成“生产工作台”。分镜图是镜头级产物，所以应该跟分镜表绑定展示，而不是和角色、场景素材混在一起。

### P0

- 后台模型价格编辑。
- 后台手动充值。
- 登录注册和用户隔离。
- 图片生成真实 DashScope 开关验证。

### P1

- Excel 分镜表导入解析。
- 分镜表行内编辑。
- ComfyUI Provider。
- 角色参考图真实生成。
- TTS 和字幕。

### P2

- FFmpeg 合成导出。
- LiteLLM 网关。
- Flexprice 适配。
- 内容合规审核。
- 多租户和权限。

## 17. 真实登录与模型路由落地记录

### 登录系统

- `User.passwordHash` 保存加盐哈希，不保存明文密码。
- 注册接口：`POST /api/auth/register`，写入用户、初始化积分账户并返回登录 token。
- 登录接口：`POST /api/auth/login`，校验邮箱和密码，更新 `lastLoginAt`。
- 当前 token 为 MVP 内存 token，服务重启后需要重新登录；商业化版本建议升级为 Redis Session 或 JWT + Refresh Token。
- 项目、任务、积分账户、积分流水都按当前登录用户查询和写入，避免数据串号。

### 三段模型选择

创建项目时前端会提交三组模型配置：

- 内容生成：负责策划、剧本、角色卡、分镜文本。
- 分镜生图：负责按镜头生成分镜图。
- 视频生成：负责后续图生视频，目前先使用可插拔 mock/provider 占位。

数据库 `Project` 会记录：

- `textProvider` / `textModel`
- `imageProvider` / `imageModel`
- `videoProvider` / `videoModel`

这样后续每个作品都能追溯“当时用什么模型生成”，也方便按供应商、模型、用户做成本核算。

### 通义万相与 image2 策略

- MVP 默认图片链路：`dashscope-image + qwen-image`。
- `qwen-image` 已完成真实连接验证，可以返回图片地址。
- `relay-image` provider 已删除；`gpt-image-2` 由 `jxb-image` provider 管理，使用独立 `JXB_IMAGE_API_KEY`。
- 前端图片测试按钮会调用 `/api/settings/image-model-test`，返回成功、异步或错误信息；如返回图片 URL，会在创建页展示测试预览。

### 项目讲法

我把模型能力设计成“按模态拆分的模型网关”：文本、图片、视频各自选择供应商和模型，但项目层会统一记录配置、任务层会记录实际调用结果，积分系统按任务扣费。这比“用户自己填一个 API Key 跑 demo”更接近商业 SaaS 的模型成本管理方式。

## 18. 后台管理与真假数据分离记录

### 启动修复

- Docker 默认只启动 `postgres` 和 `redis`。
- `minio` 改为可选 profile：`docker compose --profile storage up -d minio`。
- 这样即使 Docker Hub 拉取 MinIO 镜像失败，也不会阻断注册、数据库、队列和模型生成 MVP。

### 数据分层

- `apps/api/src/seed/catalogData.ts`：长期保留的运营配置种子。
  - 套餐 `plans`
  - 模型供应商 `providers`
  - 模型计费 `modelPrices`
  - 提示词模板 `templates`
- `apps/api/src/seed/testData.ts`：演示/假数据。
  - demo 项目
  - demo 任务
  - demo 剧本、角色、资产、分镜
  - demo 积分流水
- `SEED_DEMO_DATA=false` 时不再写入演示项目数据，便于后续切换到真实业务数据。

### 后台可编辑项

- 套餐：名称、售价、到账积分、赠送积分、标签、卖点、上下架。
- 供应商：启停、Base URL、模型列表、前端说明。
- 模型价格：积分单价、供应商成本、启停。

### 前后台联动逻辑

- 前端充值页读取 `plans` 表，只展示启用套餐。
- 创作页读取 `model_providers` 表，启用状态会影响模型是否可选。
- 分镜图生成扣费读取 `model_prices` 表，优先使用当前模型启用价格。
- 文本生成冻结积分也读取 `model_prices`，按选中模型的 `text_run` 单价和建议集数估算。

### 项目讲法

后台不是单纯展示页，而是运营配置中心：前端展示、模型选择、积分扣费都会读取数据库配置。这样能体现 SaaS 商业化产品的核心能力：运营人员可以调整套餐、控制模型成本、启停供应商，而不用改代码。
