# U 漫剧竞品流程拆解与漫角工作台 V3 UI Brief

Updated: 2026-07-07

## 竞品主流程

1. 全局设定
   - 先选发布比例、画面风格、题材方向。
   - 优点：宽屏铺满，风格用图片卡表达，用户能快速理解后续视觉方向。
   - 可迁移：漫角需要保留“推荐风格 + 高级展开”，不要一次铺太多素材墙。

2. 全局确认页
   - 用户确认集数、镜头数量、风格、分辨率、消耗等参数。
   - 可迁移：漫角新建流程应有“生产参数确认台”，把模型、积分、比例、集数、总图模式统一确认。

3. 剧情生成中
   - 用明确的生成中状态承接脚本到分镜的转换。
   - 可迁移：漫角需要把“正在解析剧本、拆场、抽角色、生成镜头参数”拆成可读进度，而不是空白等待。

4. 分镜工作台
   - 中间大画布，右侧镜头列表。
   - 优点：用户焦点明确，右侧负责镜头导航。
   - 可迁移：漫角剧本分场页应改成“左场次/中详情/右 Inspector”，不要让右侧状态条压住内容。

5. 镜头参数页
   - 单镜头信息包括镜别、构图、拍摄角度、焦距、色调、光照、场景、角色、台词、动作、构图说明、情绪节奏、生图提示词。
   - 可迁移：这些字段应进入漫角的镜头 Inspector，并与角色、场景、故事板、视频提示词联动。

6. 生成总图
   - 先生成 9 宫格/总图，再裁切成每个镜头。
   - 可迁移：漫角的故事板矩阵模块意义应定义为“总图校对 + 镜头裁切列表 + 全局一致性检查”。

7. 总图裁切后的效果
   - 中间显示总图，右侧显示裁切镜头列表。
   - 可迁移：漫角未生成总图前不应铺 12 个空格；应展示生成 CTA、预期输出和参数摘要。

8. 导出视频
   - 左素材轨，中预览，右属性，底时间线。
   - 可迁移：漫角最终视频闭环台应采用专业剪辑结构：视频预览、镜头轨、字幕/配音轨、属性面板、导出按钮。

## 漫角 V3 信息架构

### 1. 剧本分场工作台

目标：把剧本解析结果变成可生产的场次、角色、风险、镜头计划。

布局：
- 顶部：项目状态、集数、场次、角色、可拆镜数、主按钮“生成分镜表”。
- 左栏：场次组/剧情节拍列表，显示每场完成度。
- 中栏：当前场详情，包括剧情目标、冲突、角色、台词摘要、风险提示。
- 右栏：Inspector，显示生成状态、镜头数、角色场景需求、下一步动作。

必须修复：
- 不允许横向溢出。
- 不允许右侧状态列遮挡正文。
- 宽屏要自适应填满，不留大片死空白。

### 2. 角色与场景资产工作台

目标：先锁定角色身份板和场景资产，再进入分镜/视频。

布局：
- 左栏：角色列表 + 场景环境列表。
- 中栏：角色参考画布，按竖图/横图比例自适应展示。
- 右栏：资产 Inspector，默认隐藏内部提示词，只显示一致性、生成队列、质量反馈。
- 底部：创作者反馈条。

必须修复：
- 角色卡不可互相遮挡。
- 参考图、输入框、按钮不得压住图片。
- Prompt 不默认外露，只作为可展开高级模块。

### 3. 故事板矩阵与视频闭环工作台

目标：全局预览总图、裁切镜头、精修镜头，并进入视频生成导出。

布局：
- 左栏：场景组和完成度。
- 中栏：总图预览；未生成时显示明确空状态和生成动作。
- 中下：生成后展示 12 格故事板矩阵。
- 右栏：镜头 Inspector，显示镜别、动作、台词、灯光、风险、视频提示词摘要。
- 底部：生产时间线，包含视频轨、字幕轨、配音轨和导出按钮。

图四模块的意义：
- 保留，但改名/定义为“故事板矩阵与视频闭环工作台”。
- 它不是前期空白占位页，而是总图生成后用于“全局校对、镜头裁切、镜头精修、视频闭环”的总台。

## ImageGen 方向稿提示词

### Option A：剧本调度台

Use case: ui-mockup
Asset type: desktop SaaS dashboard mockup, 1536x1024
Primary request: Redesign an AI manga/drama script scene-splitting workbench. Create a cleaner original product UI for Chinese creators turning novels/scripts into characters, scenes, storyboard panels, and video.
Screen name: 剧本分场工作台
Core layout: full-width adaptive workspace with no empty right gutter; left column = episode/beat navigation; center = selected scene detail and six story beats as dense rows/cards; right inspector = scene risk, characters, generated shot count, next action. Top row = compact progress metrics and primary generate button.
Required workflow visible: script parsed -> scene groups -> character/scene extraction -> shot planning -> generate storyboard.
Style: modern neutral dark mode, background #090A0F, panel #12141F, thin border-white/8, subtle cyan/indigo accents, professional AI tool, not game UI, not old blue admin.
Constraints: no huge blank canvas, no horizontal overflow, no right-side content squeezed offscreen, no nested cards, no decorative orbs, no marketing hero.

### Option B：资产生产台

Use case: ui-mockup
Asset type: desktop SaaS dashboard mockup, 1536x1024
Primary request: Redesign an AI manga/drama character and scene asset production workbench.
Screen name: 角色与场景资产工作台
Core layout: full-width adaptive 12-column workspace; left rail = role roster and scene environment list; center canvas = selected character reference board with portrait, pose sheet slots, reference upload, quality state; right inspector = prompt fields hidden behind disclosure, consistency checks, generation queue, scene asset requirements. Bottom = compact feedback bar.
Required workflow visible: lock character identity -> upload/reference images -> generate role board -> evaluate consistency -> send to storyboard/video.
Style: modern dark production console, neutral black/gray base, restrained cyan/indigo/emerald status colors, high-density professional AI image pipeline.
Constraints: image slots respect portrait/landscape aspect ratio, no overlapping text, no sideways overflow, no giant empty black boxes, no prompt wall exposed by default.

### Option C：故事板闭环台

Use case: ui-mockup
Asset type: desktop SaaS dashboard mockup, 1536x1024
Primary request: Redesign the AI manga/drama storyboard matrix and video export loop workbench.
Screen name: 故事板矩阵与视频闭环工作台
Core layout: left = scene group list with completion bars; center = large storyboard total-image preview when generated, otherwise a purposeful empty state with generation CTA and expected outputs; below center = 12-panel storyboard grid only after generation, compact and readable; right = shot Inspector with selected shot preview, camera/lighting/action/dialogue fields; bottom = production timeline with video clips, voice/subtitle tracks and export button.
Module meaning: this screen is for global preview, checking storyboard crop consistency, selecting a shot for refinement, then generating video and exporting publishable MP4.
Style: modern dark editor, closer to professional video/design tools, neutral #090A0F background, #12141F surfaces, thin borders, subtle indigo/cyan glow for active shot, status chips.
Constraints: no meaningless 12 empty boxes when no storyboard exists; empty state must explain next action; no giant dead black canvas; no clipped text; no horizontal overflow; no nested cards; no prompt text visible by default.

## 当前 ImageGen 阻塞

- `.env` 中的 OpenAI Image key 返回 `INVALID_API_KEY`。
- `.env.local` 中的 ZML key 返回 `GROUP_DELETED`。
- 用户提供的 `https://api.zmlmfling.com` 和 `/v1`、`/images/generations`、`/v1/images/generations` 都返回网关 HTML 页面，不是标准 Image API JSON。
- 需要一个可返回 `data[0].url` 或 `data[0].b64_json` 的正确 Image API base URL，或改用内置 ImageGen 工具。
