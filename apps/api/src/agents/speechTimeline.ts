import { estimateSpeechSeconds, type ProjectWorkflow, type StoryboardShot } from "@aifilm/shared";

export interface SpeechCue {
  cueId: string;
  shotId: string;
  shotNo: string;
  speaker: string;
  text: string;
  emotion: string;
  start: number;
  end: number;
  duration: number;
  suggestedVoiceId?: string;
  audioRole: "dialogue" | "voice_over" | "silence";
}

const narratorNames = ["旁白", "画外音", "解说", "VO", "V.O."];
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const silentText = /^(?:无|无对白|无旁白|无台词|静默|静音|none|null|n\/a|[-—/])$/i;

function spokenText(raw: string) {
  let text = raw.trim();
  if (/^[“「"].*[”」"]$/s.test(text)) text = text.slice(1, -1).trim();
  // A leading parenthetical is a performance direction; parentheses inside speech stay intact.
  text = text.replace(/^(?:(?:（[^）]*）|\([^)]*\)|【[^】]*】)\s*)+/, "").trim();
  return silentText.test(text) ? "" : text;
}

export function splitSpeech(raw: string, names: string[], fallback: string) {
  const labels = [...new Set([...names, ...narratorNames])].sort((a, b) => b.length - a.length);
  // Legacy manuscripts with no character inventory may still contain explicit line-leading names.
  const alternatives = labels.map(escapeRegex).join("|") + (names.length ? "" : "|[\\u3400-\\u9fffA-Za-z0-9_]{1,16}");
  const regex = new RegExp(`(^|[\\r\\n]+|[；;。！？!?”」]\\s*|[ \\t]+)(${alternatives})\\s*(?:（[^）]*）|\\([^)]*\\))?\\s*[：:]`, "g");
  const matches = [...raw.matchAll(regex)];
  const result: Array<{ speaker: string; text: string }> = [];
  const push = (speaker: string, text: string) => {
    const clean = spokenText(text);
    if (clean) result.push({ speaker, text: clean });
  };
  if (!matches.length) push(fallback, raw);
  else {
    push(fallback, raw.slice(0, matches[0].index! + matches[0][1].length));
    matches.forEach((match, index) => {
      const next = matches[index + 1];
      push(match[2], raw.slice(match.index! + match[0].length, next ? next.index! + next[1].length : undefined));
    });
  }
  return result;
}

/** One timeline drives subtitles, voice routing, pricing and audio assembly. */
export function buildSpeechTimeline(workflow: ProjectWorkflow): SpeechCue[] {
  let cursor = 0;
  return workflow.storyboards.flatMap((shot: StoryboardShot) => {
    const duration = Math.max(0.2, Math.min(30, Number.isFinite(shot.duration) ? shot.duration : 3));
    const characters = workflow.characters ?? [];
    const shotCharacters = shot.characters ?? [];
    const names = [...new Set([...characters.map(character => character.name), ...shotCharacters])].filter(Boolean);
    const dialogue = splitSpeech(shot.dialogue || "", names, shotCharacters.length === 1 ? shotCharacters[0] : "对白")
      .map(cue => ({ ...cue, audioRole: narratorNames.includes(cue.speaker) ? "voice_over" as const : "dialogue" as const }));
    const narration = splitSpeech(shot.voiceOver || "", names, "旁白").map(cue => ({ ...cue, audioRole: "voice_over" as const }));
    const spoken = [...dialogue, ...narration];
    const items = spoken.length ? spoken : [{ speaker: "静音", text: "", audioRole: "silence" as const }];
    const weights = items.map(cue => Math.max(0.3, estimateSpeechSeconds(cue.text)));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const shotStart = cursor;
    let usedWeight = 0;
    return items.map((item, index) => {
      const start = cursor;
      usedWeight += weights[index];
      cursor = shotStart + (index === items.length - 1 ? duration : duration * usedWeight / totalWeight);
      const character = characters.find(character => character.name === item.speaker);
      return {
        ...item, cueId: `${shot.id}:${index + 1}`, shotId: shot.id,
        shotNo: `${shot.episodeNo}-${shot.sceneNo}-${shot.shotNo}`,
        emotion: shot.emotion || "平稳", start, end: cursor, duration: cursor - start,
        suggestedVoiceId: character?.voiceId
      };
    });
  });
}
