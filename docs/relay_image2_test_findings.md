# 中转站 gpt-5.5 / image2 调用测试结论

更新时间：2026-06-27

## 结论

1. `gpt-5.5` 文本连接测试成功，项目后端可以通过上游中转站完成模型连通性测试。
2. `gpt-5.5` 执行完整“剧本 + 角色 + 9 分镜 JSON”长任务时，上游会超时或返回 HTML，系统目前会自动回退本地结构化生成器，保证流程不断。
3. 中转站图片接口已接入 OpenAI-compatible `/images/generations` 与 `/v1/images/generations` 双路径兜底。
4. 本地实测 `image2` 在图片 endpoint 下返回“需要 image model”，说明该模型名在这个中转站不被当作图片模型。
5. 本地实测 `gpt-image-1` 返回“当前分组账号未配置支持”，说明该中转站账号/分组暂未开通该图片模型。

## Codex 对话生图与项目后端生图的区别

Codex 对话里的生图能力不能直接作为商业 SaaS 后端的图片 API 使用。项目后端需要直接调用一个明确的图片 API，这样才能记录任务、扣积分、核算成本、失败重试和资产入库。

可行方案：

- 中转站开通图片模型：确认可用模型名和接口路径后，填入 `OPENAI_IMAGE_MODEL`。
- 使用通义万相 / 即梦 / 可灵 / 火山等国内图片 API：图片费用扣对应平台额度。
- 使用 ComfyUI / Stable Diffusion：适合本地或自部署，成本来自机器/GPU。
- 使用模型网关：后续可接 LiteLLM 或自研 gateway，把多个供应商统一成一个 Provider。

## 当前代码保护

- `IMAGE_BATCH_LIMIT=1` 已对 `relay` 生效，测试时只会生成 1 张分镜图。
- 图片模型失败时会回退 Mock 预览，流程不会中断。
- 文本长任务失败时会回退本地结构化生成器，项目仍会写入剧本、角色、分镜和任务记录。

## 下一步

中转站后台需要确认这两项：

- 可用图片模型名，例如是否有 `flux`、`dall-e-3`、`gpt-image-1`、`jimeng`、`wanx`、`qwen-image` 等。
- 图片接口路径与请求格式，例如 `/v1/images/generations`、`/images/generations` 或自定义路径。
