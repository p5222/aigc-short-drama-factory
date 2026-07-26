import type { AssetItem, CharacterProfile, CreateProjectInput, ScriptDraft, StoryboardShot } from "@aifilm/shared";

import { createToonflowScriptPlan, createToonflowStoryboardPlan } from "./toonflowAdapter.js";
import { blockModelUntilNextDay, coolDownModel, getModelQuotaDecision, recordModelSubmission } from "../providers/modelQuota.js";
import { materializePrompt } from "../prompts/runtime.js";

interface PipelineCharacter {
  name: string;
  identity: string;
  appearance: string;
  costume: string;
  personality: string;
  voice?: string;
}

interface PipelineStoryboard {
  episodeNo?: number;
  sceneNo: number;
  shotNo: number;
  duration: number;
  shotSize: string;
  cameraAngle: string;
  cameraMovement: string;
  characters: string[];
  scene: string;
  pictureDesc: string;
  action: string;
  orientation: string;
  spatialRelation: string;
  dialogue: string;
  voiceOver: string;
  environmentSound: string;
  soundEffect: string;
  emotion: string;
  imagePrompt: string;
  videoPrompt: string;
}

interface PipelineOutput {
  synopsis: string;
  script: string;
  characters: PipelineCharacter[];
  storyboards: PipelineStoryboard[];
}

type TextModelResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
  steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
};

type TextRuntimeOptions = Pick<CreateProjectInput, "textProvider" | "textModel"> & {
  baseUrl?: string;
  apiKey?: string;
  textModelPool?: string[];
};

export interface GeneratedProjectContent {
  mode: "real" | "local";
  script: ScriptDraft;
  characters: CharacterProfile[];
  assets: AssetItem[];
  storyboards: StoryboardShot[];
}

export interface GeneratedProjectScriptContent {
  mode: "real" | "local";
  script: ScriptDraft;
  characters: CharacterProfile[];
  assets: AssetItem[];
}

export interface GeneratedProjectStoryboardContent {
  mode: "real" | "local";
  assets: AssetItem[];
  storyboards: StoryboardShot[];
}

export async function generateProjectContent(projectId: string, input: CreateProjectInput): Promise<GeneratedProjectContent> {
  const canUseModel = hasTextModelConfig(input);

  if (canUseModel) {
    try {
      const output = await generateWithModel(input);
      return normalizeOutput(projectId, input, output, "real");
    } catch (error) {
      throw new Error("真实文本模型调用失败：" + errorMessage(error));
    }
  }

  return normalizeOutput(projectId, input, generateLocalOutput(input), "local");
}

export async function generateProjectScriptContent(projectId: string, input: CreateProjectInput): Promise<GeneratedProjectScriptContent> {
  const canUseModel = hasTextModelConfig(input);

  if (canUseModel) {
    try {
      const output = await generateScriptWithModel(input);
      return normalizeScriptOutput(projectId, input, output, "real");
    } catch (error) {
      throw new Error("真实剧本模型调用失败：" + errorMessage(error));
    }
  }

  const local = generateLocalOutput(input);
  return normalizeScriptOutput(
    projectId,
    input,
    {
      synopsis: local.synopsis,
      script: input.sourceType === "script" ? input.content.trim() : local.script,
      characters: local.characters
    },
    "local"
  );
}

export async function generateProjectStoryboards(
  projectId: string,
  input: CreateProjectInput,
  script: Pick<ScriptDraft, "synopsis" | "content">,
  characters: CharacterProfile[]
): Promise<GeneratedProjectStoryboardContent> {
  const canUseModel = hasTextModelConfig(input);
  const baseCharacters = characters.length
    ? characters.map<PipelineCharacter>((character) => ({
        name: character.name,
        identity: character.identity,
        appearance: character.appearance,
        costume: character.costume,
        personality: character.personality,
        voice: character.voiceId
      }))
    : generateLocalOutput(input).characters;

  if (canUseModel) {
    try {
      const output = await generateStoryboardsWithModel(input, script, baseCharacters);
      const normalized = normalizeOutput(
        projectId,
        input,
        { synopsis: script.synopsis, script: script.content, characters: baseCharacters, storyboards: output.storyboards },
        "real"
      );
      return {
        mode: "real",
        assets: normalized.assets.filter((asset) => asset.type !== "role"),
        storyboards: normalized.storyboards
      };
    } catch (error) {
      console.warn("[storyboard] real model failed, falling back to local storyboards:", error);
      const local = generateLocalOutput(input);
      const normalized = normalizeOutput(
        projectId,
        input,
        {
          ...local,
          synopsis: script.synopsis || local.synopsis,
          script: script.content || local.script,
          characters: baseCharacters,
          storyboards: local.storyboards
        },
        "local"
      );
      return {
        mode: "local",
        assets: normalized.assets.filter((asset) => asset.type !== "role"),
        storyboards: normalized.storyboards
      };
    }
  }

  const local = generateLocalOutput(input);
  const normalized = normalizeOutput(
    projectId,
    input,
    {
      ...local,
      synopsis: script.synopsis || local.synopsis,
      script: script.content || local.script,
      characters: baseCharacters,
      storyboards: local.storyboards
    },
    "local"
  );
  return {
    mode: "local",
    assets: normalized.assets.filter((asset) => asset.type !== "role"),
    storyboards: normalized.storyboards
  };
}

export async function testTextModelConnection(options: TextRuntimeOptions = {}) {
  if (!hasTextModelConfig(options)) {
    return {
      ok: true,
      mode: "local" as const,
      provider: "Local Generator",
      model: "local-storyboard-v1",
      message: "未检测到文本模型 API Key，当前会使用本地结构化生成器跑通完整流程。"
    };
  }

  const started = Date.now();
  await callOpenAICompatible({
    temperature: 0,
    max_tokens: 60,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "只输出合法 JSON。" },
      { role: "user", content: "请输出 {\"ok\":true,\"message\":\"ready\"}" }
    ]
  }, options);

  return {
    ok: true,
    mode: "real" as const,
    provider: textProviderName(options),
    model: textModelName(options),
    message: `真实模型连接成功，耗时 ${Date.now() - started}ms。创作向导会优先调用该模型。`
  };
}

export async function callTextModelJson<T>(
  options: TextRuntimeOptions & {
    system: string;
    prompt: string;
    temperature?: number;
    maxTokens?: number;
    label?: string;
  }
): Promise<T> {
  const data = await callOpenAICompatible({
    temperature: options.temperature ?? 0.18,
    max_tokens: options.maxTokens ?? Number(process.env.QUALITY_EVALUATOR_MAX_TOKENS ?? 1800),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: options.system },
      { role: "user", content: options.prompt }
    ]
  }, options);

  const content = getModelContent(data);
  if (!content) throw new Error(`${options.label ?? "文本模型"}没有返回内容`);
  return parseModelJson<T>(content, options.label ?? "文本模型 JSON");
}

async function generateWithModel(input: CreateProjectInput): Promise<PipelineOutput> {
  const prompt = buildPrompt(input);
  const data = await callOpenAICompatible({
    temperature: 0.72,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "你是专业短剧策划、编剧、分镜导演和 AI 影像提示词工程师。只输出合法 JSON，不输出 Markdown。"
      },
      { role: "user", content: prompt }
    ]
  }, input);

  const content = getModelContent(data);
  if (!content) throw new Error("模型没有返回内容");

  return parseModelJson<PipelineOutput>(content, "文本模型");
}

async function generateScriptWithModel(input: CreateProjectInput): Promise<Omit<PipelineOutput, "storyboards">> {
  const data = await callOpenAICompatible({
    temperature: 0.72,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You are a professional Chinese short-drama planner and screenwriter. Write in Simplified Chinese. Output valid JSON only."
      },
      { role: "user", content: buildScriptPrompt(input) }
    ]
  }, input);

  const content = getModelContent(data);
  if (!content) throw new Error("Model returned empty content");

  const parsed = parseModelJson<Omit<PipelineOutput, "storyboards">>(content, "剧本模型");
  assertUsableScriptOutput(parsed, input.sourceType);
  return parsed;
}

async function generateStoryboardsWithModel(
  input: CreateProjectInput,
  script: Pick<ScriptDraft, "synopsis" | "content">,
  characters: PipelineCharacter[]
): Promise<{ storyboards: PipelineStoryboard[] }> {
  const data = await callOpenAICompatible({
    temperature: 0.68,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You are a professional storyboard director and AI visual prompt engineer. Write in Simplified Chinese. Output valid JSON only."
      },
      { role: "user", content: buildStoryboardPrompt(input, script, characters) }
    ]
  }, input);

  const content = getModelContent(data);
  if (!content) throw new Error("Model returned empty content");

  const parsed = parseModelJson<{ storyboards?: PipelineStoryboard[] }>(content, "分镜模型");
  return { storyboards: parsed.storyboards ?? [] };
}

async function callOpenAICompatible(body: Record<string, unknown>, options: TextRuntimeOptions = {}) {
  const provider = options.textProvider || defaultTextProviderId();
  if (provider === "google-ai-studio") {
    return callGeminiInteraction(body, options);
  }

  if (shouldUseResponsesApi(options, provider)) {
    try {
      return await callResponsesApi(body, options);
    } catch (error) {
      console.warn("[generator] Responses API failed, retrying chat completions on the same upstream:", error);
      return callChatCompletionsApi(body, options, "openai-upstream");
    }
  }

  return callChatCompletionsApi(body, options);
}

async function callGeminiInteraction(body: Record<string, unknown>, options: TextRuntimeOptions = {}) {
  const runtime = resolveTextRuntime({ ...options, textProvider: "google-ai-studio" });
  if (!runtime.apiKey) throw new Error("Missing GEMINI_API_KEY for Google AI Studio");
  if (!runtime.baseUrl) throw new Error("Missing base URL for Google AI Studio");

  const messages = (body.messages ?? []) as Array<{ role: string; content: string }>;
  const systemInstruction = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const userParts = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({ text: `${message.role === "assistant" ? "assistant" : "user"}: ${message.content}` }));

  const useInteractions = process.env.GEMINI_TEXT_WIRE_API === "interactions";
  const url = useInteractions ? geminiEndpoint(runtime.baseUrl, "interactions") : geminiModelEndpoint(runtime.baseUrl, runtime.model, "generateContent");
  const payload = useInteractions
    ? {
        model: runtime.model,
        input: userParts.map((part) => part.text).join("\n\n") || "请输出 {\"ok\":true}",
        system_instruction: systemInstruction || undefined,
        generation_config: {
          temperature: typeof body.temperature === "number" ? body.temperature : 0.7,
          max_output_tokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS ?? body.max_tokens ?? 2400),
          thinking_level: process.env.GEMINI_THINKING_LEVEL || "low"
        }
      }
    : {
        systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
        contents: [{ role: "user", parts: userParts.length ? userParts : [{ text: "请输出 {\"ok\":true}" }] }],
        generationConfig: {
          temperature: typeof body.temperature === "number" ? body.temperature : 0.7,
          maxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS ?? body.max_tokens ?? 2400),
          responseMimeType: body.response_format ? "application/json" : undefined
        }
      };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": runtime.apiKey
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`Google AI Studio request failed: ${response.status} ${text.slice(0, 180)}`);
  }

  return JSON.parse(text) as TextModelResponse;
}

async function callChatCompletionsApi(
  body: Record<string, unknown>,
  options: TextRuntimeOptions = {},
  providerOverride?: string
) {
  const runtime = resolveTextRuntime(options, providerOverride);
  if (!runtime.apiKey) throw new Error("Missing API key for text provider " + runtime.provider);
  if (!runtime.baseUrl) throw new Error("Missing base URL for text provider " + runtime.provider);

  const candidates = resolveTextModelCandidates(options, runtime.provider, runtime.model);
  const skipped: string[] = [];
  let lastError: unknown;

  for (const model of candidates) {
    const decision = await getModelQuotaDecision(runtime.provider, model);
    if (!decision.available) {
      skipped.push(decision.reason ?? `${model}: local quota guard skipped this candidate.`);
      continue;
    }
    try {
      const result = await postJsonWithFallback<TextModelResponse>({
        label: "Text model",
        urls: endpointCandidates(runtime.baseUrl, "chat/completions"),
        apiKey: runtime.apiKey,
        payload: {
          model,
          max_tokens: Number(process.env.TEXT_GENERATION_MAX_TOKENS ?? process.env.OPENAI_GENERATION_MAX_OUTPUT_TOKENS ?? 2400),
          ...body
        }
      });
      await recordModelSubmission(runtime.provider, model);
      return result;
    } catch (error) {
      lastError = error;
      const fallback = await handleTextModelFallbackError(runtime.provider, model, error);
      if (fallback.shouldContinue) {
        skipped.push(fallback.message);
        continue;
      }
      throw annotateTextFallbackError(error, skipped, model);
    }
  }

  throw new Error(buildAllTextModelsFailedMessage(runtime.provider, skipped, lastError));
}

async function postJsonWithFallback<T>({
  label,
  urls,
  apiKey,
  payload
}: {
  label: string;
  urls: string[];
  apiKey: string;
  payload: unknown;
}): Promise<T> {
  let lastStatus = 0;
  let lastText = "";

  for (const url of urls) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    lastStatus = response.status;
    lastText = await response.text().catch(() => "");
    if (response.ok) {
      try {
        return JSON.parse(lastText) as T;
      } catch {
        if (url !== urls[urls.length - 1]) continue;
      }
    }

    if (![404, 405].includes(response.status)) break;
  }

  throw new Error(`${label} request failed: ${lastStatus} ${lastText.slice(0, 180)}`);
}

async function callResponsesApi(body: Record<string, unknown>, options: TextRuntimeOptions = {}) {
  const runtime = resolveTextRuntime(options, "openai-upstream");
  if (!runtime.apiKey) throw new Error("Missing API key for OpenAI responses upstream");
  if (!runtime.baseUrl) throw new Error("Missing base URL for OpenAI responses upstream");

  const messages = (body.messages ?? []) as Array<{ role: string; content: string }>;

  return postJsonWithFallback<TextModelResponse>({
    label: "Responses model",
    urls: endpointCandidates(runtime.baseUrl, "responses"),
    apiKey: runtime.apiKey,
    payload: {
      model: runtime.model,
      input: messages.map((message) => ({
        role: message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user",
        content: [{ type: "input_text", text: message.content }]
      })),
      max_output_tokens: Number(process.env.OPENAI_GENERATION_MAX_OUTPUT_TOKENS ?? body.max_tokens ?? 2400),
      reasoning: { effort: process.env.OPENAI_REASONING_EFFORT || "medium" },
      store: process.env.OPENAI_DISABLE_RESPONSE_STORAGE === "true" ? false : undefined
    }
  });
}
function endpointCandidates(baseUrl: string, path: string) {
  const normalized = baseUrl.replace(/\/$/, "");
  if (normalized.endsWith("/v1")) return [`${normalized}/${path}`];
  return [`${normalized}/${path}`, `${normalized}/v1/${path}`];
}

function geminiEndpoint(baseUrl: string, path: string) {
  const normalized = baseUrl.replace(/\/$/, "");
  if (normalized.endsWith("/v1") || normalized.endsWith("/v1beta")) return `${normalized}/${path}`;
  return `${normalized}/v1beta/${path}`;
}

function geminiModelEndpoint(baseUrl: string, model: string, method: string) {
  const normalized = baseUrl.replace(/\/$/, "");
  const versioned = normalized.endsWith("/v1") || normalized.endsWith("/v1beta") ? normalized : `${normalized}/v1beta`;
  return `${versioned}/models/${model}:${method}`;
}

function getModelContent(data: TextModelResponse) {
  if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
  if (data.output_text) return data.output_text;
  const stepText =
    data.steps
      ?.flatMap((step) => step.content ?? [])
      .map((item) => item.text)
      .filter((text): text is string => Boolean(text)) ?? [];
  if (stepText.length) return stepText.join("\n");
  const textBlocks =
    data.output
      ?.flatMap((item) => item.content ?? [])
      .map((item) => item.text)
      .filter((text): text is string => Boolean(text)) ?? [];
  if (textBlocks.length) return textBlocks.join("\n");
  const candidateText =
    data.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text)
      .filter((text): text is string => Boolean(text)) ?? [];
  return candidateText.join("\n");
}

function buildPrompt(input: CreateProjectInput) {
  const targetShots = input.mode === "twenty_five_grid" ? 25 : input.mode === "director" ? 15 : 9;
  return [
    "请将用户输入改编为 AI 漫剧/短剧第一集生产数据。",
    "必须输出 JSON，顶层字段为 synopsis, script, characters, storyboards。",
    `storyboards 生成 ${targetShots} 条镜头。`,
    "characters 至少 2 个，最多 6 个，包含 name, identity, appearance, costume, personality, voice。",
    "每条 storyboard 必须包含 sceneNo, shotNo, duration, shotSize, cameraAngle, cameraMovement, characters, scene, pictureDesc, action, orientation, spatialRelation, dialogue, voiceOver, environmentSound, soundEffect, emotion, imagePrompt, videoPrompt。",
    "分镜规则：台词零删改；一镜一动作或一情绪变化；单镜 2-8 秒；长台词拆镜；角色不能无故消失；多人同框写清左右站位与朝向。",
    "导演增强规则：每镜必须能推导出焦距和 FOV；shotSize/cameraAngle/cameraMovement 使用生产词汇，例如 24mm广角建立、35mm跟拍、50mm中近景对白、85mm情绪近景、100mm道具微距。spatialRelation 必须写 screen-left/center/screen-right 和 foreground/midground/background。orientation 写清视线、身体朝向、180度轴线、首帧与尾帧连续性。",
    "画布工作流规则：分镜表要能自动汇总成 16:9 的 12 宫格黑白手绘电影故事板；每镜必须包含可标注的主体运动、摄影机运动、构图、灯光方向和情绪/声音重点，方便后续故事板整图生成。",
    "故事板矩阵规则：pictureDesc/action/cameraMovement/emotion 要足够具体，能够被压缩进 12 个连续节拍；避免静态站立镜头，优先设计可读动作、姿态变化、推拉摇移或剪辑衔接。",
    "Seedance 2.0 规则：每段不超过 15 秒；复杂动作拆段；videoPrompt 先写首帧锚点、镜头焦距/FOV、人物站位、主动作、声音、尾帧锚点和避免项。避免项必须包含不要生成对白字幕、标题字、解释字、水印、不要站位互换、不要越轴。",
    "导演草图规则：草图只描述视觉构图，不让图像模型生成长中文说明、镜头号、CAM 标签或表格；人物站位、机位、FOV、导演说明后续由 HTML/SVG 确定性生成。",
    "角色一致性规则：外貌、服装、配饰只在角色卡中稳定定义；分镜提示词主要写动作、情绪、空间关系和镜头；不要让同一角色换脸或换装，除非剧情明确要求。",
    "视频提示词规则：写清主体、场景、动作、运镜、台词/口型、音效；禁止字幕、水印、Logo；强调人物面部稳定、动作自然。",
    `作品名称：${input.title}`,
    `输入类型：${input.sourceType}`,
    `题材：${input.genre}`,
    `画幅：${input.videoRatio}`,
    `画风：${input.artStyle}`,
    `生成模式：${input.mode}`,
    `用户内容：${input.content || "用户只给了一个空白脑洞，请生成一个适合短剧第一集的故事。"}`
  ].join("\n");
}

export function buildScriptPrompt(input: CreateProjectInput) {
  const plan = createToonflowScriptPlan(input);
  if (input.sourceType === "script") return plan.prompt;

  const builtin = materializePrompt("novel_to_script", {
    content: input.content,
    episodes: input.targetEpisodes ?? 1,
    ratio: input.videoRatio,
    styleProfile: input.artStyle || "自动匹配"
  });
  return [
    builtin.systemPrompt,
    builtin.userPrompt,
    `输出校验：${builtin.validationRules.join("；")}`,
    `禁止事项：${builtin.negativeRules.join("；")}`,
    plan.prompt
  ].join("\n\n");
}

function buildStoryboardPrompt(input: CreateProjectInput, script: Pick<ScriptDraft, "synopsis" | "content">, characters: PipelineCharacter[]) {
  return createToonflowStoryboardPlan(input, script, characters).prompt;
}

export function normalizeScriptOutput(
  projectId: string,
  input: CreateProjectInput,
  output: Omit<PipelineOutput, "storyboards">,
  mode: "real" | "local"
): GeneratedProjectScriptContent {
  assertUsableScriptOutput(output, input.sourceType);
  const now = new Date().toISOString();
  const untitled = "\u672a\u547d\u540d\u4f5c\u54c1";
  const scriptSuffix = "\u7b2c\u4e00\u96c6\u5267\u672c";
  const script: ScriptDraft = {
    id: `script_${projectId}`,
    projectId,
    name: `${input.title || untitled} ${scriptSuffix}`,
    synopsis: safeText(output.synopsis, `${input.title || untitled} ${scriptSuffix}\u56f4\u7ed5\u4e3b\u89d2\u7684\u5173\u952e\u9009\u62e9\u5c55\u5f00\u3002`),
    content: safeText(output.script, input.sourceType === "script" ? input.content : buildFallbackScript(input)),
    version: 1,
    createdAt: now
  };

  const characters = ensureCharacters(output.characters).slice(0, 6).map<CharacterProfile>((character, index) => {
    const seed = stableSeed(projectId, character.name, index);
    return {
      id: `role_${projectId}_${index + 1}`,
      projectId,
      name: character.name,
      identity: character.identity,
      appearance: character.appearance,
      costume: character.costume,
      personality: character.personality,
      prompt: buildCharacterPrompt(character, input.artStyle),
      negativePrompt: "\u6362\u8138, \u540c\u6b3e\u5206\u8eab, \u4e94\u5b98\u6f02\u79fb, \u670d\u88c5\u4e0d\u4e00\u81f4, \u591a\u4f59\u624b\u6307, \u7578\u5f62\u624b, \u4f4e\u6e05\u6670\u5ea6, \u6c34\u5370, \u5b57\u5e55",
      voiceId: character.voice,
      seed,
      consistencyLevel: "high"
    };
  });

  const assets = characters.map<AssetItem>((character) => ({
    id: `asset_${character.id}`,
    projectId,
    type: "role",
    name: `${character.name} \u89d2\u8272\u53c2\u8003\u56fe`,
    description: `${character.identity}?${character.appearance}?${character.costume}`,
    prompt: character.prompt,
    status: "pending",
    relatedCharacterId: character.id
  }));

  const sceneAssets = extractSceneNames(script.content, input.genre).map<AssetItem>((scene, index) => ({
    id: `scene_${projectId}_${index + 1}`,
    projectId,
    type: "scene",
    name: scene,
    description: `${scene} 的基础场景资产，来源于已确认剧本，用于后续场景图与分镜保持空间一致。`,
    prompt: `${scene}, ${input.artStyle}, cinematic environment reference, clean composition, ${input.videoRatio}, no character, no text, no watermark`,
    status: "pending"
  }));

  return { mode, script, characters, assets: [...assets, ...sceneAssets] };
}

function normalizeOutput(
  projectId: string,
  input: CreateProjectInput,
  output: PipelineOutput,
  mode: "real" | "local"
): GeneratedProjectContent {
  const now = new Date().toISOString();
  const script: ScriptDraft = {
    id: `script_${projectId}`,
    projectId,
    name: `${input.title || "未命名作品"} 第一集剧本`,
    synopsis: safeText(output.synopsis, `${input.title} 第一集围绕主角的关键选择展开。`),
    content: safeText(output.script, buildFallbackScript(input)),
    version: 1,
    createdAt: now
  };

  const normalizedCharacters = ensureCharacters(output.characters);
  const characters = normalizedCharacters.slice(0, 6).map<CharacterProfile>((character, index) => {
    const seed = stableSeed(projectId, character.name, index);
    return {
      id: `role_${projectId}_${index + 1}`,
      projectId,
      name: character.name,
      identity: character.identity,
      appearance: character.appearance,
      costume: character.costume,
      personality: character.personality,
      prompt: buildCharacterPrompt(character, input.artStyle),
      negativePrompt: "换脸, 同款分身, 五官漂移, 服装不一致, 多余手指, 畸形手, 低清晰度, 水印, 字幕",
      voiceId: character.voice,
      seed,
      consistencyLevel: "high"
    };
  });

  const roleAssets = characters.map<AssetItem>((character) => ({
    id: `asset_${character.id}`,
    projectId,
    type: "role",
    name: `${character.name} 角色参考图`,
    description: `${character.identity}｜${character.appearance}｜${character.costume}`,
    prompt: character.prompt,
    status: "pending",
    relatedCharacterId: character.id
  }));

  const rawStoryboards = ensureStoryboards(output.storyboards, input);
  const sceneNames = Array.from(new Set(rawStoryboards.map((shot) => safeText(shot.scene, "主场景"))));
  const sceneAssets = sceneNames.map<AssetItem>((scene, index) => ({
    id: `scene_${projectId}_${index + 1}`,
    projectId,
    type: "scene",
    name: scene,
    description: `${scene} 的基础场景资产，用于分镜图和图生视频保持空间一致。`,
    prompt: `${scene}, ${input.artStyle}, clean composition, cinematic scene reference, ${input.videoRatio}`,
    status: "pending"
  }));

  const roleAssetByName = new Map(characters.map((character) => [character.name, `asset_${character.id}`]));
  const sceneAssetByName = new Map(sceneAssets.map((asset) => [asset.name, asset.id]));

  const storyboards = rawStoryboards.slice(0, totalShots(input)).map<StoryboardShot>((shot, index) => {
    const visibleCharacters = toTextArray(shot.characters, characters.slice(0, 2).map((item) => item.name));
    const scene = safeText(shot.scene, sceneNames[0] ?? "主场景");
    const referenceAssetIds = [
      ...visibleCharacters.map((name) => roleAssetByName.get(name)).filter((id): id is string => Boolean(id)),
      sceneAssetByName.get(scene)
    ].filter((id): id is string => Boolean(id));
    const pictureDesc = safeText(shot.pictureDesc, localPictureDesc(index, characters[0]?.name ?? "主角", characters[1]?.name ?? "对手", scene));
    const dialogue = safeText(shot.dialogue, "");
    const voiceOver = safeText(shot.voiceOver, "");

    return {
      id: `shot_${projectId}_${index + 1}`,
      projectId,
      episodeNo: Number(shot.episodeNo) || Math.floor(index / maxShots(input.mode)) + 1,
      sceneNo: Number(shot.sceneNo) || 1,
      shotNo: Number(shot.shotNo) || index + 1,
      duration: normalizeDuration(shot.duration, dialogue || voiceOver),
      shotSize: safeText(shot.shotSize, fallbackShotSize(index)),
      cameraAngle: safeText(shot.cameraAngle, "平视"),
      cameraMovement: safeText(shot.cameraMovement, fallbackMovement(index)),
      characters: visibleCharacters,
      scene,
      pictureDesc,
      dialogue,
      voiceOver,
      environmentSound: safeText(shot.environmentSound, "环境声"),
      soundEffect: safeText(shot.soundEffect, ""),
      imagePrompt: buildImagePrompt(shot, pictureDesc, input, visibleCharacters),
      videoPrompt: buildVideoPrompt(shot, pictureDesc, input, visibleCharacters),
      referenceAssetIds,
      status: "pending",
      action: safeText(shot.action, fallbackAction(index)),
      orientation: safeText(shot.orientation, buildOrientation(visibleCharacters)),
      spatialRelation: safeText(shot.spatialRelation, buildSpatialRelation(visibleCharacters)),
      emotion: safeText(shot.emotion, "情绪推进")
    };
  });

  return {
    mode,
    script,
    characters,
    assets: [...roleAssets, ...sceneAssets],
    storyboards
  };
}

function generateLocalOutput(input: CreateProjectInput): PipelineOutput {
  const base = input.content.trim() || `${input.title} 讲述主角在关键节点做出选择，改变命运。`;
  const hero = inferHeroName(base);
  const partner = inferPartnerName(base, hero);
  const scene = pickScene(input.genre, base);
  const conflict = pickConflict(input.genre, base);
  const targetShots = totalShots(input);
  const episodeBeats = buildEpisodeBeats(base, input.targetEpisodes ?? 1);

  return {
    synopsis: buildLocalSynopsis(base, hero, partner, scene, conflict, episodeBeats.length),
    script: buildLocalScript(hero, partner, scene, input.targetEpisodes ?? 1, episodeBeats),
    characters: [
      {
        name: hero,
        identity: "第一集主角",
        appearance: "清秀五官，眼神克制但坚定，面部轮廓柔和",
        costume: "浅绿色风衣，白色内搭，细链条耳饰",
        personality: "外柔内韧，经历打击后开始主动掌控命运",
        voice: "青年女声，清亮柔和，情绪克制"
      },
      {
        name: partner,
        identity: "关键关系角色",
        appearance: "眉眼深邃，气质沉稳，鼻梁挺拔",
        costume: "深灰长外套，黑色雨伞，银色腕表",
        personality: "克制敏锐，表面冷静，内心仍有保护欲",
        voice: "青年男声，低沉干净，语速偏慢"
      }
    ],
    storyboards: Array.from({ length: targetShots }).map((_, index) => buildLocalShot(index, hero, partner, scene, input))
  };
}

function buildLocalShot(index: number, hero: string, partner: string, scene: string, input: CreateProjectInput): PipelineStoryboard {
  const perEpisodeShots = maxShots(input.mode);
  const episodeNo = Math.floor(index / perEpisodeShots) + 1;
  const shotNo = (index % perEpisodeShots) + 1;
  const shotSize = ["远景", "中景", "特写", "近景", "中景", "过肩近景", "特写", "近景", "全景", "中景", "特写", "远景"][
    index % 12
  ];
  const dialogues = [
    "",
    `${hero}：你终于来了。`,
    "",
    `${partner}：跟我回去。`,
    `${hero}：这一次，我不会再退。`,
    "",
    `${partner}：那就告诉我，真相到底是什么？`,
    "",
    "",
    `${hero}：你很快就会知道。`,
    "",
    ""
  ];
  const episodeBeats = buildEpisodeBeats(input.content, input.targetEpisodes ?? 1);
  const episodeBeat = episodeBeats[episodeNo - 1] ?? episodeBeats[0];
  const pictureDesc = localPictureDesc(index, hero, partner, scene, episodeBeat);
  const visibleCharacters = index === 2 ? [hero] : index === 5 ? [partner] : [hero, partner];

  return {
    episodeNo,
    sceneNo: Math.floor((index % perEpisodeShots) / 3) + 1,
    shotNo,
    duration: normalizeDuration([4, 5, 3, 5, 6, 4, 6, 4, 5, 5, 3, 5][index % 12], dialogues[index % dialogues.length]),
    shotSize,
    cameraAngle: index % 3 === 0 ? "平视" : index % 3 === 1 ? "侧面" : "过肩视角",
    cameraMovement: fallbackMovement(index),
    characters: visibleCharacters,
    scene,
    pictureDesc,
    action: fallbackAction(index, episodeBeat),
    orientation: buildOrientation(visibleCharacters),
    spatialRelation: buildSpatialRelation(visibleCharacters),
    dialogue: dialogues[index % dialogues.length],
    voiceOver: index === 0 ? "雨声吞没了她上一世最后的悔意。" : "",
    environmentSound: scene.includes("雨") ? "雨声 + 远处车流声" : "环境低声 + 远处脚步声",
    soundEffect: index === 8 ? "远处脚步声突然逼近" : "",
    emotion: ["悬念", "重逢", "压抑", "试探", "反击", "克制", "逼问", "察觉", "危机升级"][index % 9],
    imagePrompt: `${pictureDesc}, ${input.artStyle}, ${shotSize}, ${input.videoRatio}, 角色外貌保持一致, no subtitle, no watermark`,
    videoPrompt: `${fallbackMovement(index)}，人物有轻微表情变化，动作自然连贯，保持角色面部和服装一致，无字幕无水印`
  };
}

function extractJson(content: string) {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) return content;
  return content.slice(start, end + 1);
}

function parseModelJson<T>(content: string, label: string): T {
  const raw = extractJson(content);
  const repaired = repairJsonText(raw);
  const balanced = balanceJsonText(repaired);
  const attempts = Array.from(new Set([raw, repaired, balanced]));

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt) as T;
    } catch {
      // Try the next normalized variant.
    }
  }

  const preview = raw.replace(/\s+/g, " ").slice(0, 240);
  throw new Error(`${label}返回的 JSON 无法解析，请降低温度或缩短输入后重试。片段：${preview}`);
}

function repairJsonText(value: string) {
  return value
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[\u0000-\u001F]+/g, " ")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
}

function balanceJsonText(value: string) {
  const chars: string[] = [];
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (const char of value) {
    if (inString) {
      chars.push(char);
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      chars.push(char);
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char === "{" ? "}" : "]");
      chars.push(char);
      continue;
    }
    if (char === "}" || char === "]") {
      if (stack.at(-1) === char) stack.pop();
      chars.push(char);
      continue;
    }
    chars.push(char);
  }

  if (inString) chars.push('"');
  while (stack.length) chars.push(stack.pop()!);
  return chars.join("").replace(/,\s*([}\]])/g, "$1").trim();
}

export function hasTextModelConfig(options: TextRuntimeOptions = {}) {
  const runtime = resolveTextRuntime(options);
  return Boolean(runtime.apiKey && runtime.baseUrl);
}

export function textModelName(options: Pick<CreateProjectInput, "textProvider" | "textModel"> = {}) {
  if (options.textModel) return options.textModel;
  const provider = options.textProvider || defaultTextProviderId();
  if (provider === "dashscope-text" || provider === "bailian-text") return process.env.DASHSCOPE_TEXT_MODEL || process.env.BAILIAN_TEXT_MODEL || "qwen3.7-plus";
  if (provider === "manjiao") return process.env.MANJIAO_TEXT_MODEL || "gpt-5.5";
  if (provider === "pipp") return process.env.PIPP_TEXT_MODEL || "deepseek-v4-pro";
  if (provider === "zml-text") return process.env.ZML_TEXT_MODEL || "gpt-5.5";
  if (provider === "doubao-text" || provider === "doubao") return process.env.DOUBAO_TEXT_MODEL || "doubao-seed-1-6-250615";
  if (provider === "google-ai-studio") return process.env.GEMINI_TEXT_MODEL || "gemini-3.1-pro-preview";
  if (provider === "openai-upstream") return process.env.OPENAI_TEXT_MODEL || "gpt-5.5";
  if (provider === "openai-compatible") return process.env.OPENAI_COMPATIBLE_MODEL || "openai-compatible";
  return process.env.DEEPSEEK_MODEL || "deepseek-v4-pro";
}

function runtimeTextModelName(options: Pick<CreateProjectInput, "textProvider" | "textModel"> = {}, providerOverride?: string) {
  const provider = providerOverride || options.textProvider || defaultTextProviderId();
  const selected = textModelName({ ...options, textProvider: provider });
  if (provider === "deepseek") return normalizeDeepSeekOfficialModel(selected);
  if (provider === "google-ai-studio") return normalizeGeminiTextModel(selected);
  return selected;
}

function normalizeDeepSeekOfficialModel(model: string) {
  const aliases: Record<string, string> = {
    "deepseek-v4-pro": process.env.DEEPSEEK_RUNTIME_MODEL || "deepseek-chat",
    "deepseek-v4-flash": process.env.DEEPSEEK_RUNTIME_MODEL || "deepseek-chat",
    "deepseek-v3": process.env.DEEPSEEK_RUNTIME_MODEL || "deepseek-chat"
  };
  return aliases[model] ?? model;
}

function normalizeGeminiTextModel(model: string) {
  const normalized = model.trim().toLowerCase().replace(/\s+/g, "-");
  const aliases: Record<string, string> = {
    "gemini-3.1pro": "gemini-3.1-pro-preview",
    "gemini-3.1-pro": "gemini-3.1-pro-preview",
    "gemini-3.1-pro-preview": "gemini-3.1-pro-preview",
    "gemini-3-pro": "gemini-3-pro-preview",
    "gemini-3-pro-preview": "gemini-3-pro-preview"
  };
  return aliases[normalized] ?? model;
}

export function textProviderName(options: Pick<CreateProjectInput, "textProvider"> = {}) {
  if (options.textProvider) return providerDisplayName(options.textProvider);
  return providerDisplayName(defaultTextProviderId());
}

function providerDisplayName(providerId: string) {
  const names: Record<string, string> = {
    "dashscope-text": "Alibaba Cloud Bailian / DashScope Text",
    "bailian-text": "Alibaba Cloud Bailian / DashScope Text",
    deepseek: "DeepSeek official",
    "zml-text": "ZML upstream relay",
    manjiao: "Manjiao relay",
    pipp: "Pipp relay",
    "doubao-text": "Doubao Ark text",
    "google-ai-studio": "Google AI Studio / Gemini",
    "openai-upstream": "OpenAI upstream relay",
    "openai-compatible": "OpenAI-compatible relay",
    qwen: "Qwen",
    doubao: "Doubao",
    "international-text": "International Text Router"
  };
  return names[providerId] ?? providerId;
}

export function shouldUseResponsesApi(options: Pick<CreateProjectInput, "textProvider"> = {}, resolvedProvider?: string) {
  const provider = options.textProvider || "";
  return resolvedProvider === "openai-upstream" || (provider === "openai-upstream") || (!provider && !resolvedProvider && process.env.OPENAI_TEXT_WIRE_API === "responses");
}

function defaultTextProviderId() {
  if (process.env.MANJIAO_TEXT_API_KEY) return "manjiao";
  if ((process.env.DASHSCOPE_TEXT_API_KEY || process.env.DASHSCOPE_API_KEY || process.env.BAILIAN_TEXT_API_KEY) && (process.env.DASHSCOPE_TEXT_BASE_URL || process.env.BAILIAN_TEXT_BASE_URL || process.env.OPENAI_COMPATIBLE_BASE_URL)) {
    return "dashscope-text";
  }
  if (process.env.DEEPSEEK_API_KEY) return "deepseek";
  if (process.env.ZML_API_KEY) return "zml-text";
  if (process.env.DOUBAO_TEXT_API_KEY || process.env.DOUBAO_API_KEY || process.env.ARK_API_KEY || process.env.VOLCENGINE_API_KEY) return "doubao-text";
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return "google-ai-studio";
  if (process.env.OPENAI_API_KEY) return "openai-upstream";
  if (process.env.OPENAI_COMPATIBLE_API_KEY) return "openai-compatible";
  return "deepseek";
}

function resolveTextRuntime(options: TextRuntimeOptions = {}, providerOverride?: string) {
  const provider = providerOverride || options.textProvider || defaultTextProviderId();
  const model = runtimeTextModelName(options, provider);

  if (provider === "dashscope-text" || provider === "bailian-text") {
    return {
      provider: "dashscope-text",
      apiKey: options.apiKey || process.env.DASHSCOPE_TEXT_API_KEY || process.env.DASHSCOPE_API_KEY || process.env.BAILIAN_TEXT_API_KEY,
      baseUrl:
        options.baseUrl ||
        process.env.DASHSCOPE_TEXT_BASE_URL ||
        process.env.BAILIAN_TEXT_BASE_URL ||
        process.env.OPENAI_COMPATIBLE_BASE_URL ||
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: options.textModel || process.env.DASHSCOPE_TEXT_MODEL || process.env.BAILIAN_TEXT_MODEL || model
    };
  }

  if (provider === "zml-text") {
    return {
      provider,
      apiKey: options.apiKey || process.env.ZML_API_KEY,
      baseUrl: options.baseUrl || process.env.ZML_BASE_URL || "https://api.zmlmfling.com",
      model: options.textModel || process.env.ZML_TEXT_MODEL || model
    };
  }

  if (provider === "manjiao") {
    return {
      provider,
      apiKey: options.apiKey || process.env.MANJIAO_TEXT_API_KEY,
      baseUrl: options.baseUrl || process.env.MANJIAO_BASE_URL || "https://api.zmlmfling.com",
      model: options.textModel || process.env.MANJIAO_TEXT_MODEL || model
    };
  }

  if (provider === "pipp") {
    return {
      provider,
      apiKey: options.apiKey || process.env.PIPP_TEXT_API_KEY,
      baseUrl: options.baseUrl || process.env.PIPP_TEXT_BASE_URL || "https://ripp.best",
      model: options.textModel || process.env.PIPP_TEXT_MODEL || "deepseek-v4-pro"
    };
  }

  if (provider === "doubao-text" || provider === "doubao") {
    return {
      provider: "doubao-text",
      apiKey: options.apiKey || process.env.DOUBAO_TEXT_API_KEY || process.env.DOUBAO_API_KEY || process.env.ARK_API_KEY || process.env.VOLCENGINE_API_KEY,
      baseUrl: options.baseUrl || process.env.DOUBAO_TEXT_BASE_URL || process.env.DOUBAO_BASE_URL || process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3",
      model: options.textModel || process.env.DOUBAO_TEXT_MODEL || model
    };
  }

  if (provider === "openai-upstream") {
    return {
      provider,
      apiKey: options.apiKey || process.env.OPENAI_API_KEY || process.env.OPENAI_COMPATIBLE_API_KEY,
      baseUrl: options.baseUrl || process.env.OPENAI_BASE_URL || process.env.OPENAI_COMPATIBLE_BASE_URL,
      model: options.textModel || process.env.OPENAI_TEXT_MODEL || model
    };
  }

  if (provider === "google-ai-studio") {
    return {
      provider,
      apiKey: options.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
      baseUrl: options.baseUrl || process.env.GEMINI_BASE_URL || process.env.GOOGLE_AI_STUDIO_BASE_URL || "https://generativelanguage.googleapis.com/v1beta",
      model: normalizeGeminiTextModel(options.textModel || process.env.GEMINI_TEXT_MODEL || "gemini-3.1-pro-preview")
    };
  }

  if (provider === "openai-compatible") {
    return {
      provider,
      apiKey: options.apiKey || process.env.OPENAI_COMPATIBLE_API_KEY || process.env.OPENAI_API_KEY,
      baseUrl: options.baseUrl || process.env.OPENAI_COMPATIBLE_BASE_URL || process.env.OPENAI_BASE_URL,
      model: options.textModel || process.env.OPENAI_COMPATIBLE_MODEL || model
    };
  }

  return {
    provider: "deepseek",
    apiKey: options.apiKey || process.env.DEEPSEEK_API_KEY,
    baseUrl: options.baseUrl || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    model
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function resolveTextModelCandidates(options: TextRuntimeOptions, provider: string, preferredModel: string) {
  const envPool =
    provider === "dashscope-text"
      ? process.env.DASHSCOPE_TEXT_MODEL_POOL || process.env.BAILIAN_TEXT_MODEL_POOL
      : provider === "manjiao"
        ? process.env.MANJIAO_TEXT_MODEL_POOL
      : provider === "pipp"
        ? process.env.PIPP_TEXT_MODEL_POOL
      : provider === "openai-compatible"
        ? process.env.OPENAI_COMPATIBLE_MODEL_POOL
        : provider === "doubao-text"
          ? process.env.DOUBAO_TEXT_MODEL_POOL
          : provider === "deepseek"
            ? process.env.DEEPSEEK_MODEL_POOL
            : provider === "openai-upstream"
              ? process.env.OPENAI_TEXT_MODEL_POOL
              : undefined;
  return uniqueStrings([preferredModel, ...(options.textModelPool ?? []), ...splitModelList(envPool)]);
}

async function handleTextModelFallbackError(provider: string, model: string, error: unknown) {
  const message = errorMessage(error);
  if (isTextDailyQuotaError(message)) {
    await blockModelUntilNextDay(provider, model, message);
    return { shouldContinue: true, message: `${model}: free quota exhausted, blocked until next day and switching. ${message}` };
  }
  if (isTextRateLimitError(message)) {
    await coolDownModel(provider, model, message, Number(process.env.TEXT_MODEL_RATE_LIMIT_COOLDOWN_MS ?? process.env.VIDEO_MODEL_RATE_LIMIT_COOLDOWN_MS ?? 120_000));
    return { shouldContinue: true, message: `${model}: hit rate/concurrency limits, cooling down and switching. ${message}` };
  }
  if (isTextModelUnavailableError(message)) {
    await coolDownModel(provider, model, message, Number(process.env.TEXT_MODEL_UNAVAILABLE_COOLDOWN_MS ?? 300_000));
    return { shouldContinue: true, message: `${model}: model unavailable or not authorized, skipping. ${message}` };
  }
  if (isTextTransientError(message)) {
    await coolDownModel(provider, model, message);
    return { shouldContinue: true, message: `${model}: transient upstream failure, switching to the next candidate. ${message}` };
  }
  return { shouldContinue: false, message };
}

function buildAllTextModelsFailedMessage(provider: string, skipped: string[], lastError: unknown) {
  const detail = skipped.length ? skipped.join(" | ") : errorMessage(lastError);
  return `${providerDisplayName(provider)} model pool has no available candidate. Details: ${detail}`;
}

function annotateTextFallbackError(error: unknown, skipped: string[], selectedModel: string) {
  if (!skipped.length) return error instanceof Error ? error : new Error(errorMessage(error));
  return new Error(`${errorMessage(error)} Model fallback trace: selected=${selectedModel}; skipped=${skipped.slice(0, 4).join(" | ")}`);
}

function splitModelList(value?: string) {
  return value?.split(/[,\n;]/).map((item) => item.trim()).filter(Boolean) ?? [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isTextDailyQuotaError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("allocationquota.freetieronly") ||
    lower.includes("freetieronly") ||
    lower.includes("free tier only") ||
    lower.includes("free trial quota") ||
    lower.includes("quota exceeded") ||
    lower.includes("insufficient_quota") ||
    lower.includes("daily quota") ||
    lower.includes("resource package")
  );
}

function isTextRateLimitError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("ratelimit") ||
    lower.includes("too many requests") ||
    lower.includes("rpm") ||
    lower.includes("tpm") ||
    lower.includes("qps") ||
    lower.includes("concurrency")
  );
}

function isTextModelUnavailableError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("model not found") ||
    lower.includes("endpoint not found") ||
    lower.includes("deployment not found") ||
    lower.includes("not authorized") ||
    lower.includes("no permission") ||
    lower.includes("access denied") ||
    lower.includes("invalid model")
  );
}

function isTextTransientError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("fetch failed") ||
    lower.includes("network") ||
    lower.includes("econn") ||
    lower.includes("503") ||
    lower.includes("502") ||
    lower.includes("500")
  );
}

function maxShots(mode: CreateProjectInput["mode"]) {
  if (mode === "twenty_five_grid") return 25;
  if (mode === "director") return 15;
  return 9;
}

function totalShots(input: CreateProjectInput) {
  return maxShots(input.mode) * Math.max(1, input.targetEpisodes ?? 1);
}

function safeText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function assertUsableScriptOutput(
  output: Partial<Pick<PipelineOutput, "synopsis" | "script" | "characters">>,
  sourceType: CreateProjectInput["sourceType"]
) {
  if (typeof output.script !== "string" || !output.script.trim()) {
    throw new Error(sourceType === "script" ? "剧本拆解失败：模型未返回剧本正文" : "小说转剧本失败：模型未返回转换后的剧本正文");
  }
  const validCharacters = Array.isArray(output.characters)
    ? output.characters.filter((item) => item && typeof item.name === "string" && item.name.trim())
    : [];
  if (!validCharacters.length) {
    throw new Error(sourceType === "script" ? "剧本拆解失败：未识别到有效角色" : "小说转剧本失败：未提取到有效角色");
  }
}

export function extractSceneNames(script: string, genre = "") {
  const explicit = script
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/^(?:第[一二三四五六七八九十百\d]+[场幕]|场景\s*[一二三四五六七八九十百\d]*|SCENE\s*\d*)[：:\s-]*(.+)$/i);
      if (!match?.[1]) return [];
      const name = match[1].split(/[，。；;|]/)[0]?.trim();
      return name ? [name.slice(0, 48)] : [];
    });
  const inline = Array.from(script.matchAll(/(?:地点|场景)[：:]\s*([^\n，。；;]{2,48})/g), (match) => match[1].trim());
  const names = Array.from(new Set([...explicit, ...inline])).filter(Boolean).slice(0, 12);
  return names.length ? names : [pickScene(genre, script)];
}

function ensureCharacters(characters?: PipelineCharacter[]) {
  if (Array.isArray(characters) && characters.length) return characters;
  return [
    {
      name: "林晚",
      identity: "主角",
      appearance: "清秀五官，眼神坚定",
      costume: "浅色风衣",
      personality: "外柔内韧"
    },
    {
      name: "顾沉",
      identity: "关键关系角色",
      appearance: "眉眼深邃，气质沉稳",
      costume: "深色外套",
      personality: "克制敏锐"
    }
  ];
}

function ensureStoryboards(storyboards: PipelineStoryboard[] | undefined, input: CreateProjectInput) {
  if (Array.isArray(storyboards) && storyboards.length) return storyboards;
  return generateLocalOutput(input).storyboards;
}

function toTextArray(value: unknown, fallback: string[]) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[、,，/|;]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return fallback.filter(Boolean);
}

function buildCharacterPrompt(character: PipelineCharacter, artStyle: string) {
  return [
    "创建一张艺术性的 16:9 角色身份板，纯白色或柔和米白色背景，无环境、无道具、无标志、无水印。",
    `角色：${character.name}；身份：${character.identity}；外貌：${character.appearance}；服装：${character.costume}；性格/表演气质：${character.personality}。`,
    `画风：${artStyle}。`,
    "不要创建标准角色参考表；创建电影感身份板，像高端动画工作室的角色研究与艺术书布局结合。",
    "布局不对称、优雅且视觉上令人难忘；使用大留白和有意的不平衡，避免网格、蓝图设计、目录布局和重复转场展示。",
    "放置一个大型英雄全身视角，略微偏离中心作为视觉锚点；周围加入中性全身、背面、侧面、坐姿、倾斜姿势、蹲姿、俯视、仰视和表情肖像研究。",
    "身份锁定：所有视角保持相同面部比例、发型轮廓、服装轮廓、身体比例、手部结构、姿势语言和视觉个性。",
    "加入小轮廓研究区、表情研究区和面部/头发/服装细节研究区；只使用少量手写风格标签：名称、角色、核心情绪、视觉标志。",
    "简约、电影感、高端、艺术书般、干净、富有表现力、适合后续图像和视频制作。"
  ].join(", ");
}

function buildImagePrompt(shot: PipelineStoryboard, pictureDesc: string, input: CreateProjectInput, characters: string[]) {
  return safeText(
    shot.imagePrompt,
    `单镜头首帧，不要分格；${pictureDesc}；出场角色：${characters.join("、") || "无"}；${input.artStyle}；${shot.shotSize || "中景"}；${shot.cameraAngle || "平视"}；${shot.cameraMovement || "轻微运动"}；角色脸型、发型、服装和身体比例保持角色身份板一致；无字幕，无水印`
  );
}

function buildVideoPrompt(shot: PipelineStoryboard, pictureDesc: string, input: CreateProjectInput, characters: string[]) {
  return safeText(
    shot.videoPrompt,
    [
      "Seedance 2.0 图生视频提示词。",
      `主体：${characters.join("、") || "场景"}；角色身份必须匹配角色身份板，不换脸、不换装、不改变身体比例。`,
      `首帧锚点：${pictureDesc}。`,
      `镜头：${shot.shotSize || "中景"}，${shot.cameraAngle || "平视"}，${shot.cameraMovement || "轻微推进"}；保持 screen-left/center/screen-right 和 180 度轴线稳定。`,
      `主动作：${shot.action || "轻微动作推进"}；情绪：${shot.emotion || "情绪推进"}；声音：${shot.environmentSound || shot.soundEffect || "环境声"}。`,
      `尾帧锚点：动作完成后保留清晰姿态，方便下一镜衔接；风格：${input.artStyle}。`,
      "避免项：不要生成对白字幕、标题字、解释字、水印、Logo，不要站位互换，不要越轴，不要九宫格视频。"
    ].join(" ")
  );
}

function normalizeDuration(duration: unknown, line: string) {
  const raw = Number(duration) || 4;
  const textSeconds = line ? Math.ceil(line.replace(/[^一-龥A-Za-z0-9]/g, "").length / 3) + 1 : raw;
  return Math.min(Math.max(raw, textSeconds, 2), 12);
}

function stableSeed(projectId: string, name: string, index: number) {
  const source = `${projectId}:${name}:${index}`;
  return source.split("").reduce((sum, char) => sum + char.charCodeAt(0), 12000) % 900000;
}

function buildFallbackScript(input: CreateProjectInput) {
  const base = input.content.trim() || `${input.title} 讲述主角在关键节点做出选择，改变命运。`;
  const hero = inferHeroName(base);
  const partner = inferPartnerName(base, hero);
  return buildLocalScript(hero, partner, pickScene(input.genre, base), input.targetEpisodes ?? 1, buildEpisodeBeats(base, input.targetEpisodes ?? 1));
}

function buildLocalSynopsis(base: string, hero: string, partner: string, scene: string, conflict: string, episodes: number) {
  const clean = compactStoryText(base);
  return `${hero}在${scene}${conflict}，与${partner}围绕核心事件形成推进关系。系统已基于原文拆成 ${episodes} 集预览：${clean.slice(0, 160)}${clean.length > 160 ? "..." : ""}`;
}

function buildEpisodeBeats(text: string, episodes = 1) {
  const clean = compactStoryText(text);
  const paragraphs = clean
    .split(/(?<=[。！？!?])|[\r\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const chunks = chunkTextByCount(paragraphs.length ? paragraphs : [clean || "主角在关键节点做出选择，改变命运。"], Math.max(1, episodes));
  return chunks.map((items, index) => {
    const body = items.join("");
    const hook = index === chunks.length - 1 ? "阶段真相浮出水面，留下下一轮生产的强画面。" : "结尾抛出新线索，推动下一集继续升级。";
    return {
      episodeNo: index + 1,
      body: body || `第${index + 1}集围绕主角选择展开。`,
      scene: inferSceneFromText(body),
      hook
    };
  });
}

function buildLocalScript(hero: string, partner: string, scene: string, episodes = 1, beats = buildEpisodeBeats("", episodes)) {
  return beats.slice(0, Math.max(1, episodes)).map((beat, index) => {
    const excerpt = beat.body || `${hero}与${partner}在${scene}围绕关键事件对峙。`;
    const shortExcerpt = excerpt.slice(0, 180);
    return [
      `第${index + 1}集 ${beat.scene || scene}`,
      `剧情节拍：${shortExcerpt}${excerpt.length > 180 ? "..." : ""}`,
      `场景动作：${hero}从当前事件中发现关键矛盾，${partner}以对立或保护的姿态介入。`,
      `${hero}：这件事不能再拖下去了。`,
      `${partner}：你确定要现在揭开？`,
      `${hero}：我已经没有退路。`,
      `旁白：${hero}意识到，真正的冲突不在眼前，而在被隐藏的旧线索里。`,
      `结尾钩子：${beat.hook}`
    ].join("\n");
  }).join("\n\n");
}

function inferHeroName(text: string) {
  const match = text.match(/([\u4e00-\u9fa5]{2,3})(?:重生|站在|回到|看着|决定)/);
  return match?.[1] ?? "林晚";
}

function inferPartnerName(text: string, hero: string) {
  const names = text.match(/[\u4e00-\u9fa5]{2,3}/g)?.filter((name) => name !== hero) ?? [];
  return names.find((name) => !["雨夜", "这一", "上一", "第一", "故事"].includes(name)) ?? "顾沉";
}

function pickScene(genre: string, text = "") {
  const inferred = inferSceneFromText(text);
  if (inferred !== "关键场景") return inferred;
  if (genre.includes("古")) return "宫墙雨廊";
  if (genre.includes("科幻")) return "城市天台";
  if (genre.includes("校园")) return "教学楼走廊";
  return "关键场景";
}

function pickConflict(genre: string, text = "") {
  if (text.includes("解") || text.includes("谜") || text.includes("秘密")) return "追查隐藏真相";
  if (genre.includes("复仇")) return "揭开陷害真相";
  if (genre.includes("甜")) return "修复误会";
  return "面对命运转折";
}

function fallbackShotSize(index: number) {
  return ["远景", "全景", "中景", "近景", "特写"][index % 5];
}

function fallbackMovement(index: number) {
  return ["固定镜头", "缓慢推进", "轻微横移", "拉远", "跟移"][index % 5];
}

function fallbackAction(index: number, beat?: { body: string }) {
  const core = beat?.body ? beat.body.slice(0, 32) : "";
  return [
    `(开篇)主角进入事件现场：${core}`,
    "(承接上镜)对方靠近，关系压力出现",
    "(承接上镜)主角发现一个可视化线索",
    "(承接上镜)两人对视，信息差被放大",
    "(承接上镜)主角主动推进冲突",
    "(承接上镜)对方察觉外部变化",
    "(承接上镜)关键线索被说出口",
    "(承接上镜)两人同时转向新危险",
    "(承接上镜)危机逼近，留下下一镜动作"
  ][index % 9];
}

function buildOrientation(characters: string[]) {
  if (!characters.length) return "空镜";
  if (characters.length === 1) return `${characters[0]}-3/4正面朝右`;
  return characters.map((name, index) => `${name}-${index % 2 === 0 ? "3/4正面朝右" : "3/4正面朝左"}`).join("；");
}

function buildSpatialRelation(characters: string[]) {
  if (!characters.length) return "空镜";
  const slots = ["左前", "右中", "中后", "右后"];
  return characters.map((name, index) => `${name}(${slots[index % slots.length]})`).join("、");
}

function localPictureDesc(index: number, hero: string, partner: string, scene: string, beat?: { body: string }) {
  const core = beat?.body ? beat.body.slice(0, 44) : "关键事件正在推进";
  const desc = [
    `${scene}中，${hero}独自站定，画面围绕“${core}”建立事件`,
    `${partner}靠近${hero}，两人保持明确左右站位，关系压力出现`,
    `特写${hero}手中或眼前的关键线索，突出原文事件的可视化证据`,
    `${partner}压低声音追问，眼神克制，背景保留${scene}空间信息`,
    `${hero}抬头迎上他的视线，情绪从犹豫转为主动`,
    `镜头从${partner}肩后看向${hero}，两人距离被压缩`,
    `${hero}说出关键线索，画面强化角色表情和道具关系`,
    `${partner}察觉远处异动，身体转向新的危险方向`,
    `两人同时看向画面深处，危机从${scene}延伸出来`,
    `${hero}向前半步，把线索交到${partner}面前`,
    `关键线索的细节被镜头放大，暗示下一集冲突`,
    `${scene}暂时安静下来，只保留事件余波和空间空镜`
  ];
  return desc[index % desc.length];
}

function compactStoryText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function chunkTextByCount(items: string[], count: number) {
  const chunks: string[][] = Array.from({ length: count }, () => []);
  items.forEach((item, index) => chunks[Math.min(count - 1, Math.floor(index * count / Math.max(1, items.length)))].push(item));
  return chunks;
}

function inferSceneFromText(text: string) {
  const sceneMatch = text.match(/(?:在|到|来到|回到|走进|进入)([\u4e00-\u9fa5]{2,8}(?:书店|学校|教室|走廊|医院|街口|天台|房间|大厅|宫殿|院子|小巷|公司|办公室|车站|雨夜|深夜|门口))/);
  return sceneMatch?.[1] ?? "关键场景";
}


