# 导演分镜与视频闭环迭代方案

## 目标

把项目从“能生成分镜文本和素材”继续推到创作者可理解、可检查、可下载的生产闭环：

1. 剧本确认
2. 角色定稿
3. 分镜图
4. 视频合成
5. 导出

创作者默认只看到这 5 个步骤。模型、参数、失败重试、成本、字幕、TTS、FFmpeg 等工程项只在生成前确认卡片、任务中心、后台配置里出现。

## 已吸收的提示词能力

来自用户提供的角色板、Saber Poi Ritual 案例和 seedance-storyboard-skill 的可复用规则：

- 角色板不做普通三视图目录，而做电影感 identity board：一个主视觉全身 hero 作为身份锚点，辅以侧面、背面、坐姿、蹲姿、肖像、轮廓和细节研究。
- 所有角色参考图强制锁定同一脸型、发型、服装主色、身体比例和姿态语言。
- 分镜草图只负责视觉构图，不把长中文说明、CAM、FOV、人物标签交给图片模型渲染。
- 每个视频段使用 Seedance 2.0 结构：首帧锚点、镜头焦距/FOV、人物站位、主动作、声音、尾帧锚点、避免项。
- 每段视频优先控制在 6-12 秒，最长不超过 15 秒。
- 站位使用 screen-left / center / screen-right 与 foreground / midground / background，防止越轴和人物互换。
- 镜头焦距映射：24mm 建立空间，35mm 移动/跟拍，50mm 对话，85mm 情绪近景，100mm 道具特写。

## 创作者使用视角

创作者在“分镜拆解”中看到的是导演工作台，而不是工程参数表：

- 左侧：镜头草图或首帧预览。
- 中间：导演执行说明，包括镜头、站位、动作节拍、连续性锚点。
- 右侧：人物站位 + CAM + FOV，可视化检查角色关系和机位方向。
- 下方：增强 Seedance 提示词，仅作为高级折叠项查看。
- 点击“导出导演长表”后，生成可交付的 HTML/Markdown 长表，用于人工审片、外包沟通或模型复跑。

生成前必须展示：

- 模型
- 参数
- 预计积分
- 预计耗时
- 失败是否退费
- 失败后能否切换模型继续当前阶段

## 本轮落地范围

- 新增导演分镜后端引擎：`apps/api/src/export/directorStoryboard.ts`
- 新增 API：
  - `GET /api/projects/:id/director-storyboard`
  - `POST /api/projects/:id/director-storyboard/export`
- 新增共享类型：`DirectorStoryboardRow`、`DirectorStoryboardPackage`
- 前端分镜工作台新增：
  - 导演分镜草图 + 站位 + CAM/FOV 顶部控制台
  - 单镜头导演执行说明
  - SVG 站位图
  - 增强 Seedance 提示词折叠查看
  - 导出导演长表按钮
- 提示词增强已进入：
  - `apps/api/src/agents/generator.ts`
  - `apps/api/src/agents/toonflowAdapter.ts`
  - `apps/api/src/db/storyboardActions.ts`

## 视频闭环策略

主链路：

1. 图生视频生成片段。
2. 根据分镜台词/旁白生成 TTS cue。
3. 生成 SRT 字幕。
4. 有 FFmpeg 时合成 MP4。
5. 无 FFmpeg 时输出可复盘 manifest + MJPEG/AVI 片段 + WAV + SRT。

当前已经内嵌的能力：

- `apps/api/src/export/subtitleTools.ts`：SRT 生成、解析、WebVTT 转换。
- `apps/api/src/export/embeddedVideo.ts`：纯 TypeScript MJPEG/AVI 兜底视频。
- `apps/api/src/export/videoComposer.ts`：片段、TTS、字幕、FFmpeg/AVI 合成编排。

## 开源迁移边界

easyVoice：

- 适合做多角色、长文本 TTS 服务适配。
- 当前 GitHub 主仓库未看到明确 LICENSE 文件时，不能把源码克隆到自己仓库后改名当作可商用迁移。
- 安全做法：先通过 HTTP adapter 使用；需要内嵌时，等作者补充许可证或拿到书面授权；否则按功能洁净复刻。

FFmpeg：

- FFmpeg 官方许可证是 LGPL 2.1+，但启用 GPL 组件时整体会受 GPL 约束。
- 商业产品不建议直接静态内嵌不明构建的 FFmpeg。
- 当前实现支持 `FFMPEG_BIN`，也会自动探测 `tools/ffmpeg/bin`、`vendor/ffmpeg/bin`、`deploy/ffmpeg/bin` 下的独立二进制；生产发行时可随服务镜像/安装包携带合规构建，并保留许可证、源码获取说明和构建参数。

字幕工具：

- GPL 类项目只参考产品能力，不复制源码进主链路。
- Apache/MIT 类项目可以在确认版本和许可证后按模块复用。
- 当前核心 SRT 能力已用自研 TypeScript 复刻，减少许可证污染。

## 自检清单

- API 能返回导演分镜行，包含 lens、FOV、directorNotes、blockingSvg、seedancePrompt。
- 导出 HTML 包含左中右三栏、CAM、FOV、人物站位 SVG。
- 桌面与移动端无横向溢出。
- 前端构建通过。
- 后端构建通过。
- easyVoice 不因“开源”二字直接复制源码。
- FFmpeg 不因本机安装成功就假设其他用户设备可用。

## 下一步优先级

1. 把导演长表里的草图 placeholder 接入真实 image generation job，支持 2x2 四宫格和自动切割。
2. 把导演分镜 guide 持久化为后台提示词模板，支持版本管理和评测对比。
3. 对 TTS adapter 增加 easyVoice/Voicebox/VibeVoice 的真实健康检查与试听任务。
4. 对视频导出增加“有 FFmpeg 输出 MP4 / 无 FFmpeg 输出诊断包”的前端明确提示。
5. 任务中心继续补齐并发限制、失败重试、取消、状态回写和成本冻结/退费流水。
