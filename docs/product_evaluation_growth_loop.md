# 漫角产品评测闭环与数据驱动迭代方案

更新时间：2026-07-01

## 1. 核心判断

功能落地只是第一步。这个项目真正需要证明的价值不是“AI 能生成东西”，而是：

1. 能否把创作者从故事输入带到可用的分镜图、视频草稿和成片资产。
2. 能否持续降低生成失败、角色漂移、提示词难用、成本不可控这些问题。
3. 能否把用户真实使用数据沉淀为后台可分析的评测系统，再反向驱动提示词、模型路由、工作流和 UI 迭代。

所以漫角的闭环不是“上线一个工具”，而是：

用户进入 -> 领取额度 -> 创建作品 -> 生成剧本/角色/分镜/图片/视频 -> 用户反馈 -> AI 自动评测 -> 后台聚合问题 -> 调整提示词/模型/UI/流程 -> 再验证指标是否改善。

## 2. 用户痛点与产品目标

### 2.1 目标用户

- 小红书、抖音、视频号等平台的 AI 漫剧/短剧尝试者。
- 网文、短剧、漫画方向的个人创作者。
- 有小说或故事 IP，想快速视觉化验证的人。
- 小团队内容生产者，关心成本、效率和批量生成。

### 2.2 真实痛点

1. 不知道如何把小说拆成短剧脚本和分镜。
2. 角色一致性差，前后脸、发型、服装漂移，导致后续视频没有生产意义。
3. 分镜图生成失败或不符合剧情，用户不知道应该改哪一段提示词。
4. 模型太多，成本、成功率和质量不可控。
5. 生成流程割裂，剧本、角色、分镜、图片、视频之间数据没有自然承接。
6. 工具看起来功能很多，但用户无法判断“做到哪一步才算完成”。
7. 运营拿不到反馈数据，只能凭感觉优化。

### 2.3 产品目标

漫角要成为“AI 漫剧创作生产台”，第 一阶段目标不是完全自动生成商业成片，而是稳定帮助用户完成：

1. 从故事输入生成可编辑短剧脚本。
2. 从脚本抽取角色，并生成角色一致性多视图参考。
3. 从脚本生成镜头级分镜。
4. 从分镜生成可用首帧图。
5. 从首帧图进入视频草稿生成。
6. 后台能评估每个项目、每个阶段、每个模型、每个提示词版本的表现。

## 3. 北极星指标

第一阶段建议用：

**有效作品完成数**

定义：用户创建项目后，至少完成“剧本确认 + 主要角色定稿 + 80% 分镜图生成成功”，且用户或 AI 评测认为结果达到可继续生产标准。

不建议一开始用“注册用户数”或“生成次数”做核心指标，因为这些指标会鼓励无效消耗，不能证明产品真的有用。

## 4. 指标体系

### 4.1 拉新与激活

- 访问登录页人数。
- 注册成功率。
- 兑换码领取/兑换成功率。
- 首次创建项目率。
- 首次生成剧本成功率。
- 首次生成角色图成功率。
- 首次生成分镜图成功率。
- 从注册到第一张真实分镜图的时间。

### 4.2 生产链路

- 项目创建数。
- 剧本生成成功率。
- 角色定稿完成率。
- 分镜拆解成功率。
- 分镜图生成成功率。
- 视频草稿提交成功率。
- 项目阶段流失率：故事输入 -> 剧本 -> 角色 -> 分镜 -> 图片 -> 视频。
- 单项目平均重试次数。
- 单项目平均人工编辑次数。

### 4.3 质量指标

- 剧本质量分。
- 角色一致性分。
- 分镜可拍性分。
- 图片提示词匹配分。
- 分镜图可用率。
- 视频首帧可用率。
- 用户满意度。
- 用户标记的失败原因。

### 4.4 成本指标

- 单项目消耗积分。
- 单项目真实模型成本。
- 单张可用分镜图成本。
- 单个有效作品成本。
- 不同模型的成功率、平均耗时、平均质量分、平均成本。
- 失败任务退款率。

### 4.5 留存与商业化

- D1/D7 回访率。
- 第二个项目创建率。
- 兑换码用户转付费率。
- 9.9 低价包购买率。
- 充值后完成作品率。
- 高质量用户来源渠道。

## 5. 阶段评测标准

### 5.1 剧本阶段

满分 100，建议权重：

- 结构完整度 20：是否有开端、冲突、转折、结尾或钩子。
- 爽点/看点 20：是否有适合短剧传播的强动机、反转、情绪点。
- 集数拆分 15：是否符合用户选择的集数和字数规模。
- 角色清晰度 15：主要角色身份、关系、目标是否明确。
- 可视化程度 15：是否容易转成镜头和画面。
- 生产可行性 15：是否避免过多无法生成的复杂场景和抽象表达。

通过线：75 分。

### 5.2 角色定稿阶段

满分 100，建议权重：

- 角色身份清晰 15。
- 外貌和服装可稳定描述 20。
- 多视图一致性 25。
- 与故事设定匹配 15。
- 参考图遵循度 15。
- 负面提示词完整度 10。

通过线：80 分。角色低于 80 分时，不建议继续批量生成分镜图。

### 5.3 分镜阶段

满分 100，建议权重：

- 镜头编号和顺序清晰 10。
- 每个镜头画面描述可生成 20。
- 角色、场景、动作承接合理 20。
- 景别/运镜不过度复杂 15。
- 每集节奏合理 15。
- 图片提示词和视频提示词完整 20。

通过线：75 分。

### 5.4 图片阶段

满分 100，建议权重：

- 画面是否符合提示词 20。
- 角色一致性 25。
- 构图和画幅正确 15。
- 无严重畸形、水印、文字污染 20。
- 可作为视频首帧 20。

通过线：80 分。

### 5.5 视频阶段

满分 100，建议权重：

- 首帧保持度 20。
- 人物身份保持 20。
- 动作自然度 20。
- 镜头意图表达 20。
- 可剪辑/可发布程度 20。

通过线：70 分。视频阶段早期模型不稳定，可以先放宽，通过后台持续观察。

## 6. 数据来源

### 6.1 用户行为数据

需要埋点：

- visit_login
- register_success
- login_success
- redeem_code_success
- create_project_start
- create_project_success
- generate_script_start / success / fail
- generate_character_start / success / fail
- lock_character_reference
- upload_character_reference
- generate_storyboard_start / success / fail
- edit_storyboard_shot
- generate_image_start / success / fail
- regenerate_image
- generate_video_start / success / fail
- export_storyboard
- submit_feedback
- recharge_start / success

每个事件至少包含：

- userId
- projectId
- stage
- provider
- model
- promptVersion
- taskId
- durationMs
- costCredits
- success
- errorCode
- errorReason
- sourceChannel
- campaignCode

### 6.2 任务结果数据

复用现有 GenerationTask，再补充：

- requestPayloadHash
- promptVersion
- modelLatencyMs
- providerCost
- retryCount
- failureCategory
- outputAssetIds

### 6.3 用户反馈数据

在剧本、角色、分镜图、视频草稿每个阶段给一个轻反馈入口：

- 这一步是否可用：可用 / 勉强可用 / 不可用。
- 失败原因标签：不符合剧情、角色不像、图崩了、画风不对、提示词不懂改、生成太慢、成本太高、结果空白。
- 用户补充说明。
- 是否愿意继续下一步。

### 6.4 AI 自动评测数据

每次生成成功后，系统调用文本模型做结构化评测，输出：

- stage
- totalScore
- dimensionScores
- pass
- problems
- suggestedFixes
- recommendedAction

## 7. 建议数据表

### 7.1 analytics_events

用于记录用户行为和漏斗。

- id
- user_id
- session_id
- event_name
- entity_type
- entity_id
- project_id
- task_id
- source_channel
- campaign_code
- properties JSON
- created_at

### 7.2 quality_reports

用于记录 AI 评测、用户评分和管理员复核。

- id
- project_id
- task_id
- asset_id
- stage
- evaluator_type：ai / user / admin
- total_score
- pass
- dimension_scores JSON
- problems JSON
- suggestions JSON
- prompt_version
- provider
- model
- created_at

### 7.3 user_feedback

用于记录用户在前台提交的轻反馈。

- id
- user_id
- project_id
- task_id
- asset_id
- stage
- rating
- usability：usable / barely_usable / unusable
- tags String[]
- content
- created_at

### 7.4 prompt_versions

用于追踪提示词版本。

- id
- key
- name
- stage
- version
- content
- status
- owner
- notes
- created_at

### 7.5 experiment_runs

用于 A/B 测试提示词或模型路由。

- id
- name
- stage
- hypothesis
- baseline_version
- candidate_version
- traffic_ratio
- start_at
- end_at
- success_metric
- result_summary
- status

### 7.6 campaign_codes

用于运营渠道追踪。可以和兑换码模块合并或关联。

- id
- campaign_name
- source_channel：xiaohongshu / douyin / private_domain / manual
- code_prefix
- quota
- credits
- valid_until
- created_count
- redeemed_count
- activated_project_count
- effective_project_count

## 8. 后台评测闭环页面

### 8.1 评测总览

展示：

- 今日/本周有效作品数。
- 各阶段转化率。
- 各阶段平均质量分。
- 失败任务数量和失败原因排行。
- 模型成本和可用率排行。
- 社交媒体兑换码转化数据。

### 8.2 项目质检池

按项目展示：

- 用户信息。
- 来源渠道。
- 当前阶段。
- 质量总分。
- 剧本分、角色分、分镜分、图片分、视频分。
- 用户反馈标签。
- 管理员复核状态。

### 8.3 失败样本库

聚合失败任务：

- provider/model。
- 错误原因。
- 输入摘要。
- 提示词版本。
- 是否退款。
- 是否已修复。

这个页面用于判断到底是模型问题、提示词问题、代码问题还是用户输入问题。

### 8.4 提示词实验台

展示：

- 当前线上提示词版本。
- 候选提示词版本。
- A/B 实验数据。
- 质量分提升。
- 成本变化。
- 失败率变化。

### 8.5 用户反馈台

展示：

- 用户原始反馈。
- 关联作品和资产。
- 反馈标签聚类。
- 是否已处理。
- 处理结论：改提示词 / 改 UI / 换模型 / 加教程 / 暂不处理。

## 9. 运营冷启动方案

### 9.1 小红书引流路径

建议路径：

1. 小红书帖子展示“从故事到 AI 漫剧分镜”的结果。
2. 评论或私信领取测试兑换码。
3. 用户进入漫角网站注册。
4. 输入兑换码获得限定积分。
5. 引导完成第一个项目。
6. 生成完成后弹出轻反馈。
7. 后台自动收集作品质量和用户反馈。
8. 挑选高质量案例做二次内容。

### 9.2 兑换码策略

第一批测试建议：

- 每个兑换码唯一。
- 每个码只能用一次。
- 额度足够完成一个小项目，例如剧本 + 角色 + 9 宫格分镜图。
- 兑换码绑定来源渠道和活动名称。
- 限定 7 天有效，制造行动理由。

### 9.3 9.9 低价包策略

不建议一开始直接卖高价会员。先做：

- 9.9 新手体验包：适合完成 1 个短剧小样。
- 19.9 创作包：适合做 2-3 个短剧测试。
- 后台观察购买后的有效作品完成率。

真正有价值的不是充值本身，而是“付费用户是否能完成作品”。

## 10. 每周迭代机制

每周固定看 5 张表：

1. 漏斗表：用户卡在哪一步。
2. 质量表：哪一阶段质量最低。
3. 失败表：哪个模型和接口最不稳定。
4. 成本表：哪个环节烧钱但不可用。
5. 反馈表：用户最常抱怨什么。

每周只做 1-3 个高优先级改动，避免无限堆功能。

标准格式：

- 发现问题：例如角色定稿完成率只有 35%。
- 数据证据：用户反馈里 48% 标记“角色不像”。
- 假设原因：角色多视图提示词不稳定，且用户不知道先锁定角色。
- 改动方案：角色定稿页增加“锁定角色后再生成分镜”的强提示，优化多视图提示词。
- 验证指标：角色定稿完成率从 35% 提到 55%，图片重生次数下降 20%。

## 11. AI 评测提示词

### 11.1 剧本质量评测提示词

```text
你是专业短剧编剧总监和 AI 漫剧生产评测员。请评估下面这份短剧剧本是否适合继续进入角色定稿和分镜生产。

请只输出 JSON，不要输出解释性废话。

评测维度：
1. structure_score：结构完整度，0-20。
2. hook_score：爽点/看点强度，0-20。
3. episode_score：集数拆分合理性，0-15。
4. character_score：角色目标和关系清晰度，0-15。
5. visual_score：可视化程度，0-15。
6. production_score：生产可行性，0-15。

请输出：
{
  "totalScore": number,
  "pass": boolean,
  "dimensionScores": {
    "structure": number,
    "hook": number,
    "episode": number,
    "character": number,
    "visual": number,
    "production": number
  },
  "mainProblems": ["最多5条"],
  "suggestedFixes": ["最多5条"],
  "recommendedAction": "continue | rewrite_script | clarify_characters | reduce_complexity"
}

项目信息：
题材：{{genre}}
目标集数：{{targetEpisodes}}
画风：{{artStyle}}

剧本内容：
{{scriptContent}}
```

### 11.2 角色一致性评测提示词

```text
你是 AI 漫剧角色一致性评测员。请根据角色设定、参考图描述、多视图结果描述，判断该角色是否已经适合进入分镜批量出图。

请只输出 JSON。

评分维度：
1. identity_score：角色身份是否清晰，0-15。
2. appearance_score：外貌和服装是否可稳定描述，0-20。
3. multiview_score：正面、侧面、背面是否一致，0-25。
4. story_match_score：是否符合故事设定，0-15。
5. reference_follow_score：是否遵循用户上传参考图，0-15。
6. negative_prompt_score：负面提示词是否完整，0-10。

输出：
{
  "totalScore": number,
  "pass": boolean,
  "dimensionScores": {
    "identity": number,
    "appearance": number,
    "multiview": number,
    "storyMatch": number,
    "referenceFollow": number,
    "negativePrompt": number
  },
  "mainProblems": ["最多5条"],
  "suggestedFixes": ["最多5条"],
  "recommendedAction": "lock_character | regenerate_multiview | edit_prompt | upload_reference"
}

角色设定：
{{characterProfile}}

参考图描述：
{{referenceDescription}}

多视图生成结果描述：
{{multiviewDescription}}
```

### 11.3 分镜质量评测提示词

```text
你是短剧分镜导演和 AI 生成可用性评测员。请评估以下分镜表是否适合进入分镜图生成。

请只输出 JSON。

评分维度：
1. order_score：镜头编号和顺序是否清晰，0-10。
2. imageability_score：画面描述是否可生成，0-20。
3. continuity_score：角色、场景、动作是否承接合理，0-20。
4. simplicity_score：景别和运镜是否简洁可执行，0-15。
5. rhythm_score：每集节奏是否合理，0-15。
6. prompt_score：图片提示词和视频提示词是否完整，0-20。

输出：
{
  "totalScore": number,
  "pass": boolean,
  "dimensionScores": {
    "order": number,
    "imageability": number,
    "continuity": number,
    "simplicity": number,
    "rhythm": number,
    "prompt": number
  },
  "badShots": [
    {
      "shotNo": "镜头编号",
      "problem": "问题",
      "fix": "修改建议"
    }
  ],
  "recommendedAction": "generate_images | edit_bad_shots | regenerate_storyboard"
}

角色设定：
{{characters}}

分镜表：
{{storyboards}}
```

### 11.4 分镜图质量评测提示词

```text
你是 AI 分镜图质检员。请根据镜头设定和图片描述，判断图片是否可作为视频首帧继续生产。

请只输出 JSON。

评分维度：
1. prompt_match_score：是否符合镜头提示词，0-20。
2. character_consistency_score：角色是否一致，0-25。
3. composition_score：构图和画幅是否正确，0-15。
4. artifact_score：是否无严重畸形、水印、文字污染，0-20。
5. video_ready_score：是否适合作为图生视频首帧，0-20。

输出：
{
  "totalScore": number,
  "pass": boolean,
  "dimensionScores": {
    "promptMatch": number,
    "characterConsistency": number,
    "composition": number,
    "artifact": number,
    "videoReady": number
  },
  "mainProblems": ["最多5条"],
  "suggestedFixes": ["最多5条"],
  "recommendedAction": "accept | regenerate_same_prompt | edit_prompt | regenerate_character"
}

镜头设定：
{{shot}}

图片提示词：
{{imagePrompt}}

图片描述或视觉模型识别结果：
{{imageCaption}}
```

### 11.5 用户反馈归因提示词

```text
你是 SaaS 产品经理。请把用户反馈归类为可执行的问题，并判断应该由哪个模块处理。

请只输出 JSON。

可选模块：
login_ui, wizard_flow, script_agent, character_agent, storyboard_agent, image_provider, video_provider, billing, admin, performance, documentation

可选问题类型：
bug, quality, usability, cost, speed, expectation_gap, missing_feature

输出：
{
  "module": "string",
  "issueType": "string",
  "severity": "P0 | P1 | P2 | P3",
  "summary": "一句话总结",
  "evidence": "用户反馈中的证据",
  "suggestedAction": "建议动作",
  "metricToWatch": "后续验证指标"
}

用户反馈：
{{feedback}}

关联任务信息：
{{taskInfo}}

关联项目阶段：
{{stage}}
```

### 11.6 周报分析提示词

```text
你是 AI 创作 SaaS 的增长负责人和产品负责人。请基于本周数据，输出下一周最值得做的 3 个迭代。

请按以下结构输出：
1. 本周最重要发现
2. 漏斗最大卡点
3. 质量最大问题
4. 成本最大问题
5. 下周优先级 Top 3
6. 每个优先级的改动方案、验证指标和预期效果

数据：
{{weeklyMetrics}}

用户反馈摘要：
{{feedbackSummary}}

失败任务摘要：
{{failureSummary}}
```

### 11.7 小红书冷启动内容提示词

```text
你是小红书 AI 工具增长运营。请为“漫角 AI 漫剧创作平台”生成一篇冷启动引流帖子。

目标：
- 吸引想做 AI 漫剧、AI 短剧、网文可视化的人。
- 引导用户评论或私信领取测试兑换码。
- 不夸大成片能力，强调可以从故事生成剧本、角色多视图、分镜图和视频草稿。

请输出：
1. 标题 5 个。
2. 正文 1 篇。
3. 评论区引导 5 条。
4. 私信自动回复文案 3 条。
5. 配图建议 6 张。

产品特点：
{{productFeatures}}

当前测试权益：
{{testQuota}}
```

## 12. 开发落地顺序

### 第一阶段：先能记录

目标：所有核心动作都有数据。

要做：

1. 新增 analytics_events 表。
2. 新增 /api/analytics/events 上报接口。
3. 前台登录、兑换码、创建项目、生成任务、反馈按钮埋点。
4. 后台运营总览增加基础漏斗。

验收：

- 能看到某个用户从登录到生成分镜图的完整路径。
- 能按渠道看到兑换码用户的项目创建率。

### 第二阶段：能收反馈

目标：用户不需要写长反馈，也能告诉我们哪里不好。

要做：

1. 新增 user_feedback 表。
2. 剧本、角色、分镜图、视频草稿页面增加轻反馈组件。
3. 后台反馈台展示反馈标签和关联作品。

验收：

- 每个作品阶段都能沉淀“可用/不可用”和失败标签。
- 后台能筛选“角色不像”“图崩了”“生成太慢”等问题。

### 第三阶段：能自动评测

目标：不靠人工一个个看项目。

要做：

1. 新增 quality_reports 表。
2. 剧本、角色、分镜、图片生成成功后调用 AI 评测。
3. 后台项目质检池展示评分。
4. 对低分项目标记原因和建议动作。

验收：

- 每个项目有阶段评分。
- 能筛选低于 80 分的角色、低于 75 分的分镜、低于 80 分的图片。

### 第四阶段：能驱动迭代

目标：通过数据决定改什么。

要做：

1. prompt_versions 表和提示词版本管理。
2. experiment_runs 表。
3. 提示词实验台。
4. 按模型、提示词版本、用户来源查看质量和成本。

验收：

- 能比较两个提示词版本的成功率、质量分、成本。
- 能判断 DeepSeek、通义、豆包、ZML 哪些适合哪个阶段。

### 第五阶段：形成运营闭环

目标：小红书引流和产品数据打通。

要做：

1. 兑换码增加 campaign/source 字段。
2. 后台增加渠道看板。
3. 每周生成产品运营周报。
4. 从高分作品中挑选案例用于二次传播。

验收：

- 能知道哪个帖子或活动带来的用户质量更高。
- 能知道兑换码用户是否真的完成了作品。

## 13. 第一批冷启动验证目标

建议第一批只找 20-50 个用户，不要一开始大规模放量。

目标：

- 注册到兑换码使用率 >= 60%。
- 兑换码使用到创建项目率 >= 50%。
- 创建项目到完成剧本率 >= 70%。
- 创建项目到角色定稿率 >= 40%。
- 创建项目到生成分镜图率 >= 30%。
- 分镜图用户可用率 >= 50%。
- 单项目平均失败任务不超过 2 次。

如果达不到，不急着投放更多流量，先修链路。

## 14. 对外讲述项目时的逻辑

可以这样讲：

我做的不是单纯的 AI 生成工具，而是一个面向 AI 漫剧创作者的生产闭环系统。前半段解决从故事到剧本、角色、分镜、图片、视频的生成链路；后半段建立了质量评测和数据闭环。每一次生成都会记录模型、提示词版本、成本、耗时、用户反馈和 AI 自动评分。后台会把这些数据聚合成漏斗、质量、成本和失败原因，从而判断应该优化提示词、模型路由、角色一致性流程还是前端交互。这样产品不是凭感觉迭代，而是基于真实用户的生成结果持续提升。

