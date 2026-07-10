import type { ModelProvider, ModelPrice, Plan, PromptTemplate } from "@aifilm/shared";
import type { MembershipPlan } from "@aifilm/shared";

export const defaultShopUrl = "https://pay.ldxp.cn/shop/ZHP28OV1";

export const plans: Plan[] = [
  {
    id: "plan_trial",
    name: "体验包",
    price: 9.9,
    credits: 1000,
    bonusCredits: 0,
    badge: "入门",
    shopUrl: defaultShopUrl,
    features: ["获得 1,000 积分", "兑换码可叠加体验额度", "充值积分永久有效"]
  },
  {
    id: "plan_growth",
    name: "进阶包",
    price: 59.9,
    credits: 6000,
    bonusCredits: 500,
    badge: "推荐",
    shopUrl: defaultShopUrl,
    features: ["合计 6,500 积分", "适合批量分镜", "充值积分永久有效"]
  },
  {
    id: "plan_pro",
    name: "专业包",
    price: 199.9,
    credits: 20000,
    bonusCredits: 3000,
    shopUrl: defaultShopUrl,
    features: ["合计 23,000 积分", "适合稳定内容生产", "高质量模式可用"]
  },
  {
    id: "plan_team",
    name: "团队包",
    price: 599.9,
    credits: 60000,
    bonusCredits: 6000,
    shopUrl: defaultShopUrl,
    features: ["合计 66,000 积分", "适合团队生产", "优先队列权益预留"]
  }
];

export const membershipPlans: MembershipPlan[] = [
  {
    id: "member_creator",
    name: "创作者会员",
    monthlyPrice: 39.9,
    monthlyCredits: 4000,
    discountPercent: 10,
    priorityLevel: 1,
    badge: "月度额度",
    enabled: true,
    shopUrl: defaultShopUrl,
    features: ["每月发放 4,000 积分", "模型单价 9 折", "普通优先队列"]
  },
  {
    id: "member_pro",
    name: "专业会员",
    monthlyPrice: 129.9,
    monthlyCredits: 14000,
    discountPercent: 20,
    priorityLevel: 2,
    badge: "专业模式",
    enabled: true,
    shopUrl: defaultShopUrl,
    features: ["每月发放 14,000 积分", "模型单价 8 折", "专业队列优先"]
  }
];

export const redeemCodes = [
  {
    id: "redeem_trial_300",
    code: "TRIAL300",
    name: "新用户体验额度",
    credits: 300,
    maxRedemptions: 200,
    enabled: true
  },
  {
    id: "redeem_creator_1000",
    code: "CREATOR1000",
    name: "创作者内测额度",
    credits: 1000,
    maxRedemptions: 50,
    enabled: true
  }
];

export const providers: ModelProvider[] = [
  { id: "deepseek", name: "DeepSeek 官方 API", modality: "text", enabled: true, baseUrl: "https://api.deepseek.com", models: ["deepseek-v4-pro", "deepseek-v4-flash"], costHint: "低成本主推文本通道，适合先跑通策划、剧本和分镜闭环。", capability: { supportsReferenceImage: false, supportsSeed: false, supportsImageToImage: false, supportsImageToVideo: false, supportsAsyncTask: false, ratios: [] } },
  { id: "dashscope-text", name: "阿里云百炼 / DashScope 文本", modality: "text", enabled: true, baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", models: ["qwen3.7-plus", "qwen3.7-max-2026-05-17", "qwen3.7-max-2026-06-08", "qwen3.6-flash-2026-04-16", "deepseek-v4-flash", "qwen3.6-35b-a3b", "glm-5.1", "tongyi-xiaomi-analysis-pro", "tongyi-xiaomi-analysis-flash", "qwen3.5-ocr"], costHint: "用于剧本解析、角色卡和分镜拆解的文本通道。", capability: { supportsReferenceImage: false, supportsSeed: false, supportsImageToImage: false, supportsImageToVideo: false, supportsAsyncTask: false, ratios: [] } },
  { id: "zml-text", name: "ZML / GPT-5.5", modality: "text", enabled: true, baseUrl: "https://api.zmlmfling.com", models: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"], costHint: "高质量剧本、分镜结构化输出和复核。", capability: { supportsReferenceImage: false, supportsSeed: false, supportsImageToImage: false, supportsImageToVideo: false, supportsAsyncTask: false, ratios: [] } },
  { id: "doubao-text", name: "豆包 Ark 文本评测", modality: "text", enabled: true, baseUrl: "https://ark.cn-beijing.volces.com/api/v3", models: ["doubao-seed-1-6-250615"], costHint: "火山方舟豆包文本通道，适合做低成本 LLM 质检评测员；Key 复用 DOUBAO_API_KEY / ARK_API_KEY。", capability: { supportsReferenceImage: false, supportsSeed: false, supportsImageToImage: false, supportsImageToVideo: false, supportsAsyncTask: false, ratios: [] } },
  { id: "google-ai-studio", name: "Google AI Studio / Gemini 3.1 Pro", modality: "text", enabled: true, baseUrl: "https://generativelanguage.googleapis.com/v1beta", models: ["gemini-3.1-pro-preview"], costHint: "独立 Google AI Studio 文本通道，走 Gemini Interactions API，适合高质量剧本理解、分镜拆解和结构化输出。", capability: { supportsReferenceImage: false, supportsSeed: false, supportsImageToImage: false, supportsImageToVideo: false, supportsAsyncTask: false, ratios: [] } },
  { id: "openai-upstream", name: "OpenAI 上游中转站 / gpt-5.5", modality: "text", enabled: false, baseUrl: "https://subapi.muxueai.pro", models: ["gpt-5.5"], costHint: "独立 OpenAI Responses/Chat 中转通道；需要时单独填 OPENAI_API_KEY 和上游 Base URL。", capability: { supportsReferenceImage: false, supportsSeed: false, supportsImageToImage: false, supportsImageToVideo: false, supportsAsyncTask: false, ratios: [] } },
  { id: "openai-compatible", name: "OpenAI-compatible 通用中转", modality: "text", enabled: false, baseUrl: "", models: ["openai-compatible"], costHint: "通用兼容通道，默认关闭；需要时在后台填 baseUrl 和模型。", capability: { supportsReferenceImage: false, supportsSeed: false, supportsImageToImage: false, supportsImageToVideo: false, supportsAsyncTask: false, ratios: [] } },
  { id: "dashscope-image", name: "通义万相 / Wanx 生图", modality: "image", enabled: true, models: ["wan2.6-t2i", "qwen-image", "qwen-image-plus", "qwen-image-2.0-pro-2026-04-22", "qwen-image-2.0-pro-2026-06-22"], costHint: "用于角色三视图、分镜首帧和项目风格统一的生图通道。", capability: { supportsReferenceImage: true, supportsSeed: true, supportsImageToImage: true, supportsImageToVideo: false, supportsAsyncTask: true, ratios: ["9:16", "16:9", "1:1"] } },
  { id: "zml-image", name: "ZML / GPT Image", modality: "image", enabled: true, baseUrl: "https://api.zmlmfling.com", models: ["gpt-image-2", "gpt-image-1.5", "gpt-image-1"], costHint: "高质量分镜图和角色参考图；默认使用 gpt-image-2。", capability: { supportsReferenceImage: false, supportsSeed: false, supportsImageToImage: false, supportsImageToVideo: false, supportsAsyncTask: false, ratios: ["9:16", "16:9", "1:1"] } },
  { id: "google-gemini-image", name: "Google AI Studio / Gemini Image", modality: "image", enabled: true, baseUrl: "https://generativelanguage.googleapis.com/v1beta", models: ["gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview"], costHint: "Google AI Studio 新生图通道，走 Gemini Interactions 生图接口；默认用 Gemini 3 Pro Image Preview，保留 3.1 Flash Image Preview 作为更快选项。", capability: { supportsReferenceImage: true, supportsSeed: false, supportsImageToImage: true, supportsImageToVideo: false, supportsAsyncTask: false, ratios: ["9:16", "16:9", "1:1"] } },
  { id: "doubao-seedream", name: "豆包 Seedream 图片", modality: "image", enabled: true, baseUrl: "https://ark.cn-beijing.volces.com/api/v3", models: ["doubao-seedream-5-0-lite-260128", "Doubao-Seedream-5.0-lite", "Doubao-Seedream-4.5", "Doubao-Seedream-4.0"], costHint: "低成本主推生图通道，通过火山方舟 Ark 接入；协作奖励计划模型请在后台填授权后的模型/接入点 ID，额度耗尽后可切换同类 Seedream 模型继续。", capability: { supportsReferenceImage: true, supportsSeed: true, supportsImageToImage: true, supportsImageToVideo: false, supportsAsyncTask: true, ratios: ["9:16", "16:9", "1:1"] } },
  { id: "mock-image", name: "Mock 图片演示适配器", modality: "image", enabled: false, models: ["mock-image-v1"], costHint: "本地演示用，不调用真实图片模型。", capability: { supportsReferenceImage: true, supportsSeed: true, supportsImageToImage: true, supportsImageToVideo: false, supportsAsyncTask: true, ratios: ["9:16", "16:9", "1:1"] } },
  { id: "comfyui", name: "ComfyUI 高级工作流", modality: "image", enabled: false, models: ["local-workflow", "character-consistency-workflow", "image2image-workflow"], costHint: "适合角色一致性、高级工作流和本地/云 GPU 部署。", capability: { supportsReferenceImage: true, supportsSeed: true, supportsImageToImage: true, supportsImageToVideo: false, supportsAsyncTask: true, ratios: ["9:16", "16:9", "1:1"] } },
  { id: "doubao-seedance", name: "豆包 Seedance 视频", modality: "video", enabled: true, baseUrl: "https://ark.cn-beijing.volces.com/api/v3", models: ["ep-20260703111128-95wms", "doubao-seedance-1-5-pro-251215", "Doubao-Seedance-1.5-pro", "Doubao-Seedance-1.0-pro", "Doubao-Seedance-1.0-lite-i2v", "Doubao-Seedance-1.0-lite-t2v"], costHint: "豆包 Seedance 图生视频模型，走火山方舟 contents/generations/tasks；优先填授权后的 ep- 接入点 ID。模型池会在免费额度耗尽、限流或未授权时自动切换下一个候选。", capability: { supportsReferenceImage: true, supportsSeed: false, supportsImageToImage: false, supportsImageToVideo: true, supportsAsyncTask: true, maxDuration: 5, ratios: ["9:16", "16:9", "1:1"] } },
  { id: "dashscope-video", name: "通义万相 / Wanx 视频", modality: "video", enabled: true, baseUrl: "https://dashscope.aliyuncs.com/api/v1", models: ["wan2.7-i2v-2026-04-25", "happyhorse-1.1-i2v", "happyhorse-1.1-r2v", "happyhorse-1.1-t2v", "happyhorse-1.0-video-edit", "wanx2.1-i2v-turbo", "wanx2.1-i2v-plus"], costHint: "优先走百炼免费额度视频池；免费额度耗尽、限流或未授权时自动切换模型继续生成，适合图生视频主链路。", capability: { supportsReferenceImage: true, supportsSeed: false, supportsImageToImage: false, supportsImageToVideo: true, supportsAsyncTask: true, maxDuration: 5, ratios: ["9:16", "16:9", "1:1"] } },
  { id: "dashscope-tts", name: "阿里云百炼 / Qwen TTS", modality: "tts", enabled: true, baseUrl: "https://dashscope.aliyuncs.com/api/v1", models: ["qwen3-tts-flash", "qwen3-tts-instruct-flash", "qwen-tts"], costHint: "正式可商用 TTS 主通道，走阿里云百炼官方 HTTP 接口；支持按角色 voice map 合成长文本配音，适合作为网站用户的默认配音链路。", capability: { supportsReferenceImage: false, supportsSeed: false, supportsImageToImage: false, supportsImageToVideo: false, supportsAsyncTask: false, ratios: [] } },
  { id: "longcat-audiodit", name: "LongCat-AudioDiT 开源角色配音", modality: "tts", enabled: false, baseUrl: "http://127.0.0.1:7868", models: ["meituan-longcat/LongCat-AudioDiT-1B", "meituan-longcat/LongCat-AudioDiT-3.5B"], costHint: "美团 LongCat-AudioDiT MIT 开源 TTS；建议作为 Python/GPU sidecar 接入，可按角色 prompt audio/text 做零样本音色克隆。", capability: { supportsReferenceImage: false, supportsSeed: false, supportsImageToImage: false, supportsImageToVideo: false, supportsAsyncTask: false, ratios: [] } },
  { id: "mock-video", name: "视频生成可插拔接口", modality: "video", enabled: false, models: ["mock-video-v1"], costHint: "本地演示占位，默认关闭。", capability: { supportsReferenceImage: true, supportsSeed: false, supportsImageToImage: false, supportsImageToVideo: true, supportsAsyncTask: true, maxDuration: 5, ratios: ["9:16", "16:9", "1:1"] } }
];

export const modelPrices: ModelPrice[] = [
  { id: "price_deepseek_v4pro_text_run", providerId: "deepseek", providerName: "DeepSeek 官方 API", modality: "text", model: "deepseek-v4-pro", unit: "text_run", unitCredits: 8, vendorCostCny: 0.02, enabled: true },
  { id: "price_deepseek_v4flash_text_run", providerId: "deepseek", providerName: "DeepSeek 官方 API", modality: "text", model: "deepseek-v4-flash", unit: "text_run", unitCredits: 4, vendorCostCny: 0.01, enabled: true },
  { id: "price_deepseek_chat_text_run", providerId: "deepseek", providerName: "DeepSeek 官方 API", modality: "text", model: "deepseek-chat", unit: "text_run", unitCredits: 4, vendorCostCny: 0.01, enabled: false },
  { id: "price_dashscope_text_qwen37_plus", providerId: "dashscope-text", providerName: "阿里云百炼 / DashScope 文本", modality: "text", model: "qwen3.7-plus", unit: "text_run", unitCredits: 6, vendorCostCny: 0, enabled: true },
  { id: "price_dashscope_text_qwen37_max_0517", providerId: "dashscope-text", providerName: "阿里云百炼 / DashScope 文本", modality: "text", model: "qwen3.7-max-2026-05-17", unit: "text_run", unitCredits: 8, vendorCostCny: 0, enabled: true },
  { id: "price_dashscope_text_qwen37_max_0608", providerId: "dashscope-text", providerName: "阿里云百炼 / DashScope 文本", modality: "text", model: "qwen3.7-max-2026-06-08", unit: "text_run", unitCredits: 8, vendorCostCny: 0, enabled: true },
  { id: "price_dashscope_text_qwen36_flash", providerId: "dashscope-text", providerName: "阿里云百炼 / DashScope 文本", modality: "text", model: "qwen3.6-flash-2026-04-16", unit: "text_run", unitCredits: 4, vendorCostCny: 0, enabled: true },
  { id: "price_dashscope_text_deepseek_v4_flash", providerId: "dashscope-text", providerName: "阿里云百炼 / DashScope 文本", modality: "text", model: "deepseek-v4-flash", unit: "text_run", unitCredits: 5, vendorCostCny: 0, enabled: true },
  { id: "price_dashscope_text_qwen36_35b", providerId: "dashscope-text", providerName: "阿里云百炼 / DashScope 文本", modality: "text", model: "qwen3.6-35b-a3b", unit: "text_run", unitCredits: 5, vendorCostCny: 0, enabled: true },
  { id: "price_dashscope_text_glm51", providerId: "dashscope-text", providerName: "阿里云百炼 / DashScope 文本", modality: "text", model: "glm-5.1", unit: "text_run", unitCredits: 5, vendorCostCny: 0, enabled: true },
  { id: "price_dashscope_text_xiaomi_pro", providerId: "dashscope-text", providerName: "阿里云百炼 / DashScope 文本", modality: "text", model: "tongyi-xiaomi-analysis-pro", unit: "text_run", unitCredits: 5, vendorCostCny: 0, enabled: true },
  { id: "price_dashscope_text_xiaomi_flash", providerId: "dashscope-text", providerName: "阿里云百炼 / DashScope 文本", modality: "text", model: "tongyi-xiaomi-analysis-flash", unit: "text_run", unitCredits: 4, vendorCostCny: 0, enabled: true },
  { id: "price_dashscope_text_qwen35_ocr", providerId: "dashscope-text", providerName: "阿里云百炼 / DashScope 文本", modality: "text", model: "qwen3.5-ocr", unit: "text_run", unitCredits: 4, vendorCostCny: 0, enabled: true },
  { id: "price_zml_gpt55_text_run", providerId: "zml-text", providerName: "ZML 中转站 / GPT-5.5", modality: "text", model: "gpt-5.5", unit: "text_run", unitCredits: 30, vendorCostCny: 0.18, enabled: true },
  { id: "price_zml_gpt54_text_run", providerId: "zml-text", providerName: "ZML 中转站 / GPT-5.5", modality: "text", model: "gpt-5.4", unit: "text_run", unitCredits: 24, vendorCostCny: 0.12, enabled: true },
  { id: "price_zml_gpt54mini_text_run", providerId: "zml-text", providerName: "ZML 中转站 / GPT-5.5", modality: "text", model: "gpt-5.4-mini", unit: "text_run", unitCredits: 12, vendorCostCny: 0.06, enabled: true },
  { id: "price_doubao_text_evaluator", providerId: "doubao-text", providerName: "豆包 Ark 文本评测", modality: "text", model: "doubao-seed-1-6-250615", unit: "text_run", unitCredits: 8, vendorCostCny: 0.02, enabled: true },
  { id: "price_google_gemini_31_pro_text_run", providerId: "google-ai-studio", providerName: "Google AI Studio / Gemini 3.1 Pro", modality: "text", model: "gemini-3.1-pro-preview", unit: "text_run", unitCredits: 24, vendorCostCny: 0.12, enabled: true },
  { id: "price_gpt55_text_run", providerId: "openai-upstream", providerName: "OpenAI 上游中转站 / gpt-5.5", modality: "text", model: "gpt-5.5", unit: "text_run", unitCredits: 30, vendorCostCny: 0.18, enabled: false },
  { id: "price_openai_compatible_text_run", providerId: "openai-compatible", providerName: "OpenAI-compatible 通用中转", modality: "text", model: "openai-compatible", unit: "text_run", unitCredits: 20, vendorCostCny: 0.06, enabled: false },
  { id: "price_dashscope_wan26_t2i", providerId: "dashscope-image", providerName: "通义万相 / Wanx 生图", modality: "image", model: "wan2.6-t2i", unit: "image", unitCredits: 10, vendorCostCny: 0, enabled: true },
  { id: "price_dashscope_qwen_image", providerId: "dashscope-image", providerName: "通义千问 / Qwen Image", modality: "image", model: "qwen-image", unit: "image", unitCredits: 8, vendorCostCny: 0.06, enabled: true },
  { id: "price_dashscope_qwen_image_plus", providerId: "dashscope-image", providerName: "通义千问 / Qwen Image", modality: "image", model: "qwen-image-plus", unit: "image", unitCredits: 12, vendorCostCny: 0.1, enabled: true },
  { id: "price_dashscope_qwen_image_20_pro_0422", providerId: "dashscope-image", providerName: "通义千问 / Qwen Image", modality: "image", model: "qwen-image-2.0-pro-2026-04-22", unit: "image", unitCredits: 10, vendorCostCny: 0, enabled: true },
  { id: "price_dashscope_qwen_image_20_pro_0622", providerId: "dashscope-image", providerName: "通义千问 / Qwen Image", modality: "image", model: "qwen-image-2.0-pro-2026-06-22", unit: "image", unitCredits: 10, vendorCostCny: 0, enabled: true },
  { id: "price_zml_gpt_image_2", providerId: "zml-image", providerName: "ZML 中转站 / GPT Image", modality: "image", model: "gpt-image-2", unit: "image", unitCredits: 28, vendorCostCny: 0.3, enabled: true },
  { id: "price_zml_gpt_image_15", providerId: "zml-image", providerName: "ZML 中转站 / GPT Image", modality: "image", model: "gpt-image-1.5", unit: "image", unitCredits: 22, vendorCostCny: 0.24, enabled: true },
  { id: "price_zml_gpt_image_1", providerId: "zml-image", providerName: "ZML 中转站 / GPT Image", modality: "image", model: "gpt-image-1", unit: "image", unitCredits: 18, vendorCostCny: 0.18, enabled: true },
  { id: "price_google_gemini_3_pro_image", providerId: "google-gemini-image", providerName: "Google AI Studio / Gemini Image", modality: "image", model: "gemini-3-pro-image-preview", unit: "image", unitCredits: 24, vendorCostCny: 0.18, enabled: true },
  { id: "price_google_gemini_31_flash_image", providerId: "google-gemini-image", providerName: "Google AI Studio / Gemini Image", modality: "image", model: "gemini-3.1-flash-image-preview", unit: "image", unitCredits: 16, vendorCostCny: 0.1, enabled: true },
  { id: "price_doubao_seedream_lite", providerId: "doubao-seedream", providerName: "豆包 Seedream 图片", modality: "image", model: "doubao-seedream-5-0-lite-260128", unit: "image", unitCredits: 8, vendorCostCny: 0.05, enabled: true },
  { id: "price_doubao_seedream_50_lite", providerId: "doubao-seedream", providerName: "豆包 Seedream 图片", modality: "image", model: "Doubao-Seedream-5.0-lite", unit: "image", unitCredits: 8, vendorCostCny: 0.05, enabled: true },
  { id: "price_doubao_seedream_45", providerId: "doubao-seedream", providerName: "豆包 Seedream 图片", modality: "image", model: "Doubao-Seedream-4.5", unit: "image", unitCredits: 10, vendorCostCny: 0.08, enabled: true },
  { id: "price_doubao_seedream_40", providerId: "doubao-seedream", providerName: "豆包 Seedream 图片", modality: "image", model: "Doubao-Seedream-4.0", unit: "image", unitCredits: 10, vendorCostCny: 0.08, enabled: true },
  { id: "price_mock_image", providerId: "mock-image", providerName: "Mock Image Adapter", modality: "image", model: "mock-image-v1", unit: "image", unitCredits: 5, vendorCostCny: 0, enabled: false },
  { id: "price_video_doubao_seedance_ep_95wms", providerId: "doubao-seedance", providerName: "豆包 Seedance 视频", modality: "video", model: "ep-20260703111128-95wms", unit: "video_second", unitCredits: 18, vendorCostCny: 0.18, enabled: true },
  { id: "price_video_doubao_seedance", providerId: "doubao-seedance", providerName: "豆包 Seedance 视频", modality: "video", model: "doubao-seedance-1-5-pro-251215", unit: "video_second", unitCredits: 18, vendorCostCny: 0.18, enabled: true },
  { id: "price_video_doubao_seedance_15_pro", providerId: "doubao-seedance", providerName: "豆包 Seedance 视频", modality: "video", model: "Doubao-Seedance-1.5-pro", unit: "video_second", unitCredits: 18, vendorCostCny: 0.18, enabled: true },
  { id: "price_video_doubao_seedance_10_pro", providerId: "doubao-seedance", providerName: "豆包 Seedance 视频", modality: "video", model: "Doubao-Seedance-1.0-pro", unit: "video_second", unitCredits: 16, vendorCostCny: 0.16, enabled: true },
  { id: "price_video_doubao_seedance_10_lite_i2v", providerId: "doubao-seedance", providerName: "豆包 Seedance 视频", modality: "video", model: "Doubao-Seedance-1.0-lite-i2v", unit: "video_second", unitCredits: 12, vendorCostCny: 0.12, enabled: true },
  { id: "price_video_doubao_seedance_10_lite_t2v", providerId: "doubao-seedance", providerName: "豆包 Seedance 视频", modality: "video", model: "Doubao-Seedance-1.0-lite-t2v", unit: "video_second", unitCredits: 12, vendorCostCny: 0.12, enabled: true },
  { id: "price_video_dashscope_wan27_i2v", providerId: "dashscope-video", providerName: "通义万相 / Wanx 视频", modality: "video", model: "wan2.7-i2v-2026-04-25", unit: "video_second", unitCredits: 12, vendorCostCny: 0, enabled: true },
  { id: "price_video_dashscope_happyhorse_i2v", providerId: "dashscope-video", providerName: "通义万相 / Wanx 视频", modality: "video", model: "happyhorse-1.1-i2v", unit: "video_second", unitCredits: 12, vendorCostCny: 0, enabled: true },
  { id: "price_video_dashscope_happyhorse_r2v", providerId: "dashscope-video", providerName: "通义万相 / Wanx 视频", modality: "video", model: "happyhorse-1.1-r2v", unit: "video_second", unitCredits: 14, vendorCostCny: 0, enabled: true },
  { id: "price_video_dashscope_happyhorse_t2v", providerId: "dashscope-video", providerName: "通义万相 / Wanx 视频", modality: "video", model: "happyhorse-1.1-t2v", unit: "video_second", unitCredits: 14, vendorCostCny: 0, enabled: true },
  { id: "price_video_dashscope_happyhorse_edit", providerId: "dashscope-video", providerName: "通义万相 / Wanx 视频", modality: "video", model: "happyhorse-1.0-video-edit", unit: "video_second", unitCredits: 14, vendorCostCny: 0, enabled: true },
  { id: "price_video_dashscope_wanx_i2v", providerId: "dashscope-video", providerName: "通义万相 / Wanx 视频", modality: "video", model: "wanx2.1-i2v-turbo", unit: "video_second", unitCredits: 16, vendorCostCny: 0.16, enabled: true },
  { id: "price_video_dashscope_wanx_i2v_plus", providerId: "dashscope-video", providerName: "通义万相 / Wanx 视频", modality: "video", model: "wanx2.1-i2v-plus", unit: "video_second", unitCredits: 24, vendorCostCny: 0.24, enabled: true },
  { id: "price_video_mock", providerId: "mock-video", providerName: "视频生成可插拔接口", modality: "video", model: "mock-video-v1", unit: "video_second", unitCredits: 0, vendorCostCny: 0, enabled: false },
  { id: "price_dashscope_tts_qwen3_flash", providerId: "dashscope-tts", providerName: "阿里云百炼 / Qwen TTS", modality: "tts", model: "qwen3-tts-flash", unit: "tts_character", unitCredits: 1, vendorCostCny: 0, enabled: true },
  { id: "price_dashscope_tts_qwen3_instruct_flash", providerId: "dashscope-tts", providerName: "阿里云百炼 / Qwen TTS", modality: "tts", model: "qwen3-tts-instruct-flash", unit: "tts_character", unitCredits: 1, vendorCostCny: 0, enabled: true },
  { id: "price_dashscope_tts_qwen_tts", providerId: "dashscope-tts", providerName: "阿里云百炼 / Qwen TTS", modality: "tts", model: "qwen-tts", unit: "tts_character", unitCredits: 1, vendorCostCny: 0.002, enabled: true },
  { id: "price_longcat_audiodit_1b", providerId: "longcat-audiodit", providerName: "LongCat-AudioDiT 开源角色配音", modality: "tts", model: "meituan-longcat/LongCat-AudioDiT-1B", unit: "tts_character", unitCredits: 1, vendorCostCny: 0, enabled: false },
  { id: "price_tts_placeholder", providerId: "openai-compatible", providerName: "TTS 可插拔接口", modality: "tts", model: "tts-adapter", unit: "tts_character", unitCredits: 1, vendorCostCny: 0.002, enabled: false }
];

export const templates: PromptTemplate[] = [
  {
    id: "tpl_planning_v1",
    name: "短剧策划 Agent",
    type: "planning",
    version: "1.0.0",
    enabled: true,
    summary: "提炼题材、爆点、人物关系、集数结构和投流钩子。"
  },
  {
    id: "tpl_script_v1",
    name: "小说改编编剧 Agent",
    type: "script",
    version: "1.0.0",
    enabled: true,
    summary: "根据输入内容生成故事梗概、改编策略和剧本文本。"
  },
  {
    id: "tpl_storyboard_v1",
    name: "分镜导演 Agent",
    type: "storyboard",
    version: "1.0.0",
    enabled: true,
    summary: "台词零删改、长台词拆镜、角色不消失、镜头连续、资产关联。"
  },
  {
    id: "tpl_character_v1",
    name: "角色一致性 Agent",
    type: "character",
    version: "1.0.0",
    enabled: true,
    summary: "生成角色身份卡、稳定外貌锚点、seed、负面提示词和衍生资产规则。"
  },
  {
    id: "tpl_character_identity_board_v1",
    name: "角色身份板 Image2 提示词",
    type: "character",
    version: "1.0.0",
    enabled: true,
    summary: "生成正面全身、3/4侧面、背面和大头照，用作角色一致性身份锚点。",
    content: [
      "你正在为 AI 短剧生产创建角色身份板，不是普通角色海报。",
      "如果有用户上传参考图，先抽取视觉签名：脸型、眼距、鼻口、发型、发色、服装轮廓、主色、体态和年龄感，再围绕该身份延展。",
      "单张 16:9 图片，四个清晰分区：正面全身、3/4 侧面全身、背面全身、半身大头照。",
      "四个分区必须是同一个角色，同一张脸、同一发型、同一服装主色、同一身体比例和同一气质。",
      "干净暖白背景，适合作为后续分镜图和图生视频参考图。",
      "不要生成文字、标签、水印、额外人物、换装、换脸或不同年龄版本。"
    ].join("\n")
  },
  {
    id: "tpl_storyboard_first_frame_v1",
    name: "故事板首帧 Image2 提示词",
    type: "image",
    version: "1.0.0",
    enabled: true,
    summary: "把角色身份板、场景卡和镜头卡组合成可用于图生视频的故事板首帧。",
    content: [
      "你正在生成可供 AI 视频模型使用的导演故事板首帧，不是漫画成品。",
      "使用给定角色身份板和场景卡，保持角色脸、发型、服装、体态、场景光线和空间方向一致。",
      "只表现当前镜头的一个主动作和一个情绪状态。",
      "明确画面站位：screen-left / center / screen-right，foreground / midground / background。",
      "画面应适合作为图生视频首帧：主体完整、动作起点明确、构图清楚。",
      "不要生成字幕、对白气泡、标题字、水印、表格、UI 标签或额外人物。"
    ].join("\n")
  },
  {
    id: "tpl_seedance_segment_v1",
    name: "Seedance 视频段提示词",
    type: "video",
    version: "1.0.0",
    enabled: true,
    summary: "用首帧、主动作、尾帧和连续性交接生成稳定的 Seedance 图生视频片段。",
    content: [
      "以给定首帧为开场，生成一个连续的 AI 真人短剧视频段。",
      "保持角色身份、服装、发型、场景、道具和画面方向一致。",
      "每段优先 6-12 秒，最多 15 秒，只承载一个连续微节拍。",
      "必须写清首帧锚点、镜头、站位、主动作、声音、尾帧锚点和连续性交接。",
      "对白只作为角色语音出现。",
      "避免项：不要生成对白字幕、标题字、解释字、旁白字卡、水印；不要换脸、换装、增加人物、改变道具归属或越轴。"
    ].join("\n")
  },
  {
    id: "tpl_storyboard_auto_repair_v1",
    name: "故事板自动修复策略",
    type: "review",
    version: "1.0.0",
    enabled: true,
    summary: "根据角色漂移、首帧污染、视频不可剪辑等失败原因选择重生、改提示词或换模型。",
    content: [
      "当角色评测低于 80 或反馈出现脸部漂移：优先重新生成角色身份板；仍失败则要求上传更清晰正面参考图。",
      "当分镜图出现字幕、水印、构图不可用：追加避免项并重生本镜头首帧；仍失败则切换生图模型或降低画面复杂度。",
      "当视频动作漂移、人物变形或不可剪辑：缩短时长，强化首尾帧锚点后重生视频；仍失败则回退重生首帧或切换视频模型。",
      "所有修复都记录 provider、model、promptVersion、失败原因、用户是否选中，用于后续评测数据集。"
    ].join("\n")
  },
  {
    id: "tpl_eval_script_v1",
    name: "剧本阶段 LLM 评测评分标准",
    type: "script",
    version: "1.0.0",
    enabled: true,
    summary: "评估剧本是否具备进入角色定稿和分镜生产的条件。",
    content: [
      "你正在评测 AI 漫剧项目的剧本确认阶段。目标不是文学打分，而是判断它能否稳定进入角色定稿、分镜拆解和视频资产生产。",
      "评分维度：structure 0-20，hook 0-20，episode 0-15，character 0-15，visual 0-15，production 0-15。",
      "重点检查：故事主线是否清楚；前三屏是否有钩子；集数和字数是否匹配；主要角色动机是否可被视觉化；是否有足够场景、动作、冲突可拆分为分镜。",
      "扣分规则：只有抽象设定没有剧情动作扣 production/visual；角色只有姓名没有身份和目标扣 character；剧情无法拆集扣 episode；缺少反转或爽点扣 hook。",
      "recommendedAction 只能从 continue、rewrite_script、clarify_characters、reduce_complexity 中选择。输出只允许合法 JSON。"
    ].join("\n")
  },
  {
    id: "tpl_eval_character_v1",
    name: "角色阶段 LLM 评测评分标准",
    type: "character",
    version: "1.0.0",
    enabled: true,
    summary: "评估角色定稿、多视图和参考图是否足以支撑角色一致性。",
    content: [
      "你正在评测 AI 漫剧项目的角色定稿阶段。目标是判断角色是否已经能稳定进入批量分镜图生成。",
      "评分维度：identity 0-15，appearance 0-20，multiview 0-25，storyMatch 0-15，referenceFollow 0-15，negativePrompt 0-10。",
      "重点检查：每个主角是否有清晰身份、外貌锚点、服装主色、稳定配饰；是否有正面、侧面、半身或全身等多视图；如果用户上传参考图，是否围绕参考图延展而不是重新发明角色。",
      "扣分规则：没有真实参考图 URL 或多视图资产时 multiview 大幅扣分；外貌描述互相矛盾扣 appearance；没有负面提示词扣 negativePrompt；角色和剧情身份不匹配扣 storyMatch。",
      "recommendedAction 只能从 lock_character、regenerate_multiview、edit_prompt、upload_reference 中选择。输出只允许合法 JSON。"
    ].join("\n")
  },
  {
    id: "tpl_eval_storyboard_v1",
    name: "分镜阶段 LLM 评测评分标准",
    type: "storyboard",
    version: "1.0.0",
    enabled: true,
    summary: "评估分镜拆解是否顺序清晰、可出图、可接视频。",
    content: [
      "你正在评测 AI 漫剧项目的分镜拆解阶段。目标是判断每条分镜是否能直接驱动分镜图和图生视频。",
      "评分维度：order 0-10，imageability 0-20，continuity 0-20，simplicity 0-15，rhythm 0-15，prompt 0-20。",
      "重点检查：镜头编号是否连续；每个镜头是否有明确角色、场景、动作、情绪和画面描述；提示词是否引用角色/场景资产；镜头之间是否有动作、视线、情绪或声音承接。",
      "扣分规则：镜头参数过度复杂但不能提升出图扣 simplicity；连续多个镜头画面重复扣 rhythm；提示词缺角色资产、场景或动作扣 prompt；只有台词没有画面扣 imageability。",
      "recommendedAction 只能从 generate_images、edit_bad_shots、regenerate_storyboard 中选择。输出只允许合法 JSON。"
    ].join("\n")
  },
  {
    id: "tpl_eval_image_v1",
    name: "图片阶段 LLM 评测评分标准",
    type: "image",
    version: "1.0.0",
    enabled: true,
    summary: "评估分镜图是否真实返回、角色一致、适合作视频首帧。",
    content: [
      "你正在评测 AI 漫剧项目的分镜图阶段。目标是判断图片是否能作为后续图生视频首帧使用。",
      "评分维度：promptMatch 0-20，characterConsistency 0-25，composition 0-15，artifact 0-20，videoReady 0-20。",
      "重点检查：是否有真实图片 URL；画幅是否正确；角色是否延续定稿多视图；画面是否符合分镜描述；是否存在崩坏、水印、文字污染、肢体错误或遮挡。",
      "扣分规则：没有真实图片 URL 时总分通常不得超过 40；角色明显漂移扣 characterConsistency；构图无法引导视频动作扣 videoReady；画面与提示词不符扣 promptMatch。",
      "recommendedAction 只能从 accept、regenerate_same_prompt、edit_prompt、regenerate_character 中选择。输出只允许合法 JSON。"
    ].join("\n")
  },
  {
    id: "tpl_eval_video_v1",
    name: "视频阶段 LLM 评测评分标准",
    type: "video",
    version: "1.0.0",
    enabled: true,
    summary: "评估视频草稿是否可剪辑、可配音字幕、可进入合成。",
    content: [
      "你正在评测 AI 漫剧项目的视频草稿阶段。目标是判断镜头片段是否能进入剪辑、字幕、配音和合成。",
      "评分维度：firstFrame 0-20，identity 0-20，motion 0-20，intent 0-20，editable 0-20。",
      "重点检查：首帧是否来自合格分镜图；角色身份是否稳定；动作是否符合视频提示词；镜头时长、节奏和转场是否可剪辑；是否有明显变形、闪烁或主体漂移。",
      "扣分规则：没有视频 URL 或首帧资产时总分通常不得超过 45；人物动作不自然扣 motion；剧情意图不清扣 intent；不可剪辑或过度抖动扣 editable。",
      "recommendedAction 只能从 accept、regenerate_video_clip、edit_prompt、regenerate_first_frame 中选择。输出只允许合法 JSON。"
    ].join("\n")
  }
];
