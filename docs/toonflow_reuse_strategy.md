# Toonflow 开源能力复用策略

## 1. 结论

可以直接参考 Toonflow 的技术设计，也可以在合规前提下选择性移植部分代码；但不建议把 Toonflow 整包作为本项目底座。

原因：

- Toonflow 当前形态偏 Electron、本地服务、SQLite、Socket 工作区。
- 本项目目标是 Web SaaS、任务队列、积分计费、后台管理和可商业化部署。
- 直接套用会带来架构不匹配、授权边界、UI 品牌边界和后续维护问题。

推荐策略：

1. 架构复用：深度学习 Toonflow 的 Agent、Skill、资产、分镜和供应商体系。
2. 代码选择性移植：只移植通用模块，并改造成 SaaS 模块。
3. Prompt/Skill 改写：保留规则思想，形成自有模板库。
4. 授权隔离：上线前确认商业授权，保留许可证、版权和 NOTICE。

## 2. 许可证风险

Toonflow README 显示：

- 项目基于 Apache-2.0。
- 附有补充商业协议。
- 若以产品形式分发给 2 个及以上独立第三方使用，需要取得 HBAI-Ltd 书面商业授权。
- 不得删除或修改 Toonflow 中的标识或版权信息。
- 个人学习、研究、非商业用途，以及团队内部使用属于免费场景。

因此：

- 简历项目、本地演示、学习研究：可以参考和局部使用，但仍应保留来源。
- 对外推广、开放用户注册、商业化使用：建议先申请或确认商业授权。
- 如不想受补充协议影响：应采用 clean-room 重写，只借鉴思想和流程，不复制代码与原文模板。

## 3. 建议直接学习的能力

### 3.1 三层 Agent

Toonflow 的 `scriptAgent` 和 `productionAgent` 都有决策 Agent + 执行子 Agent + 监督/记忆的思路。

本项目落地方式：

- `PlanningAgent`：策划、题材、爆点、集数规划。
- `ScriptAgent`：故事骨架、改编策略、剧本生成。
- `DirectorAgent`：导演规划、场次情绪、镜头节奏。
- `StoryboardAgent`：镜头级分镜表。
- `AssetAgent`：角色、场景、道具资产。
- `ProductionAgent`：图片、视频、TTS、导出任务。
- `ReviewAgent`：台词零删改、角色不消失、镜头时长、资产引用检查。

### 3.2 Skill 文件化配置

Toonflow 把核心提示词放在 `data/skills/*.md`，这非常适合本项目。

本项目落地方式：

- 数据库表：`prompt_templates`。
- 支持类型：planning、script、storyboard、character、image、video、review。
- 每个模板有版本号、启用状态和变量 schema。
- 任务记录绑定模板版本，方便复盘。

### 3.3 章节事件图谱

Toonflow 从小说章节中抽取事件，再用于改编策略和剧本生成。

本项目落地方式：

- `chapters` 表保存原文。
- `story_events` 表保存事件。
- Agent 先读事件，再生成故事骨架和改编策略。
- 长篇小说不直接整本喂给大模型，降低成本。

### 3.4 资产与分镜关联

Toonflow 有角色、场景、道具、分镜的资产关联体系。

本项目落地方式：

- `characters` 表保存角色卡。
- `assets` 表保存角色图、场景图、道具图、音频、视频。
- `storyboard_assets` 表关联分镜和资产。
- 分镜生成图片时自动注入参考图和角色固定提示词。

### 3.5 模型供应商系统

Toonflow 支持多模型供应商配置。

本项目落地方式：

- `model_providers` 保存供应商。
- `model_definitions` 保存模型。
- Provider Adapter 统一 text、image、image2、video、tts。
- 后台可测试供应商能力。

## 4. 适合选择性移植的模块

以下模块值得研究并改造：

- `src/agents/scriptAgent`：编剧 Agent 的工具调用和子 Agent 结构。
- `src/agents/productionAgent`：生产 Agent 的工作区数据读取和资产操作。
- `src/utils/agent/memory.ts`：短期记忆、摘要、向量检索思路。
- `src/utils/agent/skillsTools.ts`：Skill 扫描、frontmatter、工具化使用。
- `data/skills/*.md`：分镜、改编、导演规划规则。
- `src/types/database.d.ts`：数据表设计参考。
- `src/routes/modelSelect`：模型选择思路。
- `src/routes/assetsGenerate`：资产生成流程参考。
- `src/routes/task`：任务状态参考。

需要改造的地方：

- SQLite -> PostgreSQL + Prisma。
- Socket 工作区 -> HTTP API + SSE/WebSocket。
- 本地任务 -> Redis + BullMQ。
- Electron -> Web SaaS。
- 本地路径 -> S3/OSS/COS/MinIO。
- 单用户/本地 -> 多用户/多租户/积分计费。

## 5. 不建议直接复制的部分

- UI 品牌、Logo、名称、图标资源。
- 完整前端页面结构和视觉资产。
- 未改写的长篇 Skill 原文模板。
- Electron 打包逻辑。
- 本地路径强绑定逻辑。
- 未经授权的商业分发版本。

## 6. 当前项目执行策略

第一阶段：

- 先实现自有 Web SaaS 骨架。
- 用 Toonflow 的能力结构作为参考。
- 不复制 Toonflow 代码进入生产主链路。
- 在共享类型、API 和页面里预留 Toonflow 同等能力。

第二阶段：

- 抽取 Toonflow 的 Agent/Skill/Memory 机制进行对照改造。
- 重写成 SaaS 版本模块。
- 形成自有 `AgentRuntime`、`SkillRegistry`、`MemoryStore`。

第三阶段：

- 若项目准备对外推广或商业化，联系 HBAI-Ltd 申请书面商业授权，或确认当前使用方式不触发授权限制。

## 7. 工程落地映射

本项目模块映射：

- Toonflow `scriptAgent` -> `apps/api/src/agents/script-agent.ts`
- Toonflow `productionAgent` -> `apps/api/src/agents/production-agent.ts`
- Toonflow `data/skills` -> `prompt_templates` + `apps/api/src/agents/skills`
- Toonflow `o_assets` -> `assets`
- Toonflow `o_storyboard` -> `storyboards`
- Toonflow `o_tasks` -> `generation_tasks`
- Toonflow `o_vendorConfig` -> `model_providers`
- Toonflow `memories` -> `agent_memories`

