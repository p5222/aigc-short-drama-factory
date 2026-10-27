# AIGC 漫剧短剧 SaaS 项目全流程设计

> 历史设计草案：本文保留早期品牌候选、架构建议与 MVP mock 设想，不能作为当前实现或生产验收声明。当前产品名为漫角 Studio，实际使用 React/Vite 与 Express/TypeScript；正式收费流程不得用占位结果交付。当前规则、未开发范围及迭代需求以 [2026-10-27审查报告](docs/product/project-audit-20261027.md)、[细化PRD](docs/product/project-refinement-20261027.md) 和专项积分规范为准。任务释放冻结积分不等于现金退款，基础目标毛利售价为API成本÷0.6。DOCX/Excel导入及无限画布仍需按最新矩阵区分状态。

## 1. 项目定位

本项目定位为专业 AIGC 内容创作 SaaS 工具，面向短剧创作者、小说改编团队、自媒体团队和 AIGC 视频生产团队，提供从文本输入到分镜、图片、视频、配音字幕和成片导出的闭环工作流。

本项目不做 Toonflow 或 U 漫剧的品牌复刻、界面像素级复制，而是借鉴二者的优秀能力：

- 借鉴 Toonflow：策划到编剧到分镜到出片的闭环、无限画布、三层 Agent 协作、长期记忆、可插拔模型供应商、章节事件图谱、资产与分镜关联、Skill 文件化提示词。
- 借鉴 U 漫剧：清晰的 Web 工作台、小说改编入口、项目化作品管理、分镜与成片流程、商业化积分模式。

建议工作名称：

- AI 短剧工厂
- 漫剧云工厂
- 剧影智作台
- AI 漫剧创作台
- 短剧智造云
- StoryFlow Studio
- 剧本到视频工厂

推荐暂用名：AI 短剧工厂。名称直观、专业、用户一看就知道用途。

## 2. 产品目标

核心目标：

输入小说、短篇故事、一句话脑洞、已有剧本或 Excel 分镜表，平台自动完成内容策划、剧本改编、分镜生成、角色一致性资产生成、图片生成、图生视频、配音字幕和成片合成导出。

商业闭环目标：

- 支持用户登录注册。
- 支持项目管理和作品管理。
- 支持模型供应商后台配置。
- 支持积分账户、套餐、任务扣费和失败退款。
- 支持素材资产复用，降低重复生成成本。
- 支持管理员配置模板、模型、价格和用户积分。

MVP 原则：

- 视频生成第一版可以先做接口和任务状态 mock。
- 图片生成优先接国内 API。
- 支付第一版先做后台手动充值积分。
- DeepSeek 作为第一版 LLM。
- 保留可插拔接口，后续平滑接入更多模型。

## 3. 用户角色

普通创作者：

- 创建项目。
- 导入小说、故事、脑洞、剧本或 Excel 分镜。
- 使用 AI 生成剧本、分镜、图片和视频任务。
- 管理角色、素材、分镜和成片。
- 查看积分消耗。

管理员：

- 管理用户。
- 管理模型供应商。
- 管理价格规则和套餐。
- 管理提示词模板和 Skill。
- 查看任务、成本、失败原因和平台消耗。

## 4. 核心业务流程

标准流程：

1. 创建项目。
2. 选择作品类型、画幅、风格、目标时长、模型配置。
3. 导入内容：小说、短篇故事、一句话脑洞、已有剧本、Excel 分镜表。
4. AI 策划：拆解题材、爽点、人物、世界观、节奏和卖点。
5. AI 编剧：生成故事骨架、改编策略、剧本。
6. AI 分镜：将剧本拆成镜头级分镜表。
7. 角色资产：生成角色卡、参考图、衍生表情、动作、服装、声音。
8. 图片生成：按分镜关联角色、场景、道具，生成分镜图。
9. 图生视频：使用分镜图、动作描述、运镜和时长生成视频片段。
10. 配音字幕：生成旁白、台词音频和字幕文件。
11. 成片合成：FFmpeg 合成视频片段、配音、字幕、封面。
12. 导出成片和工程文件。

## 5. 工作台设计

平台同时提供两种工作台。

步骤工作台：

- 面向新手。
- 按流程展示：内容导入、策划、剧本、角色、分镜、图片、视频、配音、导出。
- 每一步都有 AI 生成按钮、编辑器、任务状态和结果预览。

无限画布工作台：

- 面向专业用户。
- 使用 React Flow 实现节点式生产流。
- 节点类型包括：输入内容、章节、事件、角色、剧本、分镜、图片、视频、音频、导出。
- 节点之间通过边表示依赖关系。
- 用户可以自由回溯、并行生成和重跑局部节点。

建议第一版同时做，但优先保证步骤工作台完整可用。无限画布可作为同一数据的另一种视图。

## 6. 页面原型

### 6.1 登录注册页

功能：

- 手机号/邮箱登录。
- 密码登录。
- 注册。
- 忘记密码可后置。

### 6.2 首页仪表盘

布局：

- 顶部：产品名、积分余额、用户菜单。
- 左侧：项目、素材库、模板库、模型设置、充值管理。
- 中间：最近项目、生成任务、作品统计。

核心卡片：

- 新建项目。
- 最近编辑项目。
- 今日生成任务。
- 积分余额。
- 失败任务提醒。

### 6.3 新建项目页

字段：

- 项目名称。
- 内容类型：小说、短篇故事、脑洞、剧本、Excel 分镜。
- 题材类型：爽文、甜宠、复仇、悬疑、科幻、儿童、广告短剧等。
- 视频画幅：9:16、16:9、1:1。
- 目标时长。
- 单镜头最大时长。
- 画风。
- 图片模型。
- 视频模型。
- TTS 模型。

### 6.4 创作工作台

布局：

- 顶部：项目名、保存状态、模型配置、积分预估、导出按钮。
- 左侧：流程目录和素材索引。
- 中间：步骤工作台或无限画布。
- 右侧：AI 助手、任务队列、生成日志、失败原因。

步骤 Tab：

- 内容
- 策划
- 剧本
- 角色
- 分镜
- 图片
- 视频
- 配音字幕
- 导出

### 6.5 内容导入页

支持：

- 粘贴文本。
- 上传 txt/docx。
- 上传 Excel 分镜表。
- 一句话生成故事。
- 章节自动拆分。

输出：

- 章节列表。
- 事件抽取状态。
- 可视化事件表。

### 6.6 策划与编剧页

模块：

- 故事骨架。
- 改编策略。
- 人物关系。
- 集数规划。
- 爽点/爆点规划。
- 剧本编辑器。

能力：

- 一键生成。
- 局部重写。
- 对话润色。
- 节奏压缩。
- 审核风险提示。

### 6.7 角色库页

字段：

- 角色名。
- 身份。
- 年龄。
- 性别。
- 外貌描述。
- 服装描述。
- 性格。
- 口头禅。
- 角色弧光。
- 固定提示词。
- 负面提示词。
- 参考图。
- 声音 ID。
- seed。
- face_id / lora_id / ip_adapter_id 预留。

功能：

- 生成角色卡。
- 生成角色参考图。
- 生成衍生资产：表情、动作、服装、半身、全身、侧脸。
- 绑定声音。
- 在分镜中查看被引用次数。

### 6.8 分镜表页

字段：

- 集数。
- 场次。
- 镜头编号。
- 时长。
- 景别。
- 视角。
- 运镜。
- 出场角色。
- 关联角色资产。
- 关联场景资产。
- 关联道具资产。
- 画面描述。
- 台词。
- 旁白/VO。
- 环境音。
- 音效。
- 图片提示词。
- 视频提示词。
- 模型参数。
- 生成状态。

质量规则：

- 单镜头建议小于 15 秒。
- 长台词或长 VO 超过 20 字需要拆镜。
- 剧本台词必须零删改。
- 场内人物不能无故消失。
- 同场景镜头需要景别、视角和动作变化。
- 场间过渡需要动作、情绪、视线或声音承接。
- 人物外观尽量由角色资产提供，分镜提示词主要描述动作、情绪和状态。

### 6.9 图片生成页

功能：

- 单镜生成。
- 批量生成。
- 失败重试。
- 替换模型。
- 参考图上传。
- 角色一致性强度。
- 风格一致性强度。
- 多候选图选择。

### 6.10 视频生成页

第一版：

- 生成任务接口。
- mock 视频任务。
- 任务状态流转。
- 视频提示词编辑。
- 首帧图绑定。

后续版本：

- 接入国内视频 API。
- 支持图生视频。
- 支持多片段合成。
- 支持失败重试和成本统计。

### 6.11 配音字幕页

功能：

- 角色绑定音色。
- 台词生成音频。
- 旁白生成音频。
- 自动生成 SRT/VTT 字幕。
- 音频试听。
- 字幕编辑。

### 6.12 导出页

功能：

- 选择视频片段。
- 选择配音和字幕。
- 设置封面。
- 设置分辨率、fps、码率。
- FFmpeg 合成。
- 导出 MP4。
- 导出分镜 Excel。
- 导出项目 JSON。

### 6.13 模板库页

模板类型：

- 策划模板。
- 编剧模板。
- 分镜模板。
- 图片提示词模板。
- 视频提示词模板。
- 角色模板。
- 审核模板。

设计重点：

- 学习 Toonflow 的 Skill 文件化思路。
- 模板可在线编辑。
- 模板有版本号。
- 任务记录使用的模板版本，方便复盘。

### 6.14 模型供应商页

功能：

- DeepSeek API 配置。
- 国内图片模型配置。
- 视频模型预留配置。
- TTS 模型配置。
- 启用/禁用模型。
- 模型价格配置。
- 模型测试。

### 6.15 积分与套餐页

用户端：

- 积分余额。
- 消耗记录。
- 套餐列表。

管理员端：

- 手动充值。
- 创建套餐。
- 设置任务价格。
- 查看平台成本。

## 7. 系统架构

前端：

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn-ui
- React Flow
- TanStack Query
- Zustand

后端：

- NestJS
- Prisma
- PostgreSQL
- Redis
- BullMQ
- JWT

模型服务：

- Python FastAPI Worker
- 负责图片、视频、TTS、FFmpeg、文件处理。
- 后端通过任务队列调度 Worker。

存储：

- 本地开发：本地文件系统。
- 商业部署：S3 / OSS / COS / MinIO。

部署：

- 第一版：Docker Compose。
- 后续：Kubernetes。

## 8. 数据库设计

### 8.1 users

- id
- email
- phone
- password_hash
- nickname
- role
- status
- created_at
- updated_at

### 8.2 projects

- id
- user_id
- name
- type
- intro
- source_type
- art_style
- video_ratio
- target_duration
- image_model_id
- video_model_id
- tts_model_id
- status
- created_at
- updated_at

### 8.3 source_documents

- id
- project_id
- type
- title
- content
- file_url
- parse_status
- created_at

### 8.4 chapters

- id
- project_id
- source_document_id
- chapter_index
- title
- content
- summary
- event_state
- created_at

### 8.5 story_events

- id
- project_id
- chapter_id
- event_index
- name
- detail
- characters
- emotion
- importance
- created_at

### 8.6 agent_workspaces

- id
- project_id
- key
- data
- version
- created_at
- updated_at

key 示例：

- story_skeleton
- adaptation_strategy
- script
- director_plan
- storyboard_table
- asset_plan

### 8.7 scripts

- id
- project_id
- name
- content
- version
- status
- created_at
- updated_at

### 8.8 characters

- id
- project_id
- name
- gender
- age
- identity
- personality
- appearance
- costume
- catchphrase
- arc
- prompt
- negative_prompt
- reference_asset_id
- voice_id
- seed
- face_id
- lora_id
- ip_adapter_id
- consistency_profile
- created_at
- updated_at

### 8.9 assets

- id
- project_id
- parent_asset_id
- type
- name
- description
- prompt
- negative_prompt
- file_url
- model_id
- generation_params
- status
- error_reason
- created_at
- updated_at

type 示例：

- role
- role_derivative
- scene
- prop
- image
- video
- audio
- subtitle
- cover

### 8.10 storyboards

- id
- project_id
- script_id
- episode_no
- scene_no
- shot_no
- duration
- shot_size
- camera_angle
- camera_movement
- characters
- picture_desc
- dialogue
- voice_over
- environment_sound
- sound_effect
- image_prompt
- video_prompt
- model_params
- status
- image_asset_id
- video_asset_id
- created_at
- updated_at

### 8.11 storyboard_assets

- storyboard_id
- asset_id
- relation_type

relation_type 示例：

- character
- scene
- prop
- reference
- first_frame

### 8.12 generation_tasks

- id
- user_id
- project_id
- task_type
- provider_id
- model_id
- target_type
- target_id
- prompt
- params
- status
- estimated_credits
- final_credits
- provider_cost
- result_asset_id
- error_reason
- started_at
- finished_at
- created_at

status：

- pending
- running
- succeeded
- failed
- canceled
- refunded

### 8.13 model_providers

- id
- name
- type
- base_url
- config_schema
- encrypted_credentials
- enabled
- created_at
- updated_at

### 8.14 model_definitions

- id
- provider_id
- name
- display_name
- modality
- capabilities
- default_params
- price_rule
- enabled
- created_at

modality：

- text
- image
- video
- tts
- embedding

### 8.15 prompt_templates

- id
- name
- type
- content
- variables_schema
- version
- enabled
- created_at
- updated_at

### 8.16 credit_accounts

- id
- user_id
- balance
- frozen_balance
- created_at
- updated_at

### 8.17 credit_transactions

- id
- user_id
- project_id
- task_id
- type
- amount
- balance_after
- description
- created_at

type：

- recharge
- freeze
- consume
- refund
- adjust

### 8.18 plans

- id
- name
- credits
- price
- description
- enabled
- created_at

### 8.19 orders

- id
- user_id
- plan_id
- amount
- credits
- status
- payment_method
- paid_at
- created_at

第一版可以只支持后台手动设为 paid。

## 9. API 设计

认证：

- POST /auth/register
- POST /auth/login
- GET /auth/me

项目：

- GET /projects
- POST /projects
- GET /projects/:id
- PATCH /projects/:id
- DELETE /projects/:id

内容导入：

- POST /projects/:id/sources/text
- POST /projects/:id/sources/upload
- POST /projects/:id/sources/excel
- POST /projects/:id/chapters/parse
- POST /projects/:id/events/extract

Agent：

- POST /projects/:id/agents/planning
- POST /projects/:id/agents/script
- POST /projects/:id/agents/storyboard
- POST /projects/:id/agents/assets
- GET /projects/:id/agent-workspaces
- PATCH /agent-workspaces/:id

角色：

- GET /projects/:id/characters
- POST /projects/:id/characters
- PATCH /characters/:id
- POST /characters/:id/generate-reference
- POST /characters/:id/generate-derivatives

分镜：

- GET /projects/:id/storyboards
- POST /projects/:id/storyboards/generate
- PATCH /storyboards/:id
- POST /storyboards/:id/generate-image
- POST /storyboards/:id/generate-video
- POST /storyboards/batch-generate-images

素材：

- GET /projects/:id/assets
- POST /projects/:id/assets
- PATCH /assets/:id
- DELETE /assets/:id

任务：

- GET /tasks
- GET /tasks/:id
- POST /tasks/:id/retry
- POST /tasks/:id/cancel

模型：

- GET /admin/providers
- POST /admin/providers
- PATCH /admin/providers/:id
- POST /admin/providers/:id/test
- GET /models

积分：

- GET /credits/account
- GET /credits/transactions
- POST /admin/users/:id/credits/adjust
- GET /admin/orders
- POST /admin/orders/manual-paid

导出：

- POST /projects/:id/export/video
- POST /projects/:id/export/storyboard-excel
- GET /exports/:id

## 10. Agent 工作流设计

借鉴 Toonflow 的三层 Agent 思路：

第一层：决策 Agent

- 判断用户意图。
- 决定调用哪个执行 Agent。
- 读取项目上下文、记忆、模型配置。

第二层：执行 Agent

- 策划 Agent：生成故事骨架、爆点、节奏规划。
- 改编 Agent：根据章节事件生成改编策略。
- 编剧 Agent：生成剧本。
- 导演 Agent：生成导演规划。
- 分镜 Agent：生成分镜表。
- 资产 Agent：生成角色、场景、道具资产。
- 生产 Agent：生成图片、视频、音频和导出任务。

第三层：监督 Agent

- 检查台词是否删改。
- 检查人物是否无故消失。
- 检查镜头是否超时。
- 检查角色资产是否被正确引用。
- 检查提示词是否缺少模型参数。

## 11. 角色一致性方案

角色一致性不能只靠提示词，需要系统化实现。

核心机制：

1. 每个角色必须先生成角色卡。
2. 每个角色必须生成基础参考图。
3. 角色参考图进入资产库。
4. 分镜只引用角色资产 ID，不重复描述完整外貌。
5. 图片生成时自动注入角色参考图、角色固定提示词、风格提示词和负面提示词。
6. 同一角色可以生成衍生资产，如表情、动作、服装、姿势。
7. 分镜与角色资产建立多对多关联。
8. 支持 seed、face_id、lora_id、ip_adapter_id 等一致性字段预留。
9. 对不支持参考图的模型，降级为固定角色提示词和 seed。
10. 对支持参考图的模型，优先使用参考图、首帧、角色图组和风格图。

图片生成入参必须包含：

- storyboard_id
- image_prompt
- style_prompt
- negative_prompt
- character_asset_ids
- scene_asset_ids
- reference_image_urls
- seed
- model_params

视频生成入参必须包含：

- storyboard_id
- first_frame_image_url
- video_prompt
- duration
- camera_movement
- motion_desc
- character_asset_ids
- model_params

## 12. 模型供应商抽象

统一接口：

TextModelAdapter：

- generateText(input)
- streamText(input)

ImageModelAdapter：

- generateImage(input)
- editImage(input)
- imageToImage(input)

VideoModelAdapter：

- imageToVideo(input)
- textToVideo(input)
- getTaskResult(taskId)

TTSModelAdapter：

- synthesize(input)

Provider 能力字段：

- supports_reference_image
- supports_seed
- supports_image_to_video
- supports_negative_prompt
- supports_async_task
- max_duration
- supported_ratios
- cost_per_call

## 13. 积分计费设计

第一版采用后台手动充值。

扣费流程：

1. 用户发起生成任务。
2. 系统根据模型和参数预估积分。
3. 冻结积分。
4. 任务进入队列。
5. 任务成功，冻结积分转为正式消耗。
6. 任务失败，释放冻结积分并写退款流水。

价格示例：

- DeepSeek 文本生成：按 token 或固定任务扣费。
- 图片生成：按张扣费。
- 视频生成：按秒扣费。
- TTS：按字符数扣费。
- 导出：可免费或按时长扣费。

必须保留 provider_cost 字段，用于后期计算毛利。

## 14. 任务队列设计

队列类型：

- text-generation
- image-generation
- video-generation
- tts-generation
- export-rendering
- file-parsing

任务状态：

- pending
- running
- succeeded
- failed
- canceled

关键能力：

- 失败重试。
- 取消任务。
- 查看日志。
- 任务进度。
- 失败退款。
- 管理员查看成本。

## 15. MVP 开发里程碑

第 0 阶段：项目初始化

- Next.js 前端。
- NestJS 后端。
- Prisma + PostgreSQL。
- Redis + BullMQ。
- Docker Compose。

第 1 阶段：账号与项目

- 登录注册。
- 项目管理。
- 文件上传。
- 基础素材库。

第 2 阶段：内容导入与策划

- 文本导入。
- Excel 分镜导入。
- DeepSeek 接入。
- 策划 Agent。
- 章节事件抽取。

第 3 阶段：剧本与分镜

- 编剧 Agent。
- 分镜 Agent。
- 分镜表编辑器。
- 分镜质量自检。

第 4 阶段：角色一致性

- 角色库。
- 角色卡生成。
- 参考图生成。
- 衍生资产。
- 分镜关联资产。

第 5 阶段：图片生成

- 国内图片 API 接入。
- 图片任务队列。
- 批量生成。
- 失败重试。

第 6 阶段：视频接口

- 视频模型抽象接口。
- mock 视频任务。
- 视频任务状态。
- 后续真实视频 API 预留。

第 7 阶段：配音字幕与导出

- TTS 抽象接口。
- 字幕生成。
- FFmpeg 合成。
- MP4 导出。

第 8 阶段：积分闭环

- 积分账户。
- 后台手动充值。
- 任务预扣费。
- 成功结算。
- 失败退款。

第 9 阶段：管理后台

- 用户管理。
- 模型管理。
- 模板管理。
- 任务管理。
- 成本统计。

## 16. 开发提示词

可以将以下提示词交给开发型 AI：

```text
你是一名资深全栈工程师、AIGC 产品架构师和 SaaS 技术负责人。请根据《AIGC 漫剧短剧 SaaS 项目全流程设计》开发一个专业 AIGC 内容创作平台。

项目不是复刻 Toonflow 或 U 漫剧，而是学习它们的优秀能力并实现自有产品：
1. 学习 Toonflow 的策划-编剧-分镜-出片闭环、三层 Agent、长期记忆、可插拔模型供应商、资产与分镜关联、Skill 文件化提示词。
2. 学习 U 漫剧的清晰 Web 工作台、小说改编、分镜生成、成片合成和商业化积分体系。

技术栈：
前端 Next.js + React + TypeScript + Tailwind + shadcn-ui + React Flow。
后端 NestJS + Prisma + PostgreSQL + Redis + BullMQ。
模型服务 Python FastAPI Worker。
文件存储支持本地和 S3/OSS/COS。
视频合成使用 FFmpeg。

请按以下顺序完成：
1. 初始化项目结构。
2. 建立数据库 schema。
3. 实现用户、项目、素材、角色、分镜、任务、积分模块。
4. 接入 DeepSeek 文本模型。
5. 实现策划 Agent、编剧 Agent、分镜 Agent。
6. 实现角色一致性资产系统。
7. 实现国内图片模型适配器。
8. 实现视频模型 mock 适配器。
9. 实现任务队列和积分扣费。
10. 实现步骤工作台和无限画布工作台。
11. 实现配音字幕和 FFmpeg 导出。
12. 实现管理后台。

角色一致性必须按系统能力实现，不允许只靠一句提示词：
- 建立 characters、assets、storyboards、storyboard_assets 表。
- 每个角色有角色卡、参考图、固定提示词、负面提示词、seed、face_id、lora_id、ip_adapter_id 预留字段。
- 分镜引用角色资产 ID。
- 图片生成时自动注入角色参考图和角色固定提示词。
- 对支持参考图的模型传 reference_image_urls。
- 对不支持参考图的模型降级为固定提示词和 seed。

分镜生成必须满足：
- 台词零删改。
- 长台词/长 VO 超过 20 字拆镜。
- 单镜头建议小于 15 秒。
- 在场人物不能无故消失。
- 镜头包含景别、视角、运镜、画面描述、台词、旁白、音效、时长、图片提示词、视频提示词和模型参数。

积分系统必须满足：
- 用户积分账户。
- 积分流水。
- 任务创建时冻结积分。
- 任务成功后正式扣费。
- 任务失败后退款。
- 管理员可手动充值。

请每完成一个模块都给出：
- 文件结构
- 核心代码
- 数据库变更
- API 列表
- 前端页面
- 自测步骤
```

## 17. 后续优先确认

还有 4 个问题会影响后续实现细节：

1. 国内图片 API 你准备优先选哪家：即梦、通义万相、豆包/火山、腾讯混元，还是先让我按适配器模式留空？
2. 是否需要支持本地 ComfyUI 作为高级模式？
3. Excel 分镜表是否有你自己的固定模板？
4. 第一版部署目标是本地 Docker 演示，还是云服务器部署？

