# 设计总台 V2 前端实施清单

更新日期：2026-07-07

目标：在不破坏 V1 回滚基线的前提下，把当前剧本分场页升级为“剧本解析确认层 + 设计总台主工作台”。

## 1. 版本安全

- 保留 tag：`manjiao-frontend-v1.0`
- 每次改版前先确认能从 `manjiao-frontend-v1.0` 打包回滚。
- V2 改版不要混入后台、账号、支付、模型路由等无关功能。
- 建议新建或集中改动在项目工作台相关文件，避免继续扩大样式文件污染。

## 2. 页面结构

建议在现有 `ProjectWorkbenchPage.tsx` 的基础上拆成三个主 tab 或工作区模式：

```text
script-parse    剧本解析
design-desk     设计总台
video-loop      视频闭环
```

短期实现可以保留旧 tab：

```text
script / characters / storyboard / images / video
```

但 UI 上要让用户感知为：

```text
解析确认 -> 设计总台 -> 精修 -> 视频导出
```

## 3. 新组件建议

### ScriptParseWorkspace

职责：

- 展示剧本解析结果。
- 让用户确认、重命名、拆分、合并、锁定场景。
- 不承载大量下游生产操作。

区域：

- `ScriptParseHeader`
- `SceneParseList`
- `SceneParseDetail`
- `SceneParseInspector`

### DesignDeskWorkspace

职责：

- 主生产台。
- 用故事板矩阵展示整部片。
- 统一进入角色、场景、单镜头、分镜图精修。

区域：

- `ProductionPipelineStrip`
- `SceneGroupRail`
- `StoryboardMatrix`
- `ShotInspector`
- `CompactTimeline`

### VideoLoopWorkspace

职责：

- 视频、字幕、配音、导出闭环。
- 当前阶段先做结构占位，后续再强化。

区域：

- `VideoReadinessStrip`
- `ClipTimeline`
- `CurrentClipPreview`
- `ExportChecklist`

## 4. 数据结构

短期可从现有数据推导，不必立刻改后端：

```ts
type SceneGroup = {
  id: string;
  sceneNo: number;
  title: string;
  location: string;
  timeOfDay: string;
  shots: StoryboardShot[];
  characters: string[];
  risks: string[];
  readiness: "draft" | "ready" | "risk" | "blocked";
};
```

```ts
type ShotProductionState = {
  shotId: string;
  imageReady: boolean;
  videoReady: boolean;
  subtitleReady: boolean;
  voiceReady: boolean;
  characterReady: boolean;
  sceneReady: boolean;
  riskCount: number;
};
```

后续再升级后端解析对象：

```ts
type ParsedScene = {
  sceneNo: number;
  title: string;
  location: string;
  timeOfDay: string;
  characters: string[];
  actionGoal: string;
  beats: Array<{ summary: string; estimatedShots: number; emotion?: string }>;
  dialogueLines: Array<{ speaker?: string; text: string }>;
  risks: Array<{ level: "info" | "warning" | "blocker"; message: string; fixAction: string }>;
  confidence: number;
};
```

## 5. UI 验收标准

桌面端：

- 页面宽度 1440px 下首屏不能出现右侧大面积空白。
- 左栏、主区、右栏高度要对齐，至少主视觉区要饱满。
- 主区必须有故事板矩阵或镜头视觉卡，不允许纯文本表单占满主屏。
- 顶部状态必须收敛为一条 pipeline strip。
- 右侧 inspector 固定宽度 340px 到 380px。
- 镜头卡固定比例，不能因文字多少改变高度。
- 主要按钮不超过每个区域 1 个，次级操作进入菜单或 inspector。
- 卡片圆角不超过 8px。
- 不使用渐变装饰球、营销式 hero、大片空背景。

移动端：

- 左栏变成顶部场景下拉或横向 tabs。
- 主区卡片单列。
- inspector 变成底部 drawer 或折叠区。
- 按钮文字不溢出。

## 6. 视觉改造重点

当前 V1 要重点修：

- 顶部右侧统计卡漂浮：改成完整 pipeline strip。
- 剧情摘要和场景字段高度不齐：改成统一属性网格。
- 预检和候选区太像旁路信息：在解析层缩小，在设计总台进入 inspector。
- 右侧空白：设计总台用 inspector + 画面矩阵填充。
- 小按钮尺寸不一：统一 32px 或 36px 高度。
- 蓝色边框太多：减少边框层级，用背景层和分隔线建立层次。

## 7. 实施顺序

### Step 1：增加设计总台 tab

- 新增 `design-desk` tab 或把 `storyboard` tab 改造成设计总台。
- 不删除 V1 代码，先并行放一个新工作区。
- 用现有 `storyboards`, `assets`, `characters`, `exportJobs` 推导矩阵数据。

### Step 2：重构剧本解析页

- 当前 `ScriptBoard` 改轻。
- 删除过多下游生产操作。
- 保留解析确认、场景列表、风险提示、进入设计总台按钮。

### Step 3：实现 StoryboardMatrix

- 按 `episodeNo + sceneNo` 分组。
- 每个镜头卡显示：
  - 预览图或占位图
  - 镜头号
  - 时长
  - 景别/运镜
  - 角色 chip
  - 图/视/字/音状态点
  - 风险 badge

### Step 4：实现 ShotInspector

- 选中镜头后显示：
  - 大预览
  - 镜头描述
  - 角色依赖
  - 场景依赖
  - 图片/视频/字幕/配音状态
  - 主按钮：进入单镜头导演台
  - 次按钮：重生成分镜图、精修角色、精修场景

### Step 5：截图验收

必须截图对比：

- 桌面 1440x1024
- 窄桌面 1180x900
- 移动 390x844

对比对象：

- V1 截图：`docs/version-snapshots/manjiao-frontend-v1-script-scene-workbench.png`
- V2 新截图

验收问题：

- V2 是否更饱满？
- 是否减少空白？
- 是否有明确主视觉？
- 是否比 V1 更容易理解从剧本到视频的路径？
- 是否没有引入按钮溢出、卡片错位、文字重叠？

## 8. 不做事项

本轮不要做：

- 后台质量中心。
- 登录/账号资料。
- 支付/会员。
- 模型供应商管理。
- 数据库 schema 大改。
- 视频导出真实能力重构。

本轮只做：

- 前台项目工作台信息架构。
- 剧本解析确认页变轻。
- 新设计总台视觉主屏。

## 9. 与 Product Design 的交接口径

先让 Product Design 产出视觉方向，不直接写代码：

1. 先生成设计总台效果图。
2. 再生成剧本解析确认页效果图。
3. 用户选定方向后再进入前端实现。
4. 实现后保留 V1 回滚能力。
