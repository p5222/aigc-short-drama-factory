import { z } from "zod";

const numberValue = z.coerce.number();
const evidenceSchema = z.object({
  mode: z.enum(["model_search", "model_prior", "user_material"]).catch("model_prior").default("model_prior"),
  asOf: z.coerce.string().optional(),
  sources: z.array(z.object({
    title: z.coerce.string().catch(""),
    url: z.string().nullable().optional(),
    platform: z.coerce.string().nullable().optional(),
    verified: z.coerce.boolean().catch(false).default(false)
  }).passthrough()).catch([]).default([]),
  limitations: z.array(z.coerce.string()).catch([]).default([]),
  confidence: numberValue.catch(0.5).transform((value) => Math.max(0, Math.min(1, value))).default(0.5)
}).passthrough().catch({ mode: "model_prior", sources: [], limitations: ["基于模型知识，非实时榜单"], confidence: 0.5 });

const analysisSchema = z.object({
  evidence: evidenceSchema.default({ mode: "model_prior", sources: [], limitations: ["基于模型知识，非实时榜单"], confidence: 0.5 }),
  works: z.array(z.unknown()).catch([]).default([]),
  dimensions: z.object({
    opening: z.unknown().optional(),
    climax: z.unknown().optional(),
    reversal: z.unknown().optional(),
    payoffs: z.unknown().optional()
  }).passthrough().catch({}),
  commonMechanisms: z.array(z.unknown()).catch([]).default([]),
  transferableRules: z.array(z.unknown()).catch([]).default([]),
  risks: z.array(z.unknown()).catch([]).default([])
}).passthrough();

const outlineChapterSchema = z.object({
  chapterNo: z.coerce.number().int().positive(),
  title: z.coerce.string().min(1),
  objective: z.coerce.string().min(1),
  conflict: z.coerce.string().min(1),
  turn: z.coerce.string().catch("").default(""),
  cliffhanger: z.coerce.string().min(1),
  targetWords: z.coerce.number().int().positive().optional()
}).passthrough();

const outlineSchema = z.object({
  title: z.coerce.string().min(1),
  premise: z.coerce.string().min(1),
  characters: z.array(z.unknown()).catch([]).default([]),
  chapters: z.array(outlineChapterSchema).min(1),
  originality: z.unknown().optional()
}).passthrough();

const creatorTextKeys = ["summary", "structuralRole", "usablePattern", "recommendedBeat", "goal", "description", "content", "value"];
const hiddenModelKeys = new Set(["workId", "evidenceType", "chapterRange", "avoidCopying"]);

export function summarizeModelValue(value: unknown): string {
  const parts: string[] = [];
  const visit = (current: unknown, depth: number) => {
    if (parts.length >= 5 || depth > 5 || current == null) return;
    if (typeof current === "string") {
      const text = current.replace(/\s+/g, " ").trim();
      if (text && !parts.includes(text)) parts.push(text);
      return;
    }
    if (typeof current === "number" || typeof current === "boolean") return;
    if (Array.isArray(current)) {
      current.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (typeof current !== "object") return;
    const record = current as Record<string, unknown>;
    for (const key of creatorTextKeys) if (key in record) visit(record[key], depth + 1);
    for (const [key, item] of Object.entries(record)) {
      if (!creatorTextKeys.includes(key) && !hiddenModelKeys.has(key)) visit(item, depth + 1);
    }
  };
  visit(value, 0);
  return parts.join("；").slice(0, 900);
}

export function normalizeDevelopmentAnalysis(raw: unknown) {
  const parsed = analysisSchema.parse(raw);
  return {
    evidence: parsed.evidence,
    works: parsed.works,
    dimensions: {
      opening: summarizeModelValue(parsed.dimensions.opening),
      climax: summarizeModelValue(parsed.dimensions.climax),
      reversal: summarizeModelValue(parsed.dimensions.reversal),
      payoffs: summarizeModelValue(parsed.dimensions.payoffs)
    },
    commonMechanisms: parsed.commonMechanisms,
    transferableRules: parsed.transferableRules,
    risks: parsed.risks
  };
}

export function normalizeDevelopmentOutline(raw: unknown) {
  return outlineSchema.parse(raw);
}
