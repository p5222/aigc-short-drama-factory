# 创作流程 API 与模型配置

核验日期：2026-10-26。具体测试证据见 `outputs/workflow-readiness-20261026/验收记录.md`。以下为当前应用适配器支持的配置，模型权限、现金余额和上游计费需在对应供应商控制台确认。

本次 270 项 API 测试全部通过、没有跳过项，覆盖真实隔离数据库、Redis、TLS SMTP 注册和 HTTP 业务边界；类型检查、构建以及 FFmpeg 编码与解码也通过。生产仍运行 `5df3bb0`，本轮密钥目录修复尚未发布；真实供应商样片及现金费用仍未验收。本次隔离资源已清理，清理后生产 readiness 正常。

## 最小接入组合

先选择一组固定模型完成小范围验收，避免同时启用尚未确认的模型池。

| 流程 | 渠道与模型 | API / 配置 | 平台价格单位 |
| --- | --- | --- | --- |
| 剧本、角色卡、分镜文本 | `dashscope-text` / `qwen3.7-plus` | 百炼 OpenAI 兼容接口；`DASHSCOPE_TEXT_API_KEY`，或回退 `DASHSCOPE_API_KEY` | `text_run` |
| 角色参考图、场景图、分镜首帧 | `dashscope-image` / `qwen-image-2.0-pro-2026-04-22` | 百炼原生多模态生成接口；`DASHSCOPE_API_KEY` | `image` |
| 首帧生成视频 | `dashscope-video` / `wanx2.1-i2v-turbo` | 百炼原生异步视频接口与任务轮询；`DASHSCOPE_API_KEY` | `video_second` |
| 中文旁白 | `dashscope-tts` / `qwen3-tts-flash` | 百炼原生语音合成；`DASHSCOPE_TTS_API_KEY` 可选，未设置可回退通用百炼 Key | `tts_character` |
| 字幕、尾帧、MP4 封装 | 本地 FFmpeg | `FFMPEG_BIN`；不需要另购模型 API | 当前处理逻辑无额外平台生成积分 |
| QQ 邮箱注册 | QQ 邮箱 SMTP | 发信 QQ 邮箱及 SMTP 授权码 | 无模型价格 |

上述视频模型是当前生产渠道模型列表中已有的选项。生产虽然存在 `wan2.7-i2v-2026-04-25` 的价格记录，但其渠道模型列表尚未包含该 ID；如要使用，需同时确认上游权限、添加模型和对应报价。不能仅因存在价格就认为可以选择。

当前 `qwen3.7-plus` 的真实 `GET /models` 返回包含该 ID；图片、视频和配音尚未执行本次真实收费调用，表内型号是已接入配置，不是生成质量通过的声明。

## 服务器配置示例

密钥仅填写到服务器的环境配置或后台服务器端渠道配置，不提交 Git，不发到聊天中。以下端点为国内北京区域示例；Key 所属地域和业务空间必须与端点一致。其他地域、独立业务空间应复制供应商控制台提供的对应地址。

```dotenv
PUBLIC_API_BASE_URL=https://manjiao.cloud

REGISTRATION_SMTP_HOST=smtp.qq.com
REGISTRATION_SMTP_PORT=465
REGISTRATION_SMTP_SECURE=true
REGISTRATION_SMTP_USER=<发信QQ邮箱>
REGISTRATION_SMTP_PASSWORD=<该邮箱的SMTP授权码>

DASHSCOPE_TEXT_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
DASHSCOPE_TEXT_API_KEY=<百炼文本Key>
DASHSCOPE_TEXT_MODEL=qwen3.7-plus
DASHSCOPE_TEXT_MODEL_POOL=qwen3.7-plus

DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/api/v1
DASHSCOPE_API_KEY=<百炼图片视频Key>
DASHSCOPE_IMAGE_MODEL=qwen-image-2.0-pro-2026-04-22
DASHSCOPE_IMAGE_MODEL_POOL=qwen-image-2.0-pro-2026-04-22
DASHSCOPE_VIDEO_MODEL=wanx2.1-i2v-turbo
DASHSCOPE_VIDEO_MODEL_POOL=wanx2.1-i2v-turbo

TTS_PROVIDER=dashscope-tts
DASHSCOPE_TTS_BASE_URL=https://dashscope.aliyuncs.com/api/v1
DASHSCOPE_TTS_MODEL=qwen3-tts-flash
DASHSCOPE_TTS_DEFAULT_VOICE=Cherry
FFMPEG_BIN=/usr/bin/ffmpeg
```

可选 `DASHSCOPE_TTS_API_KEY` 的优先级高于通用 Key。只有配音专用 Key 不能用于判断图片、视频已配置。手机号仅收集，不需要短信 API。

修改环境后需重新创建 API 容器以加载新值。后台已保存的渠道 Key、端点和路由模型可覆盖环境默认值；创作向导需明确选择上述文本、图片、视频渠道。现有 Manjiao 环境 Key 会影响未指定渠道时的默认文本路由，不能只修改环境默认模型就认为所有现存项目均已切换。

## 后台同时需要的设置

每个渠道需启用、设置正确地域/空间的端点、精确模型 ID、固定首选模型，以及模型对应的启用价格。价格应绑定相同渠道 ID、模型 ID、模态和单位。本站积分是平台报价，不等于供应商现金费用；实际图片报价还会受尺寸、质量影响。

本次生产配置中的基础积分：`qwen3.7-plus` 为 6/文本次，指定 Qwen 图片模型为 10/图，`wanx2.1-i2v-turbo` 为 16/秒，`qwen3-tts-flash` 为 1/Unicode 字符。实际提交前以接口返回报价为准，不据此承诺上游现金成本。

视频输入必须是当前镜头的有效首帧。存储签名 URL 需能被供应商从公网访问，并在供应商读取时仍有效；不能使用 `localhost`、内网地址或依赖站内登录 Cookie 的 URL。多镜头连续生成还需保留前镜尾帧与后镜首帧的来源关系。

## 本次发现的配置阻塞

- QQ 发信账号和 SMTP 授权码均未配置；新用户无法注册，已有账号登录入口仍可用。
- 最近失败样本 15 条的错误精确等于“积分余额不足”。这是本站账户积分检查，未证明供应商余额不足。应为独立验收账号提供受控积分，不能直接向供应商充值来解决。
- 百炼另 1 条文本失败为 HTTP 403，同时出现仅限免费调用、免费额度耗尽的信息。需在百炼检查当前模型的免费调用限制及付费开通状态；允许付费前设置上游消费控制。
- 当前 Manjiao Key 的模型清单有 8 个 ID，但没有已配置的 `gpt-5.5`。清单缺失不足以单独证明该 ID 的调用必定失败；先向渠道确认支持，或选择清单中的模型并补充实际报价后再测试。
- DeepSeek 清单只有 `deepseek-flash` 和 `deepseek-v4-pro`；当前默认 `deepseek-v4-flash` 不在清单。优先验证已配置报价的 `deepseek-v4-pro`；如使用 `deepseek-flash`，必须配置该精确 ID 和价格，不自行把两种 ID 视为等价。

## 真实样片验收

内部集成测试使用独立数据库、Redis 和测试 SMTP，可以验证事务与状态流转；上游响应夹具不能替代真实模型生成。生产 `/ready` 的正常状态也不能替代真实收费验证。

下一步使用独立创作者验收账号、明确平台积分上限和供应商现金消费上限，按“文字 → 参考图 → 首帧 → 单镜视频 → 配音 → MP4”逐步生成。每步核对报价、任务编号、文件可解码和实际账单，失败时停止扩展范围。现有《雨后书店》两镜头验收方案的历史预算对应另一组图片模型，切换本页组合后必须重新报价。

真实 QQ 收件箱送达、真实模型画面/配音质量、供应商现金扣款和微信付款仍需各自验收；微信支付目前关闭，创作测试不要求同时开启真实付款。

## 官方接口参考

- [百炼 OpenAI 兼容接口与业务空间](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope)
- [百炼文生图](https://www.alibabacloud.com/help/en/model-studio/text-to-image)
- [百炼图生视频](https://www.alibabacloud.com/help/en/model-studio/image-to-video-guide)
- [Qwen TTS API](https://help.aliyun.com/zh/model-studio/qwen-tts-api)
- [QQ 邮箱注册配置与验收](./qq-email-registration.md)
- [真实短样片验收方案](./real-provider-acceptance.md)
