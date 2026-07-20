# 漫角双主题创作工作台设计规范

## 状态

- 日期：2026-07-20
- 状态：待用户书面确认
- 浅色视觉基准：`docs/design-previews/manjiao-workbench-theme-systems-20260720/01-porcelain-studio-light.png`
- 深色视觉基准：`docs/design-previews/manjiao-workbench-theme-systems-20260720/02-graphite-studio-dark.png`
- 适用范围：创作者项目工作台；不包含首页、登录页和后台管理系统改版

## 1. 目标

把当前创作工作台重构为一套稳定、简单、以真实创作结果为中心的制作系统，并提供完整浅色和完整深色两套主题。两套主题共用相同的 DOM、组件、尺寸、业务流程和交互状态，只替换语义色 token。

第一屏必须无需滚动即可看见当前生产阶段、当前对象、主要结果和下一步主操作。不得再出现浅色系统中突然插入黑色大画布，或深色系统中蓝紫渐变、辉光和玻璃效果统治界面的情况。

## 2. 核心决策

### 2.1 一个工作流，两套完整主题

- 浅色 `Porcelain Studio`：冷灰应用底、纸白表面、深青主操作，媒体承载区保持浅色中性层级；
- 深色 `Graphite Studio`：中性石墨灰表面、青绿主操作，媒体承载区只比周围暗一级；
- 主题切换只修改 CSS Custom Properties，不改变宽高、间距、边框宽度、字重、图标、DOM 顺序或交互；
- 组件 CSS 只能引用语义 token，不允许出现 `data-theme` 组件级覆盖，也不允许写两份页面组件。

### 2.2 单一信息架构

顶部只保留 `内容 / 资产 / 镜头 / 成片` 一套阶段导航。`镜头表 / 分镜图 / 视频` 是镜头阶段内部模式，不是第二套全局步骤条。

所有阶段使用稳定的三栏空间模型：左侧选择对象，中间查看和编辑主要结果，右侧 Inspector 只处理当前对象。任务、评测、反馈、导出历史和高级设置按需进入抽屉或对话框。

### 2.3 沉浸式项目路由

进入项目工作台后隐藏现有全局 Sidebar 与 Topbar，由 `WorkbenchHeader` 接管返回、项目名、阶段导航、保存状态、主题切换、预览和主操作。退出项目后恢复全局 Shell。所有断点按浏览器 viewport 计算，不把全局侧栏宽度重复计入工作区。

## 3. 生产阶段

### 3.1 内容

左侧显示剧集与场次；中间显示当前场次的剧情、对白、动作和调度；右侧显示时间、地点、天气、情绪、出场角色及内容状态。主操作为“确认内容并生成镜头结构”。

“镜头结构”是持久化 `StoryboardShot[]` 的首次创建。创建成功后内容阶段完成并进入资产阶段。镜头阶段的“镜头表”只编辑同一批数据，不创建第二份镜头结构。

后端尚未提供持久化 Episode/Scene 时，前端解析结果明确标识为“从剧本识别”，不能伪装为已审核的结构化数据。没有真实场次的剧集显示空状态，不生成虚假内容。生成镜头结构时继续提交项目的 `artStyle` 和 `videoRatio`。

### 3.2 资产

左栏切换 `角色 / 场景`；中间显示身份板、场景环境图、参考图和生成结果；右侧展示当前资产资料、参考约束、模型、规格和费用。

Release A 只允许编辑现有接口支持的参考图和生成设置。角色身份、外观、服装、性格以及场景描述在增加持久化更新接口后进入 Release B。删除或替换创作者参考图不得覆盖 AI 身份板。

场景来源与镜头结构中的场景实体保持一致。内容阶段生成镜头结构后进入资产阶段，不能直接跳到首帧生成再要求用户返回补场景。

### 3.3 镜头

左侧只有一份镜头清单；中间通过 `镜头表 / 分镜图 / 视频` 切换同一镜头的文本结构、首帧和视频片段；右侧显示参数、绑定资产、生成模型、规格和费用。

- 镜头表：编辑描述、景别、机位、运镜、时长和角色/场景绑定；
- 分镜图：查看、生成或重生成当前首帧，管理参考图；
- 视频：查看当前镜头视频结果、批次状态和失败信息。

Release A 沿用项目级视频接口，只能生成全部待完成片段。单镜头视频生成和强制重生成在视频接口支持 `{ shotIds?, forceRegenerate? }` 后进入 Release B。界面不得用纯前端按钮伪造该能力。

批量首帧继续支持多选、全部待生成和强制重生成，并在执行前显示影响范围、模型、规格和预计积分。

### 3.4 成片

左侧使用宽片段清单，只加载首帧 poster，不为每行创建预加载 video；中间为连续预览和基础时间线；右侧为声音、字幕、导出和发布检查。

Release A 时间线支持播放头、镜头选择、按真实时长排列和视图缩放。排序、入出点剪切和静音在增加持久化时间线契约后进入 Release B，不以临时前端状态提供。

镜头视频模式只负责单镜头片段的查看、生成状态与验收；成片阶段只负责连续预览、声音、字幕、MP4、下载和发布，不再显示视频生成模型。

必须保留 TTS、字幕、MP4、任务历史、下载、失败原因、发布标题、分类、说明、封面、既有提交记录，以及选择单镜头视频或合成 MP4 作为发布候选的能力。

## 4. 工作区尺寸

在 `>= 1440px` 时：

| 区域 | 尺寸 | 职责 |
| --- | --- | --- |
| WorkbenchHeader | 68px 高 | 项目、阶段、保存、主题、预览和主操作 |
| Entity Rail | 300px 宽 | 剧集、场次、角色、场景、镜头或片段 |
| Canvas | `minmax(640px, 1fr)` | 剧本、真实媒体、视频和时间线 |
| Inspector | 392px 宽 | 当前对象资料、模型、规格、费用与操作 |

中央 Canvas 面积必须大于任一侧栏。三个一级区域内部用 spacing、alignment 和 divider 建立层级，禁止把 section 再包装成浮动卡片。

## 5. 共享选择与草稿状态

页面级 `WorkbenchProvider` 统一维护：

```text
activeStage: "content" | "assets" | "shots" | "delivery"
activeEpisodeNo: number | null
activeSceneKey: { source: "derived" | "storyboard"; value: string } | null
activeAsset: { type: "character" | "scene"; id: string } | null
activeShotId: string | null
selectedShotIds: string[]
shotMode: "table" | "image" | "video"
dirtyEntityKey: string | null
inspectorOpen: boolean
```

规则：

- 切换剧集后选择该集第一个真实场次；切换场次后优先保留仍属于该场的镜头，否则选择首个镜头；
- 切换角色或场景不清空镜头上下文；
- `镜头 -> 成片 -> 镜头` 返回时恢复同一个镜头；
- 重建 Storyboard 后校验 scene/shot ID，清空已失效的选择；
- 批量选择在离开镜头阶段时清空，模式内部切换时保留；
- 子组件不得维护彼此隔离的 `activeShotId`。

## 6. 保存、任务、模型与计费

Release A 保留显式保存。顶栏显示 `未修改 / 有未保存修改 / 保存中 / 保存失败 / 已保存`，不伪装自动保存。保存失败保留内存草稿；离开当前对象前必须确认是否放弃未保存修改。

任务接入 `ProjectWorkflow.tasks`。Release A 按 `projectId + task.type` 展示真实批次任务；成功后刷新资产判断对象结果。逐对象任务进度与失败原因在 `GenerationTask` 增加 `entityType/entityIds` 或 `TaskItem` 后进入 Release B。

生成任务必须呈现排队、运行、完成、失败、取消、可重试、退款和 fallback 信息中后端实际提供的状态。不能仅依赖本地 `isBusy`。

Release A 生成对话框展示并修改项目当前模型，确认后先更新项目默认路由再创建任务，并明确提示“同时更新项目默认模型”。真正的单次模型 override 在生成接口接收 provider/model/spec 后进入 Release B。预计积分用于确认，最终扣费以后端返回的实际模型、规格和价格为准。

## 7. 评测与反馈

评测帮助创作者定位哪个生产模块需要优化，不作为能否发布的门禁。报告、手动触发评测和反馈表默认收进当前对象的 Evaluation Drawer。

Release A：

- 角色反馈使用 `stage="character"` 与角色 `assetId`；
- 场景反馈使用 `stage="image"` 与场景 `assetId`，文案显示“场景资产反馈”；
- 镜头反馈使用对应 image/video `assetId`。

独立 `scene` 阶段和持久化 `shotId` 归因需要扩展 EvaluationStage、数据库枚举和聚合口径，进入 Release B。

## 8. 组件边界

```text
ProjectWorkbenchPage
├─ WorkbenchProvider
├─ WorkbenchHeader
├─ ProductionStageNav
├─ ContentStage
├─ AssetStage
├─ ShotStage
├─ DeliveryStage
├─ TaskDrawer
├─ EvaluationDrawer
└─ ExportDialog

共享组件
├─ ProductionWorkspace
├─ EntityRail
├─ MediaCanvas
├─ Inspector
├─ GenerationPanel
├─ GenerationDialog
└─ ThemeToggle

逻辑层
├─ projectWorkbenchSelectors
├─ useWorkbenchSelection
├─ useGenerationCommands
├─ useExportCommands
└─ useQualityFeedback
```

`ProjectWorkbenchPage` 只负责加载 workflow、装配阶段和页面级状态。场景分组、媒体映射、阶段完成度、费用和时间线尺寸进入可测试的 selector；异步命令进入 hooks。

工作台样式迁入 `apps/web/src/workbench/styles/`，按 `tokens / shell / components / stages / responsive` 拆分。新工作台样式不得使用 `!important`。每迁移一个组件，只删除确认由 ProjectWorkbenchPage 独占的旧规则，并在同一提交运行视觉回归；不得继续向 `styles.css` 末尾追加覆盖块。

## 9. 主题系统

### 9.1 共用基础 token

```css
--font-ui: Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
--font-mono: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
--text-xs: 12px;
--text-sm: 14px;
--text-md: 16px;
--text-lg: 20px;
--radius-xs: 4px;
--radius-sm: 6px;
--radius-md: 8px;
--motion-fast: 120ms cubic-bezier(.2,.8,.2,1);
--motion-normal: 180ms cubic-bezier(.2,.8,.2,1);
```

所有 letter-spacing 为 0。按钮 36-40px 高；桌面表单 38px 高；列表行 52px；图标统一 16px、stroke 1.75。单阶段第一屏最多 9 个图标按钮，只为熟悉动作使用 Lucide 图标。

### 9.2 Porcelain Studio

```css
[data-theme="light"] {
  --bg-app: #F4F6F7;
  --bg-shell: #F8FAFB;
  --surface-1: #FFFFFF;
  --surface-2: #F7F9FA;
  --surface-3: #EDF1F3;
  --text-1: #182129;
  --text-2: #495864;
  --text-3: #71808B;
  --border-1: #DDE4E7;
  --border-2: #C8D2D7;
  --divider: #E7ECEE;
  --accent: #087F75;
  --accent-hover: #066A62;
  --accent-soft: #E6F4F1;
  --accent-selected: #D8EEEA;
  --focus: #0C8F84;
  --success: #167A50;
  --info: #255FBE;
  --warning: #9A5A05;
  --danger: #BC3F37;
  --media-bg: #E9EEF0;
  --timeline-ruler: #F1F4F5;
  --timeline-track: #F8FAFB;
}
```

真实图片和视频保持原色。9:16 媒体两侧留白使用 `media-bg`，不得变成黑框。常驻区域无阴影，只有菜单、Popover 和 Modal 使用轻阴影。

### 9.3 Graphite Studio

```css
[data-theme="dark"] {
  --bg-app: #0E1114;
  --bg-shell: #12161A;
  --surface-1: #171B20;
  --surface-2: #1C2127;
  --surface-3: #232930;
  --text-1: #F1F4F6;
  --text-2: #B7C0C8;
  --text-3: #85919B;
  --border-1: #2B333A;
  --border-2: #3A454E;
  --divider: #252C32;
  --accent: #2EC4B6;
  --accent-hover: #43D0C3;
  --accent-soft: #153B37;
  --accent-selected: #194943;
  --focus: #5EE0D3;
  --success: #54C985;
  --info: #73A6F2;
  --warning: #E7B35C;
  --danger: #ED7972;
  --media-bg: #13171B;
  --timeline-ruler: #151A1E;
  --timeline-track: #1B2025;
}
```

深色层级使用中性石墨灰，不加蓝色滤镜、暗角、发光边框或紫色表面。主按钮使用实色青绿和深色文字，语义蓝、琥珀和红只在真实状态中出现。

### 9.4 状态与可访问性

- hover：只改变 surface，不位移、不缩放；
- selected：soft fill + 左侧 3px accent，不只改变文字颜色；
- focus：2px focus outline，offset 2px，不用发光 box-shadow；
- disabled：保持 opacity 1，使用 surface-3、text-3 和 border-1；
- loading：保持组件原尺寸，reduced-motion 下禁用呼吸动画；
- 图标按钮必须有可访问名称；表单 label、错误和任务状态可被辅助技术识别；
- 主题切换后更新 `color-scheme`，并持久化用户选择；首次使用系统偏好。

## 10. 删除与移动

删除：

- 页面内重复的四步、六步和检查步骤条；
- 同一镜头的树、矩阵、12 格、生产时间线等重复导航；
- 没有事件的“场景卡/风险”、折叠和封面按钮；
- 后端不接收的伪导出设置；
- 永不渲染的 CanvasPromptCard 及无效传参；
- 常驻评分卡、常驻反馈表、重复模型入口和重复主操作；
- 不能比较、回退或复用结果的空“图片版本”概念。

移入抽屉或对话框：任务中心、评测与反馈、导出历史、项目默认模型、高级生成设置、批量生成确认和费用明细。

## 11. 响应式

- `>= 1440px`：完整 300px + Canvas + 392px 三栏；
- `1200-1439px`：Entity Rail 260px，Inspector 340px；
- `980-1199px`：Inspector 右侧覆盖式 Drawer，Canvas 不缩到 640px 以下；
- `768-979px`：Entity Rail 和 Inspector 都为 Drawer，互斥打开；顶部阶段导航横向滚动；
- `< 768px`：两个侧栏为全高 Sheet，主区单列，点击目标至少 44px；时间线横向滚动，不拆成轨道卡片。

Drawer 打开后焦点进入面板，Tab 被圈闭，Esc 或遮罩关闭并把焦点还给触发按钮；背景滚动锁定。`< 1440px` 顶栏只保留返回、项目名、阶段和主操作，其余进入更多菜单。

## 12. 实施与迁移

### Release A：现有契约内完成

- 沉浸式路由、四阶段 IA、共享选择状态、两套主题和主题切换；
- 组件与样式拆分，移除无效和重复 UI；
- 现有剧本、角色/场景参考图、首帧、项目级视频、模型、计费、TTS、字幕、MP4、下载、发布和评测链路；
- 真实批次任务、保存状态、错误、取消、重试、退款和 fallback 中后端已提供的部分；
- 响应式、键盘和视觉回归。

### Release B：后端契约扩展后完成

- 持久化 Episode/Scene；
- 角色与场景资料编辑接口；
- AssetItem 的 `relatedSceneId / relatedShotId`；
- 单镜头视频和强制重生成；
- GenerationTask 的逐对象任务项；
- 单次生成模型 override；
- 独立场景阶段与 shotId 质量归因；
- 真实导出比例、帧率、文件名和封面；
- 时间线排序、剪切和静音。

关系字段迁移先新增 nullable 字段并回填，读路径优先新关系、回退旧 ID/名称规则；统计无法回填记录，覆盖率达到 100% 后才移除回退。

## 13. 验收标准

### Release A 功能

- 顶部只存在一套四阶段导航，两套主题使用同一流程和组件；
- 同一镜头在左栏、画布、Inspector 和时间线保持同步，跨阶段返回仍恢复选择；
- 主要真实流程通过：内容生成镜头结构 -> 角色身份板 -> 场景图 -> 单张首帧 -> 批量首帧 -> 视频任务 -> TTS/字幕 -> MP4 -> 下载 -> 提交审核；
- 每次生成前能确认当前项目模型、规格和预计积分，并明确是否修改项目默认；
- 刷新后恢复真实批次任务，错误和重试入口贴近对应阶段；
- 评测反馈归因符合第 7 节，不阻止发布。

### 视觉与交互

- 2048x1152 下 Header、三栏和当前阶段主操作无需纵向滚动可见；Canvas 宽度不少于 640px；
- 实现与两张参考图的区域顺序一致，固定尺寸误差不超过 8px，颜色使用本规范 token；
- 浅色主题没有深色 UI 画布，深色主题没有浅色 UI 断层；真实媒体保持原色；
- 同一级表面最多一层边框容器，无卡片套卡片、渐变、辉光、玻璃和装饰图标阵列；
- 1440、1366、1024、768 和 390px 视口无不可达主操作、文字遮挡或非预期横向溢出；
- 键盘操作、焦点、Drawer、表单标签、错误和 reduced-motion 通过可访问性检查。

### 工程与发布

- `ProjectWorkbenchPage` 不再承担全部 JSX、业务推导和异步命令；
- 新工作台 CSS 无 `!important`，不向 `styles.css` 追加覆盖；
- selector 单测覆盖选择、媒体映射、完成度和时间线计算；
- 集成测试覆盖阶段切换、选择连续性、保存失败、模型确认后生成、任务重试、导出和反馈归因；
- 浏览器真实 QA 同时覆盖浅色/深色和桌面/移动，`design-qa.md` 最终为 `passed`；
- 部署前创建带时间与动作的完整备份，校验后只保留最近三个；
- 生产健康检查、主要流程和静态资源通过后提交并 push。

## 14. 非目标

- 本轮不重做首页、登录页、创作现场和后台管理系统；
- 不实现没有持久化契约的专业 NLE 功能；
- 不用 mock 数据补满列表或模拟模型、版本、导出和审核能力；
- 不以评测分数控制发布，不新增多人权限和工单指派；
- 不修改域名、备案信息和既有生产数据。
