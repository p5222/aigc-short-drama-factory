import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { EvaluationStage, QualityReport } from "@aifilm/shared";
import { mediaContentHash } from "./mediaIdentity.js";
import { isHistoricalAssetId } from "../db/mediaAssetIdentity.js";

export const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const fingerprint = (value: unknown) => crypto.createHash("sha256").update(canonical(value)).digest("hex");
export const stages: EvaluationStage[] = ["script", "character", "storyboard", "image", "video"];
export const avg = (values: number[]) => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;

const projectSelect = {
  id: true, name: true, type: true, artStyle: true, videoRatio: true, episodes: true,
  scripts: { orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 1, select: { id: true, content: true, synopsis: true, version: true, promptSnapshot: true } },
  characterSet: { orderBy: { id: "asc" }, select: { id: true, name: true, identity: true, appearance: true, costume: true, personality: true, prompt: true, negativePrompt: true, referenceAssetId: true } },
  shots: { orderBy: [{ episodeNo: "asc" }, { sceneNo: "asc" }, { shotNo: "asc" }, { id: "asc" }], select: {
    id: true, episodeNo: true, sceneNo: true, shotNo: true, duration: true, shotSize: true, cameraAngle: true, cameraMovement: true,
    characters: true, scene: true, pictureDesc: true, action: true, dialogue: true, voiceOver: true, imagePrompt: true, videoPrompt: true,
    referenceAssetIds: true, firstFrameAssetId: true, lastFrameAssetId: true, status: true, promptVersion: true
  } },
  assets: { orderBy: { id: "asc" }, select: { id: true, type: true, name: true, prompt: true, status: true, referenceUrl: true, relatedCharacterId: true, updatedAt: true } }
} satisfies Prisma.ProjectSelect;

export async function captureSample(db: Prisma.TransactionClient, projectId: string, stage: EvaluationStage, datasetId?: string, userId?: string) {
  const project = await db.project.findFirst({ where: { id: projectId, ...(userId ? { userId } : {}) }, select: projectSelect });
  if (!project) throw new Error("样本项目不存在或无权访问。");
  const assets = project.assets.map(({ referenceUrl, updatedAt, ...asset }) => ({ ...asset, current: !isHistoricalAssetId(asset.id),
    sourceFingerprint: fingerprint(referenceUrl ?? ""), hasSource: !!referenceUrl, updatedAt: updatedAt.toISOString(), contentHash: undefined as string | undefined }));
  const mediaBudget = { remainingBytes: 512 * 1024 * 1024 };
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    if (asset.current && ["image", "video", "character"].includes(stage) && (asset.type === stage || (stage === "character" && asset.type.startsWith("role")))) {
      asset.contentHash = await mediaContentHash(project.assets[i].referenceUrl, mediaBudget);
    }
  }
  const snapshot = {
    protocol: 2, stage,
    project: { id: project.id, name: project.name, type: project.type, artStyle: project.artStyle, videoRatio: project.videoRatio, episodes: project.episodes },
    scripts: project.scripts.map(({ promptSnapshot, ...script }) => ({ ...script, generationEvidence: { snapshotHash: fingerprint(promptSnapshot), available: !!promptSnapshot && canonical(promptSnapshot) !== "{}" } })),
    characters: project.characterSet,
    shots: project.shots,
    assets,
    feedback: await db.userFeedback.findMany({ where: { projectId, stage }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { rating: true, usability: true, tags: true, content: true } }),
    coverage: { scriptVersions: "latest", characters: project.characterSet.length, shots: project.shots.length, assets: project.assets.length, originalInputAvailable: false }
  };
  if (Buffer.byteLength(canonical(snapshot)) > 2_000_000) throw new Error("样本超过 2 MB 上限，请拆分项目；未截断或保存不完整样本。");
  return db.evaluationSample.create({ data: {
    id: id("eval_sample"), datasetId, projectId, stage, sampleKey: `${projectId}:${stage}`, fingerprint: fingerprint(snapshot), snapshot: json(snapshot)
  } });
}
export type Snapshot = Awaited<ReturnType<typeof readSnapshot>>;
export function readSnapshot(value: unknown) {
  return value as {
    project: { id: string; name: string; episodes: number };
    scripts: Array<{ id: string; content: string; synopsis: string; generationEvidence: { snapshotHash: string; available: boolean } }>;
    characters: Array<{ id: string; name: string; identity: string; appearance: string; costume: string; personality: string; prompt: string; negativePrompt: string; referenceAssetId: string | null }>;
    shots: Array<{ id: string; episodeNo: number; sceneNo: number; shotNo: number; duration: number; scene: string; pictureDesc: string; imagePrompt: string; videoPrompt: string; referenceAssetIds: string[]; [key: string]: unknown }>;
    assets: Array<{ id: string; name: string; type: string; status: string; current?: boolean; hasSource: boolean; sourceFingerprint: string; contentHash?: string; updatedAt: string; [key: string]: unknown }>;
    coverage: Record<string, unknown>;
    feedback: Array<{ rating: number; usability: string; tags: string[]; content: string }>;
  };
}

export function structureReport(snapshot: Snapshot, stage: EvaluationStage): Omit<QualityReport, "id" | "createdAt" | "updatedAt"> {
  const checks: Array<{ key: string; ok: boolean; problem: string }> = [];
  const check = (key: string, ok: boolean, problem: string) => checks.push({ key, ok, problem });
  if (stage === "script") {
    check("contentPresent", !!snapshot.scripts[0]?.content.trim(), "尚无剧本文本。");
    check("synopsisPresent", !!snapshot.scripts[0]?.synopsis.trim(), "剧本梗概缺失。");
  } else if (stage === "character") {
    check("charactersPresent", snapshot.characters.length > 0, "尚无角色卡。");
    check("identityFields", snapshot.characters.length > 0 && snapshot.characters.every(c => !!c.name.trim() && !!c.identity.trim()), "角色姓名或身份字段缺失。");
    check("appearanceFields", snapshot.characters.length > 0 && snapshot.characters.every(c => !!c.appearance.trim() && !!c.costume.trim()), "角色外貌或服装字段缺失。");
    check("referenceLinks", snapshot.characters.every(c => !c.referenceAssetId || snapshot.assets.some(a => a.id === c.referenceAssetId && a.hasSource && a.status === "succeeded")), "角色引用的资产不存在或未就绪。");
  } else if (stage === "storyboard") {
    check("shotsPresent", snapshot.shots.length > 0, "尚无分镜。");
    const numbers = snapshot.shots.map(s => `${s.episodeNo}:${s.sceneNo}:${s.shotNo}`);
    check("uniqueShotNumbers", snapshot.shots.length > 0 && new Set(numbers).size === numbers.length && snapshot.shots.every(s => s.episodeNo > 0 && s.sceneNo > 0 && s.shotNo > 0), "镜头编号重复或无效。");
    check("requiredFields", snapshot.shots.length > 0 && snapshot.shots.every(s => !!s.scene.trim() && !!s.pictureDesc.trim() && !!s.imagePrompt.trim() && !!s.videoPrompt.trim()), "部分分镜缺场景、画面描述或生成提示词。");
    check("positiveDuration", snapshot.shots.length > 0 && snapshot.shots.every(s => s.duration > 0), "镜头时长缺失或无效。");
  } else {
    const assets = snapshot.assets.filter(a => a.type === stage && a.current !== false);
    check("assetsPresent", assets.length > 0, "所选阶段暂无资产。");
    check("sourcesPresent", assets.length > 0 && assets.every(a => a.hasSource), "部分资产没有来源地址。");
    check("successfulStatus", assets.length > 0 && assets.every(a => a.status === "succeeded"), "部分资产未生成成功。");
    // Deliberately no coverage claim from raw asset counts: versions can duplicate a shot.
  }
  const totalScore = avg(checks.map(c => c.ok ? 100 : 0));
  return { projectId: snapshot.project.id, stage, evaluatorType: "system", evidenceScope: "structure", totalScore, pass: checks.every(c => c.ok),
    dimensionScores: Object.fromEntries(checks.map(c => [c.key, c.ok ? 100 : 0])),
    problems: checks.filter(c => !c.ok).map(c => c.problem),
    suggestions: ["结构检查仅核对字段与资产状态；文本质量、画面一致性和真实播放效果需分别复核。"],
    recommendedAction: checks.every(c => c.ok) ? "manual_review" : "complete_fields", promptVersion: "structure-v2" };
}

export const textDimensions = ["coherence", "specificity", "productionReadiness"] as const;
export function parseJudge(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("评审响应必须为对象。");
  const data = value as Record<string, unknown>;
  const score = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100;
  if (!score(data.totalScore)) throw new Error("总分缺失、越界或不是整数。");
  const dims = data.dimensionScores;
  if (!dims || typeof dims !== "object" || Array.isArray(dims) || Object.keys(dims).length !== textDimensions.length || !textDimensions.every(k => score((dims as Record<string, unknown>)[k]))) throw new Error("评分维度不符合文本评审契约。");
  const strings = (v: unknown) => Array.isArray(v) && v.length <= 20 && v.every(s => typeof s === "string" && s.length <= 1000);
  if (!strings(data.mainProblems) || !strings(data.suggestedFixes) || typeof data.criticalFailure !== "boolean") throw new Error("问题、建议或关键失败标记不符合契约。");
  const totalScore = data.totalScore as number;
  return { totalScore, dimensionScores: dims as Record<string, number>, problems: data.mainProblems as string[], suggestions: data.suggestedFixes as string[],
    pass: totalScore >= 75 && !data.criticalFailure, recommendedAction: totalScore >= 75 && !data.criticalFailure ? "manual_review" : "revise_text" };
}

export function textPayload(snapshot: Snapshot, stage: EvaluationStage, maxShots: number) {
  const full = stage === "script" ? snapshot.scripts : stage === "character" ? snapshot.characters : snapshot.shots.slice(0, maxShots);
  const text = canonical(full);
  if (text.length > 32_000) throw new Error("本次文本超过 32000 字符上限，请拆分样本；未静默截断。");
  return { text, coverage: { characters: text.length, items: full.length, totalItems: stage === "script" ? snapshot.scripts.length : stage === "character" ? snapshot.characters.length : snapshot.shots.length, maxShots } };
}
