# 剧本分场与设计总台 V2 对标调研方案

更新日期：2026-07-07

## 当前问题判断

当前线上 V1 的“剧本分场工作台”已经具备底层生产字段，但 UI 和工作流还有明显问题：

- 分场页承载了太多职责：剧本解析、角色候选、场景候选、风险检查、分镜重建入口都挤在同一屏。
- 页面视觉不饱满：右侧大面积空白，状态卡漂浮，列高不一致，局部小控件大小和间距不统一。
- 信息没有主次：用户真正想看的是“故事怎么被拆成可生产画面”，但当前主要看到的是文本框和检查项。
- 解析逻辑偏弱：场名容易变成“关键场景”，没有稳定提取地点、时间、动作目标、人物关系、台词、情绪、镜头意图。
- 当前页更像“解析结果表”，还不是“生产工作台”。

结论：剧本分场应该变成生产前的“解析确认层”，不要承担最终主工作台；主体验应该前移到“设计总台”。

## 对标产品观察

### 1. StudioBinder

参考：https://www.studiobinder.com/script-breakdown-software/
参考：https://www.studiobinder.com/storyboard-creator/

重点学习：

- 传统制片工具的核心不是把剧本文字摆满，而是“标记元素 -> 同步到 stripboard、shot list、call sheet、reports”。
- 剧本拆解会产出可调度的 scene breakdown sheet，每个场景需要 cast、props、locations、wardrobe、VFX 等元素。
- Storyboard 和 script 是联动关系，脚本导入后按场景生成故事板，镜头标签再进入 shot list。

适合借鉴：

- 左侧保留剧本/场次定位。
- 中间用场景或镜头卡作为主对象。
- 右侧是所选场景/镜头的 breakdown inspector。
- 解析结果要进入后续生产清单，而不是停留在文本解释。

### 2. Celtx

参考：https://www.celtx.com/product/pre-production/breakdown/
参考：https://support.celtx.com/hc/en-us/articles/216581678-Breakdown

重点学习：

- Breakdown mode 关注“每一场里的人、地点、物件”，并把这些资产加入 Catalog。
- Catalog 资产可以继续补充媒体、预算、演员等信息。
- 它的工作流是：剧本导入/编写 -> scene-by-scene breakdown -> catalog enrichment -> scheduling。

适合借鉴：

- Manjiao 需要“生产资产库”视角：角色、场景、道具、服装、VFX/风险不是散点，而是可复用资产。
- 每个场景卡应显示“资产完整度”，例如角色 2/2、场景 1/1、道具 3/5、台词风险 0。

### 3. Filmustage

参考：https://filmustage.com/script-breakdown/
参考：https://help.filmustage.com/en/articles/8282284-features-summary

重点学习：

- AI 自动识别 cast、props、locations、VFX，并追踪元素在剧本里的每次出现。
- 核心价值是减少人工拆解时间，并把结果转为 schedule、DOOD、风险/挑战分析。
- 自动化产品通常要给用户“可信度 + 可修正入口”，不能只给一个黑盒结果。

适合借鉴：

- Manjiao 的分场解析需要 confidence 和 editable result。
- 风险项要从黄色提示升级为“可处理任务”，例如台词过长、地点不明确、角色身份缺失、镜头时长过长。

### 4. LTX Studio

参考：https://ltx.io/studio
参考：https://ltx.io/blog/how-to-storyboard

重点学习：

- AI 视频产品的中心是从 scripting/storyboarding 到 editing/final delivery 的一体化链路。
- Storyboard 阶段要锁定 look、cast、continuity，再交给 script-to-video。
- 对 AI 视频来说，“故事板/画面预览”比传统 breakdown 表格更重要。

适合借鉴：

- Manjiao 不应该让用户长期停在文字解析屏，而应快速进入画面化的设计总台。
- 角色一致性、场景连续性、镜头风格应该在总台里横向查看。

### 5. Boords

参考：https://boords.com/docs/creating-storyboards
参考：https://boords.com/ai-storyboard-generator

重点学习：

- Storyboard 创建入口有三种：导入脚本、AI 写作、空白画布。
- AI storyboard 把 script/prompt 转成 shot-by-shot frames，目标是快速按镜头规划视频。
- Board-first 产品把“画面卡片序列”作为中心，而不是把脚本文字作为中心。

适合借鉴：

- Manjiao 的设计总台应以“镜头卡矩阵/故事板画廊”为主屏。
- 每张卡固定比例，有画面、镜头号、角色、场景、状态、风险、下一步按钮。

### 6. Katalist

参考：https://www.katalist.ai/
参考：https://www.katalist.ai/ai-storyboard-generator

重点学习：

- Script Assistant 先识别 key scenes、characters、activities，再由 AI Storyboard Generator 生成视觉 storyboard。
- 它强调“从剧本到画面”的翻译层，而不是单纯脚本管理。

适合借鉴：

- Manjiao 的差异化应该是“中文短剧/漫剧生产翻译层”：剧本 -> 场景 -> 角色/场景资产 -> 镜头图 -> 视频。
- 分场的 UI 不必像制片软件那么重，但必须更像 AI 生产控制台。

### 7. Runway

参考：https://academy.runwayml.com/tutorial/storyboard-featured-workflow
参考：https://runwayml.com/research/gen-2

重点学习：

- Runway 更偏生成工具，但它的 Storyboard/Workflow 思路强调“序列一致性”和“图像/文本/视频多模态输入”。
- 对 Manjiao 来说，后续镜头图和视频闭环要保留多模态入口：文本、角色参考、场景参考、首尾帧。

适合借鉴：

- 设计总台应把每个镜头的输入依赖显示清楚：角色参考、场景参考、首帧、视频片段、字幕/配音。

## 推荐的新工作流

不要把“剧本分场工作台”作为主工作台。建议改成：

```text
1. 剧本解析层
   上传/粘贴剧本 -> 自动解析场次、角色、地点、动作、台词、风险 -> 用户确认/修正

2. 设计总台
   以场景/镜头视觉矩阵为核心，集中查看角色、场景、分镜图、镜头状态、风险和生成进度

3. 精修工作台
   单独进入角色精修、场景精修、单镜头导演台、分镜图精修

4. 视频闭环总台
   镜头视频、配音、字幕、封面、合成、导出、发布检查
```

## 新页面信息架构

### A. 剧本解析层：轻量确认页

目的：把剧本变成结构化生产数据，不负责最终生产。

布局建议：

- 顶部：解析状态、剧本版本、总场次、总镜头预估、风险数、进入设计总台按钮。
- 左侧：剧本原文或场次目录，可按场景跳转。
- 中间：分场卡列表，固定高度、统一卡片结构。
- 右侧：选中场景的解析 inspector。

每个场景卡字段：

- 场次编号
- 场名：地点 + 动作目标，不再泛化为“关键场景”
- 时间：白天/夜晚/清晨/未知
- 地点：室内/室外 + 具体地点
- 人物：主/次角色
- 动作目标：这一场发生了什么
- 台词量：0/短/中/长
- 镜头预估：例如 3 镜头
- 风险：地点不明、角色缺图、长台词、转场不清

### B. 设计总台：主生产视图

目的：让用户第一眼看到“这部片怎么被设计成画面”，视觉更饱满。

推荐布局：

- 顶部一条完整生产进度条：剧本 -> 角色 -> 场景 -> 分镜图 -> 视频 -> 导出。
- 左侧窄栏：场景列表/章节列表，固定宽度，不留巨大空白。
- 中间主区：故事板矩阵，按场景分组，每个镜头一张 16:9 或 9:16 固定比例卡。
- 右侧 inspector：选中镜头/场景/角色时显示精修入口和依赖状态。
- 底部可选：时间线条，显示镜头顺序、时长、视频完成度。

主区镜头卡应该包含：

- 画面预览或待生成占位图。
- 镜头号、景别、运动、时长。
- 角色头像/资产锁定状态。
- 场景资产状态。
- 图片/视频/字幕/配音四个小状态点。
- 一键进入“单镜头导演台”。

### C. 精修工作台：对象级编辑

每类对象单独进一个高密度工作台：

- 角色精修：身份板、三视图、参考图、服装变体、一致性评分。
- 场景精修：场景图、光线、道具、风格、可复用场景资产。
- 单镜头导演台：构图、景别、运镜、角色站位、首帧、视频提示词。
- 分镜图精修：批量对比、替换参考、局部重生成。

## UI 改版原则

- 固定网格：左 280px，中间自适应，右 360px；不要让右侧空一大片。
- 卡片等高：场景卡、状态卡、检查卡要统一高度规则。
- 视觉优先：主工作台必须出现画面卡片/缩略图/占位图，而不是纯文本表单。
- 状态合并：顶部状态卡不要漂浮，统一放进 pipeline strip。
- 操作聚合：每个对象只保留一个主按钮，次级操作放在 inspector。
- 颜色收敛：保留暗色生产台，但减少多层蓝框，增强对比层级。
- 文案收敛：场名、动作目标、风险必须像生产数据，不像 AI 摘要作文。

## 分场解析逻辑升级

解析不要只按段落粗切，应按以下层级：

1. 识别场景边界：slug line、时间地点变化、人物进出、动作目标变化。
2. 提取场景元数据：地点、时间、内外景、主角色、次角色、场景目标。
3. 提取生产元素：角色、地点、道具、服装、VFX/特效、声音、台词。
4. 拆动作 beat：每个 beat 对应可能的镜头段。
5. 生成镜头意图：不是立即生图，而是估算镜头数、景别、情绪和转场。
6. 生成风险：缺地点、缺角色资产、长台词、连续性风险、画面不可拍风险。
7. 允许人工确认：每个场景都可重命名、合并、拆分、锁定。

推荐输出对象：

```ts
type ParsedScene = {
  sceneNo: number;
  title: string;
  location: string;
  timeOfDay: string;
  interiorExterior?: "INT" | "EXT" | "UNKNOWN";
  characters: string[];
  actionGoal: string;
  beats: Array<{ summary: string; estimatedShots: number; emotion?: string }>;
  dialogueLines: Array<{ speaker?: string; text: string }>;
  productionElements: {
    cast: string[];
    locations: string[];
    props: string[];
    wardrobe: string[];
    sound: string[];
    vfx: string[];
  };
  risks: Array<{ level: "info" | "warning" | "blocker"; message: string; fixAction: string }>;
  confidence: number;
};
```

## 差异化定位

Manjiao 不应只复制 StudioBinder，也不应只做 Boords 式故事板。它的差异化应该是：

> 中文漫剧/短剧 AI 生产台：把剧本自动翻译成可生成、可精修、可导出的视频生产资产链。

核心优势：

- 中文短剧语义解析更准。
- 角色一致性和场景复用前置。
- 单镜头可精修，整体可批量查看。
- 最终闭环到视频、字幕、配音、封面和导出。

## 推荐下一步实施顺序

1. 先保留 V1 baseline，可随时回滚。
2. 重做“剧本解析层”UI：变轻、变整齐、变成确认页。
3. 新增“设计总台”作为主工作台：以故事板矩阵/视觉卡片为中心。
4. 把角色/场景/分镜图/单镜头精修入口挂到设计总台 inspector。
5. 最后再做视频闭环总台。

短期优先级：先做第 2 和第 3 步，不要继续在当前分场页上堆 UI。
