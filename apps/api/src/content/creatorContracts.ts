import { z } from "zod";
import { estimateSpeechSeconds, type CreatorFinding, type StoryFact } from "@aifilm/shared";
import { factConflict } from "./storyMemory.js";

export const briefSchema = z.object({
  format: z.literal("short"),
  intent: z.string().trim().min(2).max(3000),
  material: z.enum(["idea", "story", "script"]),
  durationSeconds: z.union([z.literal(30), z.literal(60)]),
  audience: z.string().trim().max(200).default("喜欢短故事的观众"),
  emotion: z.string().trim().max(200).default("由故事决定"),
  mustKeep: z.string().trim().max(2000).default(""),
  fidelity: z.enum(["faithful", "inspired"]).default("faithful"),
  protagonistGoal: z.string().trim().max(500).optional(),
  obstacle: z.string().trim().max(500).optional(),
  ending: z.string().trim().max(500).optional(),
  productionLimits: z.string().trim().max(500).optional(),
  avoid: z.string().trim().max(500).optional()
}).strict();
export const creatorRunInput = z.object({
  requestId: z.string().uuid(), expectedRevision: z.number().int().positive(),
  maximumCredits: z.number().int().min(0).max(1000000), maxCalls: z.number().int().min(1).max(2).default(1),
  feedback: z.string().trim().max(2000).default(""), baseScriptId: z.string().max(160).optional()
}).strict();
export const storyDesignSchema = z.object({
  goal: z.string().trim().min(1).max(500), obstacle: z.string().trim().min(1).max(500),
  choice: z.string().trim().min(1).max(500), payoff: z.string().trim().min(1).max(500),
  beats: z.array(z.object({
    seconds: z.number().min(1).max(30), action: z.string().trim().min(1).max(500),
    evidence: z.string().trim().min(2).max(800), spokenText: z.string().max(1000)
  })).min(2).max(12, "节拍最多12项。请精简可改写的正文对白和重复动作，再同步节拍；不要继续拆出更多节拍。")
});
export const creatorScriptSchema = z.object({
  title: z.string().trim().min(1).max(160),
  synopsis: z.string().trim().min(1).max(1200),
  script: z.string().trim().min(80).max(14000),
  estimatedSeconds: z.number().int().min(5).max(120),
  storyDesign: storyDesignSchema.optional(),
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
export function checkCreatorScript(raw: unknown, durationSeconds: number, facts: StoryFact[], options: { requireDesign?: boolean; originalSpeechBudget?: boolean } = {}) {
  const parsed = creatorScriptSchema.safeParse(raw);
  const findings: CreatorFinding[] = [];
  if (!parsed.success) {
    findings.push(...parsed.error.issues.slice(0, 12).map(issue => ({ code: `schema:${issue.path.join(".")}`, layer: "structure" as const, severity: "blocking" as const, message: issue.message, evidence: issue.path.join(".") })));
    return { script: null, findings };
  }
  const result = parsed.data;
  const normalize = (value: string) => value.replace(/\s+/g, "");
  if (options.requireDesign && !result.storyDesign) findings.push({ code: "missing_story_design", layer: "craft", severity: "blocking", message: "缺少可复核的目标、阻碍、选择、结尾与节拍清单，请补齐后再审阅。" });
  if (result.storyDesign) {
    const duration = result.storyDesign.beats.reduce((sum, beat) => sum + beat.seconds, 0);
    if (Math.abs(duration - result.estimatedSeconds) > 2) findings.push({ code: "beat_duration", layer: "craft", severity: "blocking", message: `节拍合计 ${duration} 秒，与剧本估时 ${result.estimatedSeconds} 秒不一致。` });
    result.storyDesign.beats.forEach((beat, index) => {
      const evidence = normalize(beat.evidence), spoken = normalize(beat.spokenText);
      if (!normalize(result.script).includes(evidence) || spoken && !normalize(result.script).includes(spoken)) findings.push({
        code: `beat_evidence:${index}`, layer: "craft", severity: "blocking",
        message: `第 ${index + 1} 个节拍的依据或对白不在正文中，请引用正文连续原句。`, evidence: beat.evidence
      });
      const speech = estimateSpeechSeconds(beat.spokenText);
      if (speech > beat.seconds * 1.2) findings.push({ code: `speech_overflow:${index}`, layer: "craft", severity: "blocking",
        message: `第 ${index + 1} 个节拍对白约需 ${speech} 秒，已超过分配的 ${beat.seconds} 秒；请拆分或缩短允许改写的台词。`, evidence: beat.spokenText });
    });
  }
  if (Math.abs(result.estimatedSeconds - durationSeconds) > durationSeconds * 0.2) findings.push({ code: "duration", layer: "structure", severity: "blocking", message: `剧本估时 ${result.estimatedSeconds} 秒与目标 ${durationSeconds} 秒偏差超过 20%。` });
  const names = new Set(result.characters.map(c => c.name));
  if (names.size !== result.characters.length) findings.push({ code: "duplicate_character", layer: "structure", severity: "blocking", message: "角色名称重复，请合并或区分同名人物。" });
  for (const scene of result.scenes) for (const name of scene.characters) if (!names.has(name)) findings.push({ code: "unknown_character", layer: "structure", severity: "blocking", message: `场景 ${scene.location} 引用了未登记角色 ${name}。` });
  for (const fact of result.factUpdates) {
    const conflict = facts.find(f => f.status === "locked" && factConflict(f, fact));
    if (conflict) findings.push({ code: "locked_fact_conflict", layer: "continuity", severity: "blocking", message: `${fact.subject}的${fact.predicate}与锁定设定不一致。`, evidence: `${conflict.id}：${conflict.value}` });
  }
  const dialogue = result.script.split(/\r?\n/).filter(line => {
    const prefix = line.trim().match(/^([^：:（(]{1,120})(?:（[^）]*）|\([^)]*\))?[：:]/)?.[1]?.trim();
    return prefix && [...names, "旁白", "画外音"].includes(prefix);
  }).join("\n");
  const dialogueLines = dialogue.split("\n").map(line => line.replace(/^[^：:]+[：:]/, "").replace(/（[^）]*）|\([^)]*\)|【[^】]*】/g, "")).filter(line => line.trim());
  const speechSeconds = estimateSpeechSeconds(dialogueLines.join("\n"));
  if (options.originalSpeechBudget && speechSeconds > durationSeconds * 2 / 3) {
    findings.push({ code: "original_speech_budget", layer: "craft", severity: "blocking",
      message: `原创${durationSeconds}秒稿对白/旁白估需${speechSeconds}秒；请精简可改写的正文，使朗读不超过${Math.round(durationSeconds * 2 / 3)}秒，至少三分之一时间留给动作和停顿。保留主角目标、关键线索与结尾，不能仅改节拍或自报时长。` });
  }
  if (result.storyDesign && dialogue) {
    const spoken = (value: string) => value.replace(/（[^）]*）|\([^)]*\)|【[^】]*】/g, "").replace(/[\s，。！？；：、“”‘’,.!?;:"'（）()【】…—]/g, "");
    const mapped = spoken(result.storyDesign.beats.map(beat => beat.spokenText).join(""));
    const lines: string[] = [];
    for (const line of dialogue.split("\n")) {
      const text = line.replace(/^[^：:]+[：:]/, "").replace(/（[^）]*）|\([^)]*\)|【[^】]*】/g, "");
      lines.push(spoken(text));
      if (spoken(text) && !mapped.includes(spoken(text))) findings.push({ code: "unmapped_speech", layer: "craft", severity: "blocking",
        message: "正文有对白未计入节拍，请补全朗读时间，不能以省略台词缩短估时。", evidence: text });
    }
    if (mapped !== lines.join("")) findings.push({ code: "speech_alignment", layer: "craft", severity: "blocking",
      message: "节拍朗读文字须与正文全部对白、旁白按顺序一一对应；不能重复、漏句、颠倒或把动作当作台词。spokenText不含人物名前缀或表演说明。" });
  }
  if (speechSeconds > durationSeconds * 1.2) findings.push({ code: "script_speech_overflow", layer: "craft", severity: "blocking", message: "正文对白的保守朗读估时已超过成片目标，请拆分或精简；不能只修改自报时长。" });
  findings.push({ code: "author_review", layer: "author", severity: "warning", message: "请核对：关键线索是否真的呈现、人物是否有理由作出选择、结尾是否回应开头。节拍和朗读估时是辅助检查，不能证明因果合理、表演时长或作品好看。" });
  return { script: result, findings };
}
