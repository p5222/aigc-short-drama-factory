# 开源 TTS 接入与视频闭环

## 目标

当前视频导出链路按以下顺序执行：

1. 图生视频片段或首帧补位
2. TTS 配音
3. SRT 字幕
4. FFmpeg 合成 MP4
5. 输出可下载 URL

## TTS 路由优先级

`apps/api/src/export/videoComposer.ts` 会根据环境变量选择 TTS 服务：

1. `TTS_PROVIDER=easyvoice`
   - 默认调用 `EASYVOICE_BASE_URL` 或 `TTS_BASE_URL`
   - 默认路径 `/api/v1/tts/generateJson`
   - 适合超长文本、多角色分段配音
2. `TTS_PROVIDER=voicebox`
   - 默认调用 `VOICEBOX_BASE_URL` 或 `TTS_BASE_URL`
   - 默认路径 `/generate`
   - 适合本地语音克隆、多 TTS 引擎、长文本自动分块
3. `TTS_PROVIDER=vibevoice`
   - 需要配置 `VIBEVOICE_BASE_URL`
   - 默认路径 `/tts`
   - 适合自托管长音频、多说话人推理服务
4. Windows SAPI
   - Windows 本地开发兜底
5. `scratch-local-wav`
   - 最后兜底，占位音轨，保证导出任务不中断

## 推荐环境变量

```bash
TTS_PROVIDER=easyvoice
EASYVOICE_BASE_URL=http://127.0.0.1:3000
EASYVOICE_DEFAULT_VOICE=zh-CN-XiaoxiaoNeural
EASYVOICE_VOICE_MAP={"旁白":"zh-CN-YunxiNeural","女主":"zh-CN-XiaoxiaoNeural"}
```

```bash
TTS_PROVIDER=voicebox
VOICEBOX_BASE_URL=http://127.0.0.1:8080
VOICEBOX_PROFILE_ID=default
```

```bash
TTS_PROVIDER=vibevoice
VIBEVOICE_BASE_URL=http://127.0.0.1:7862
VIBEVOICE_MODEL=VibeVoice-1.5B
```

## 授权边界

- Voicebox 当前按 MIT 开源项目作为外部本地服务集成。
- easyVoice 先按 HTTP 服务适配，不复制源码进入本项目；上线前应再次确认仓库许可证。
- VibeVoice-TTS 作为模型/自托管服务能力适配，不复制官方仓库代码。
- FFmpeg 主链路通过独立进程调用：优先读取 `FFMPEG_BIN`，其次自动探测项目内 `tools/ffmpeg/bin`、`vendor/ffmpeg/bin`、`deploy/ffmpeg/bin`，最后才使用系统 PATH。生产发行可随安装包/镜像携带合规构建的独立 FFmpeg 二进制，并保留许可证、源码获取说明和构建参数。

## 可迁移内嵌能力

为了保证没有 FFmpeg、没有云视频模型的设备也能跑通最小闭环，项目已经内嵌以下自研源码：

- `apps/api/src/export/embeddedVideo.ts`
  - 纯 TypeScript RIFF/AVI 写入器
  - MJPEG 帧编码使用项目已有 `sharp`
  - 输出真实 `.avi` 视频片段，可用于闭环冒烟和低配兜底
- `apps/api/src/export/subtitleTools.ts`
  - SRT 生成
  - SRT 解析
  - SRT -> WebVTT 转换
  - 时间轴归一化
- `apps/api/src/export/videoComposer.ts`
  - 片段、配音、字幕、FFmpeg MP4 或内嵌 AVI 包的统一编排

## 字幕项目复用策略

- `wxbool/video-srt-windows`：公开镜像标注 GPL，不能直接并入商业主链路；只参考“字幕生成/处理产品能力”，核心 SRT 能力已在 `subtitleTools.ts` 复刻。
- `YaoFANGUK/video-subtitle-extractor`：Apache-2.0，可作为视频硬字幕 OCR/提取方向参考；当前先不引入重模型依赖，后续可做 sidecar 服务。
- `jianchang512/stt`：GPL-3，不直接复制源码；如需语音识别生成字幕，建议作为外部可选服务或另写 Whisper/faster-whisper 适配层。

## 视频封装策略

- 有 FFmpeg：输出标准 MP4，封装视频、AAC 音频和 mov_text 字幕轨。
- 无 FFmpeg：输出可迁移包 manifest，包含真实 MJPEG/AVI 视频片段、WAV/MP3 配音、SRT 字幕和诊断信息；配置 FFmpeg 后可重新导出 MP4。
- 纯 TypeScript MP4/H.264 复刻不现实：H.264 编码、MP4 封装和专利/许可证边界复杂，因此主链路采用 FFmpeg，迁移兜底采用内嵌 MJPEG/AVI。
