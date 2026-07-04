# 上游中转站模型接入说明

本项目支持两类中转站能力：

1. 文本模型：`Responses API` 调用 `gpt-5.5`。
2. 图片模型：优先使用通义万相/DashScope，保留 OpenAI-compatible `/images/generations` 调用 `image2/gpt-image-2`。

不要把真实 API Key 提交到仓库。Key 只放本地 `apps/api/.env` 或服务器环境变量。

## 1. 文本模型 gpt-5.5

在 `apps/api/.env` 中配置：

```env
OPENAI_BASE_URL=https://subapi.muxueai.pro
OPENAI_TEXT_WIRE_API=responses
OPENAI_TEXT_MODEL=gpt-5.5
OPENAI_REASONING_EFFORT=xhigh
OPENAI_DISABLE_RESPONSE_STORAGE=true
OPENAI_API_KEY=你的中转站key
```

前端使用方式：

1. 打开创作向导。
2. 模型路由选择 `OpenAI 上游中转站`。
3. 模型选择 `gpt-5.5`。
4. 点击测试模型。
5. 成功后可生成剧本、角色和分镜。

## 2. 图片模型：MVP 优先通义万相

在 `apps/api/.env` 中配置：

```env
IMAGE_PROVIDER=dashscope
IMAGE_BATCH_LIMIT=1
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/api/v1
DASHSCOPE_IMAGE_MODEL=qwen-image
DASHSCOPE_API_KEY=你的通义万相或百炼key
```

如果你使用的是阿里云百炼工作空间专属域名，`DASHSCOPE_BASE_URL` 可以填控制台给出的 DashScope URL，例如：

```env
DASHSCOPE_BASE_URL=https://你的工作空间域名/api/v1
```

当前验证结果：

- `dashscope-image + qwen-image` 已能返回真实图片地址。
- 建议 MVP 阶段保持 `IMAGE_BATCH_LIMIT=1`，每次只补生成 1 张，避免批量消耗额度。
- 前端创建页可点击“测试生图模型”，确认当前 key、模型和 endpoint 可用。

## 3. 图片模型 image2 / gpt-image-2

在 `apps/api/.env` 中配置：

```env
IMAGE_PROVIDER=jxb-image
OPENAI_IMAGE_BASE_URL=https://subapi.muxueai.pro
OPENAI_IMAGE_MODEL=image2
OPENAI_IMAGE_API_KEY=你的中转站key
```

如果图片模型和文本模型共用同一个 key，也可以只配置：

```env
IMAGE_PROVIDER=openai-compatible
OPENAI_BASE_URL=https://subapi.muxueai.pro
OPENAI_API_KEY=你的中转站key
OPENAI_IMAGE_MODEL=image2
```

`image2` 在前端保留为友好名称，后端会把它规范化为 `gpt-image-2` 发给 OpenAI-compatible 图片接口。

当前中转站验证结论：

- 你的中转站 key 可以列出 `gpt-image-2` 模型。
- `image2` 直接调用会被上游识别为非图片模型名，因此后端已做别名转换。
- `gpt-image-2` 实际生成时，上游曾返回 502，这属于中转站图片上游通道问题，不是本地代码问题。

## 4. 可接入 gpt-image-2 的平台选择

### A. OpenAI 官方 API

- 稳定性最好，接口和模型能力最标准。
- 需要你提供：OpenAI API Key、是否有图片模型权限、可用的模型 ID、账单状态。
- 适合正式商业化，但国内使用可能需要解决账号、支付和网络问题。

### B. Azure OpenAI

- 适合企业合规部署，稳定性强。
- 需要你提供：Azure endpoint、deployment name、API version、key、开通区域和模型部署截图。
- 注意：是否有 `gpt-image-2` 取决于 Azure 当时开放的区域和模型部署能力。

### C. OpenAI-compatible 中转站

- 最适合你现在的项目形态，可以把已有中转站额度用于项目调用。
- 需要你提供：Base URL、API Key、模型列表截图、图片接口文档或 curl 示例、返回格式是 URL 还是 base64、支持的尺寸/质量参数。
- 风险是图片模型经常依赖上游通道，容易出现 502、模型名别名不一致、仅文本接口可用等问题。

### D. 国内替代图像模型

- 通义万相/Qwen Image、豆包生图、可灵/即梦等更适合 MVP 低成本验证。
- 不一定是 `gpt-image-2`，但更容易在国内网络和账号体系下跑通。
- 建议商业化早期采用“国内稳定模型 + image2 高质量入口保留”的双路线。

## 5. 接入任意新图片平台时需要提供

- 平台 Base URL。
- API Key 或鉴权方式。
- 精确模型 ID。
- 请求 endpoint：例如 `/v1/images/generations`、`/responses` 或平台自定义路径。
- 官方示例 curl 或请求 JSON。
- 返回格式：图片 URL、base64、异步 task_id 轮询地址。
- 支持参数：尺寸、比例、质量、seed、参考图、负面词、批量张数。
- 计费方式：按张、按 token、按分辨率、是否有免费额度。

## 6. 当前代码位置

- 文本 Responses API：`apps/api/src/agents/generator.ts`
- 图片 relay API：`apps/api/src/providers/dashscopeImage.ts`
- 模型供应商目录：`apps/api/src/data.ts`
- 模型计费表：`apps/api/src/data.ts`
- 前端模型选择：`apps/web/src/pages/WizardPage.tsx`

## 7. 计费策略

当前后台默认价格按人民币 1:1 积分口径设置，不再按美元倍率放大。`gpt-image-2` 成本按 `1 USD ≈ 7.2 RMB` 粗算约 0.31 元/张，用户侧默认略留毛利。

- `deepseek-v4-flash`：4 积分 / 次
- `deepseek-v4-pro`：8 积分 / 次
- JXB DeepSeek：5 积分 / 次
- `gpt-5.5`：30 积分 / 次，作为高质量/专业模式
- 豆包 Seedream / Qwen Image：8 积分 / 张，作为低成本生图闭环
- `gpt-image-2`：30 积分 / 张，作为高质量/专业模式

这些价格都可在后台管理页调整。后台生图测试会使用分镜镜头 prompt 发起真实请求；如果上游返回图片 URL，会直接在后台展示预览图。

## 8. 注意事项

- 不同中转站对 `/responses` 和 `/images/generations` 的兼容程度可能不同。
- 如果 `gpt-5.5` 测试失败，优先检查 `OPENAI_BASE_URL` 是否需要带 `/v1`。
- 如果 `image2` 测试失败，优先确认中转站是否支持 `/images/generations`。
- 真实图片生成会产生模型费用，建议先保留 `IMAGE_BATCH_LIMIT=1` 小批量测试。
