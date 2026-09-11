import crypto from "node:crypto";

type Entity = { name: string; description: string; identity?: string; appearance?: string; costume?: string; personality?: string };
export type HandoffEntities = { characters: Entity[]; scenes: Entity[]; props: Entity[] };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const nonSpeakers = /^(?:旁白|画外音|对白|台词|独白|场景\d*|地点|内景|外景|时间|人物|角色|动作|镜头|画面|音效|声音|音乐|字幕|转场|备注|剧情|标题|名称|Narrator|INT|EXT|VO|OS|SFX)$/i;

/** Extract only named entities present in saved source data; never create default people or places. */
export function collectHandoffEntities(input: { script: string; catalog?: unknown; outline?: unknown; episodes?: unknown[] }): HandoffEntities {
  const result: HandoffEntities = { characters: [], scenes: [], props: [] };
  function add(kind: keyof HandoffEntities, value: unknown, nameKeys = ["name"]) {
    const item = record(value);
    const name = (typeof value === "string" ? value : nameKeys.map((key) => text(item[key])).find(Boolean) || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!name || /^\d+$/.test(name) || (kind === "characters" && nonSpeakers.test(name))) return;
    if (result[kind].some((entry) => entry.name === name)) return;
    const fields = { identity: text(item.identity) || text(item.role), appearance: text(item.appearance), costume: text(item.costume), personality: text(item.personality) };
    result[kind].push({ name, description: text(item.description) || text(item.summary) || Object.values(fields).filter(Boolean).join("；") || `从已确认剧本识别：${name}`, ...fields });
  }
  for (const source of [record(input.catalog), record(input.outline), ...(input.episodes ?? []).map(record)]) {
    for (const kind of ["characters", "scenes", "props"] as const) {
      for (const item of list(source[kind])) add(kind, item, kind === "scenes" ? ["location", "name", "scene", "title"] : ["name", "character"]);
    }
    for (const cue of list(source.dialogue)) add("characters", cue, ["speaker", "character", "name", "role"]);
    for (const scene of list(source.scenes)) {
      for (const character of list(record(scene).characters)) add("characters", character);
    }
  }
  for (const line of input.script.split(/\r?\n/)) {
    const speaker = line.match(/^\s*(?:[-*]\s*)?([\p{L}\p{N}·]{1,20})(?:[（(][^）)]{0,40}[）)])?\s*[：:]\s*\S/u)?.[1];
    if (speaker) add("characters", speaker);
    const location = line.match(/^\s*(?:场景(?:\s*\d+)?|地点|内景|外景|INT\.?|EXT\.?)\s*[：:\s]\s*([^\n，。；]{2,60})/i)?.[1];
    if (location) add("scenes", location.replace(/\s*[-—·]\s*(?:日|夜|晨|黄昏).*$/, "").trim());
  }
  return result;
}

export function handoffEntityId(kind: string, projectId: string, name: string) {
  return `${kind}_${projectId}_${crypto.createHash("sha256").update(name).digest("hex").slice(0, 16)}`;
}
