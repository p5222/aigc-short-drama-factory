# 创作流程 API 与模型配置

本文已于 2026-11-01 更新。完整操作步骤、十种支持协议、邮件与支付配置、根密钥备份及验收边界，见 [后台配置手册](./platform-configuration.md)。

## 最短配置路径

1. **后台 → 模型渠道**：添加文本、图片、视频和配音渠道，选择用途对应的接口协议，填写根地址、Key 和精确模型 ID。自定义渠道 ID 可直接用于已支持的协议。
2. **模型定价**：配置同渠道、同模型的生效价格；文本 `text_run`、图片 `image`、视频 `video_second`、配音 `tts_character`。
3. **平台配置 → 创作默认渠道**：保存四类默认渠道。文本、图片和视频初始选择写入新作品；配音按导出时默认渠道报价。
4. 查看配置检查清单，再分别执行渠道测试；使用短片完成“剧本 → 角色 → 分镜 → 首帧 → 视频 → 配音 → MP4”验收。

后台保存的配置对下次请求生效，无需重启；服务器环境配置变更则需要重新创建服务容器。已有项目不会被新的图片/视频默认值覆盖。新 Key 使用服务器根密钥加密，根密钥必须保留并随私密环境备份。

## 常见误判

- 配置检查通过只代表配置完整；视频任务已经提交不代表已经生成成功。
- OpenAI Chat、Responses、Images、各厂商原生图片/视频接口是不同协议，必须与上游实际接口匹配。
- Qwen 参考图编辑应使用百炼原生图片协议；不支持编辑的服务不会自动降级为纯文生图。
- 模型 ID 必须同时存在于渠道和生效价格中，且上游账号有权限。历史模型清单及过期价格不能证明当前可用性。
- 本站“积分不足”和供应商现金余额不足是两类问题。
- 注册邮件已经支持后台配置。SMTP 测试只验证连接和认证，真实投递需申请验证码核对。
- 微信支付配置测试只做本地签名检查。暂停新收款仍保留旧单回调和对账，现金支付需独立验收。
- 未集成的 Sora、Runway、ComfyUI 等插件不会因填写 Key 而变为可用。

## 配套文档

- [后台配置手册](./platform-configuration.md)
- [QQ 邮箱注册与验收](./qq-email-registration.md)
- [真实短样片验收方案](./real-provider-acceptance.md)
- [百炼 OpenAI 兼容接口](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope)
- [Qwen 图片编辑 API](https://help.aliyun.com/zh/model-studio/qwen-image-edit-api)
- [Qwen TTS API](https://help.aliyun.com/zh/model-studio/qwen-tts-api)
