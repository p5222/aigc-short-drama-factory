# 项目生产台 V2 Product Design Brief

更新日期：2026-07-07

用途：给 Product Design 生成效果图、给前端实现新版工作台做准入稿。

## 1. 设计目标

把当前“剧本分场工作台”改成两层体验：

1. 剧本解析层：轻量确认页，负责把剧本解析成可生产数据。
2. 设计总台：主工作台，负责集中查看角色、场景、分镜图、镜头状态和生产风险。

不再让“剧本分场页”独自承担生产总台职责。当前页的问题是文字太多、右侧空、列高不齐、小 UI 散乱、缺少画面预览，所以看起来不饱满。

## 2. V1 视觉参考

- V1 baseline tag：`manjiao-frontend-v1.0`
- V1 截图：`docs/version-snapshots/manjiao-frontend-v1-script-scene-workbench.png`
- 保留：暗色生产工具气质、顶部流程感、中文 SaaS 控制台方向。
- 改掉：大面积空白、卡片高低不一、过多蓝框嵌套、文本表单堆叠、右侧信息漂浮。

## 3. 目标用户

- 中文漫剧/短剧创作者。
- 需要把剧本快速拆成角色、场景、镜头图、视频片段。
- 既需要批量查看整体进度，也需要进入单个角色、场景、镜头做精修。

## 4. 核心产品判断

新的主逻辑应该是：

```text
剧本解析确认 -> 设计总台 -> 角色/场景/单镜头精修 -> 视频闭环导出
```

剧本解析层是“把文字变成结构化生产数据”。
设计总台是“把结构化数据变成可视化生产计划”。
精修工作台是“把某个对象打磨到可生成”。
视频闭环是“把镜头视频、字幕、配音和导出串起来”。

## 5. 效果图方向

需要生成 3 个不同方向的桌面端效果图，尺寸统一为 `1440 x 1024`。

### 方向 A：解析确认台

定位：保守、清晰、适合先替换当前剧本分场页。

结构：

- 顶部：项目标题、剧本版本、解析状态、进入设计总台主按钮。
- 左侧 280px：场景目录，列表等高，支持风险/未确认/已确认筛选。
- 中间：场景解析卡，使用统一高度和明确字段区块。
- 右侧 360px：解析 inspector，显示角色、地点、道具、风险、修正建议。

视觉要求：

- 不要让右侧空白。
- 每张场景卡高度一致或有稳定最小高度。
- 字段采用表格/属性网格，不要像散落的小卡片。
- 保留暗色，但减少厚重蓝框。

### 方向 B：设计总台

定位：推荐主方向。更像 AI 视频生产工具，视觉饱满。

结构：

- 顶部：完整生产 pipeline，剧本、角色、场景、分镜图、视频、导出。
- 左侧 260px：场景/章节导航。
- 中间主区：故事板矩阵，按场景分组，每个镜头固定比例卡片。
- 右侧 360px：选中镜头 inspector，显示角色资产、场景资产、首帧、视频、字幕、风险。
- 底部：轻量时间线，显示镜头顺序和时长。

视觉要求：

- 中间必须以画面卡片为主，哪怕是待生成占位，也要有可视化画面容器。
- 镜头卡统一比例，显示镜头号、景别、时长、状态点、角色头像。
- 右侧 inspector 有明确主操作：进入单镜头导演台。
- 页面第一眼要像“这部片已经在生产线上了”。

### 方向 C：导演总控台

定位：更强生产感，适合后续视频闭环总台。

结构：

- 顶部：项目状态、成本预估、生成队列、风险总数。
- 左侧：生产阶段切换。
- 中间：镜头时间线 + 当前镜头大预览。
- 右侧：角色/场景/视频依赖。
- 底部：批量操作条，生成缺失镜头图、生成视频、导出。

视觉要求：

- 更像导演控制室，但不要花哨。
- 重点突出“当前镜头”和“整体序列”。
- 适合视频生成阶段，不一定作为剧本解析后的第一屏。

## 6. 推荐组合

推荐使用：

```text
方向 A 作为剧本解析确认页
方向 B 作为设计总台主工作台
方向 C 的时间线和闭环能力放到视频总台
```

下一版优先做方向 B，因为它最能解决当前页面空、散、文本重的问题。

## 7. Product Design 效果图提示词

### Prompt 1：剧本解析确认台

```text
Create a realistic production-quality desktop SaaS UI mockup, 1440 x 1024.

Product: Manjiao, a Chinese AI short-drama / comic-drama production workbench.
Screen: Script parsing confirmation workspace.
Language: Chinese UI labels.
Audience: creators turning a script into scenes, characters, locations, shot intentions, and production risks.

Use the provided V1 screenshot as visual context. Preserve the dark production-console mood, compact professional SaaS density, and Chinese creative tool feel. Improve the layout so columns are balanced, cards align, and there is no large empty right side.

Layout:
- Top bar with project title, script version, parse status, total scenes, estimated shots, risk count, and a primary button labelled "进入设计总台".
- Left rail 280px: scene list with filters 全部 / 未确认 / 有风险 / 已确认. Rows are equal height and show scene number, title, location/time, estimated shots, and status.
- Main center: selected scene parsing card. Use a clean property grid for 地点, 时间, 人物, 动作目标, 情绪, 台词量, 镜头预估. Add a compact original-script excerpt below.
- Right inspector 360px: production elements grouped as 角色, 场景, 道具, 声音, 风险. Each item has confidence and edit affordance.

Visual style:
- Dark navy base, subtle slate surfaces, restrained cyan/teal accents, one warm warning color.
- No nested cards inside cards.
- Consistent 8px or lower border radius.
- Strong alignment and equal heights.
- Avoid decorative gradient blobs, oversized hero treatment, marketing copy, or empty panels.
- Use lucide-style line icons where appropriate.

The screen should feel like a mature production tool, not a landing page.
```

### Prompt 2：设计总台主工作台

```text
Create a realistic production-quality desktop SaaS UI mockup, 1440 x 1024.

Product: Manjiao, a Chinese AI short-drama / comic-drama production workbench.
Screen: Design command desk after script parsing.
Language: Chinese UI labels.
Goal: show the whole story as visual production cards, with clear routes into character, scene, shot image, and video refinement.

Use the provided V1 screenshot as context but redesign the information architecture. Preserve the dark professional production-console direction, but make the layout fuller, cleaner, and more visual.

Layout:
- Top production pipeline strip: 剧本解析, 角色锁定, 场景资产, 分镜图, 视频片段, 导出. Show counts and completion states in one horizontal strip.
- Left rail 260px: scene groups, each row shows 场次, 地点, 时间, 镜头数, risk badge. Fixed row height.
- Center main canvas: storyboard matrix grouped by scene. Each shot is a fixed-ratio card with a visual thumbnail area, shot number, duration, shot size, camera movement, character chips, scene chip, and four status dots: 图, 视, 字, 音.
- Right inspector 360px: selected shot details with thumbnail, dependencies, risk list, and primary button "进入单镜头导演台". Secondary buttons: 精修角色, 精修场景, 重生成分镜图.
- Bottom: compact timeline strip with shot blocks and duration labels.

Visual style:
- Dense but elegant dark SaaS interface.
- Use real visual placeholders for storyboard thumbnails: neutral cinematic frame blocks or low-detail mock frames, not blank boxes.
- Cards must align in a strict grid and maintain stable dimensions.
- Avoid huge empty areas and scattered mini controls.
- No page sections as floating marketing cards.
- No purple-blue gradient dominated palette.
- Text must fit inside controls and cards.

The first impression should be: "this is the central production desk for turning a script into publishable video."
```

### Prompt 3：视频闭环导演总控台

```text
Create a realistic production-quality desktop SaaS UI mockup, 1440 x 1024.

Product: Manjiao, a Chinese AI short-drama / comic-drama production workbench.
Screen: Director control desk for final video production loop.
Language: Chinese UI labels.
Goal: show shot video generation, voiceover, subtitles, timeline, and export readiness in one dense production dashboard.

Layout:
- Top status strip: overall readiness, generated clips, missing clips, subtitle status, voiceover status, export readiness, estimated cost.
- Left rail: episode/scene navigation and batch filters.
- Center: large current shot preview above a horizontal video timeline. Timeline blocks show shot number, duration, video status, subtitle status, and voice status.
- Under preview: shot prompt, first frame, generated video variants, and regenerate controls.
- Right inspector: continuity checklist, audio/subtitle panel, export checklist, and a primary button "导出可发布视频".

Visual style:
- Mature dark production control room, but still clean SaaS.
- Use restrained cyan/green status accents and warm amber for blockers.
- Fixed grid, consistent panel heights, no empty right gutter.
- Video/timeline elements should be visually substantial and readable.
- Avoid decorative backgrounds, bokeh, gradient blobs, and marketing hero style.
```

## 8. 前端实施验收标准

实现前必须满足：

- 页面入口明确分为：剧本解析层、设计总台、视频闭环总台。
- 当前“剧本分场工作台”不要继续堆更多卡片。
- 设计总台首屏必须有画面卡片矩阵。
- 每个主要区域有稳定尺寸：左栏、主画布、右 inspector。
- 移动端可纵向堆叠，但桌面端不能出现大面积空白。
- 状态统计统一进入顶部 pipeline strip，不再散落在页面右上角。
- 操作入口必须对象化：场景、角色、镜头、视频各有自己的精修入口。
- 若 V2 效果不如 V1，按 `manjiao-frontend-v1.0` 回滚。

## 9. 下一步动作

建议顺序：

1. 用 Prompt 2 先生成“设计总台”效果图。
2. 如果方向正确，再生成 Prompt 1 作为轻量剧本解析确认页。
3. 选定效果图后，进入前端实现。
4. 实现后用 V1 截图和 V2 截图做对比，确认 V2 没有比 V1 更散、更空。
