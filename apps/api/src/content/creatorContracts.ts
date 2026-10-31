import { z } from "zod";
import type { CreatorFinding, StoryFact } from "@aifilm/shared";
import { factConflict } from "./storyMemory.js";

export const briefSchema = z.object({
  format: z.literal("short"),
  intent: z.string().trim().min(2).max(3000),
  material: z.enum(["idea", "story", "script"]),
  durationSeconds: z.union([z.literal(30), z.literal(60)]),
  audience: z.string().trim().max(200).default("喜欢短故事的观众"),
  emotion: z.string().trim().max(200).default("由故事决定"),
  mustKeep: z.string().trim().max(2000).default(""),
  fidelity: z.enum(["faithful", "inspired"]).default("faithful")
}).strict();
export const creatorRunInput = z.object({
  requestId: z.string().uuid(), expectedRevision: z.number().int().positive(),
  maximumCredits: z.number().int().min(0).max(1000000), maxCalls: z.number().int().min(1).max(2).default(1),
  feedback: z.string().trim().max(2000).default(""), baseScriptId: z.string().max(160).optional()
}).strict();
export const creatorScriptSchema = z.object({
  title: z.string().trim().min(1).max(160),
  synopsis: z.string().trim().min(1).max(1200),
  script: z.string().trim().min(80).max(14000),
  estimatedSeconds: z.number().int().min(5).max(120),
  characters: z.array(z.object({
    name: z.string().trim().min(1).max(120), identity: z.string().max(800).default("unknown"),
    appearance: z.string().max(800).default("unknown"), costume: z.string().max(800).default("unknown"), personality: z.string().max(800).default("unknown")
  })).min(1).max(5),
  scenes: z.array(z.object({ location: z.string().min(1).max(120), description: z.string().max(1200), characters: z.array(z.string()).max(5).default([]) })).min(1).max(6),
  props: z.array(z.object({ name: z.string().max(120), description: z.string().max(800) })).max(12).default([]),
  factUpdates: z.array(z.object({ subject: z.string().max(120), predicate: z.string().max(120), value: z.string().max(1500),
    validFrom: z.number().int().positive().default(1), validTo: z.number().int().positive().nullable().default(null), knownBy: z.array(z.string()).max(30).default([]) })).max(30).default([])
});
export const creatorTools = {
  write_short_script: { version: "1.0.0", permission: "owner", prerequisite: "saved_brief", billable: true, output: "ScriptVersion", maxOutputTokens: 5000 },
  repair_short_script: { version: "1.0.0", permission: "owner", prerequisite: "observed_findings", billable: true, output: "ScriptVersion", maxOutputTokens: 5000 },
  check_short_script: { version: "1.0.0", permission: "owner", prerequisite: "model_response", billable: false, output: "CreatorFinding[]" },
  approve_short_script: { version: "1.0.0", permission: "author", prerequisite: "structure_pass", billable: false, output: "confirmed_script" }
} as const;
export function checkCreatorScript(raw: unknown, durationSeconds: number, facts: StoryFact[]) {
  const parsed = creatorScriptSchema.safeParse(raw);
  const findings: CreatorFinding[] = [];
  if (!parsed.success) {
    findings.push(...parsed.error.issues.slice(0, 12).map(issue => ({ code: `schema:${issue.path.join(".")}`, layer: "structure" as const, severity: "blocking" as const, message: issue.message, evidence: issue.path.join(".") })));
    return { script: null, findings };
  }
  const result = parsed.data;
  if (Math.abs(result.estimatedSeconds - durationSeconds) > durationSeconds * 0.2) findings.push({ code: "duration", layer: "structure", severity: "blocking", message: `剧本估时 ${result.estimatedSeconds} 秒与目标 ${durationSeconds} 秒偏差超过 20%。` });
  const names = new Set(result.characters.map(c => c.name));
  if (names.size !== result.characters.length) findings.push({ code: "duplicate_character", layer: "structure", severity: "blocking", message: "角色名称重复，请合并或区分同名人物。" });
  for (const scene of result.scenes) for (const name of scene.characters) if (!names.has(name)) findings.push({ code: "unknown_character", layer: "structure", severity: "blocking", message: `场景 ${scene.location} 引用了未登记角色 ${name}。` });
  for (const fact of result.factUpdates) {
    const conflict = facts.find(f => f.status === "locked" && factConflict(f, fact));
    if (conflict) findings.push({ code: "locked_fact_conflict", layer: "continuity", severity: "blocking", message: `${fact.subject}的${fact.predicate}与锁定设定不一致。`, evidence: `${conflict.id}：${conflict.value}` });
  }
  findings.push({ code: "author_review", layer: "author", severity: "warning", message: "规则检查只验证结构、估时和显式事实冲突；请核对原意、因果与人物知情范围后确认。" });
  return { script: result, findings };
}
