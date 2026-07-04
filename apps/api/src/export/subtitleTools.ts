export interface SubtitleCue {
  index: number;
  start: number;
  end: number;
  text: string;
}

export function buildSrt(cues: SubtitleCue[]) {
  return normalizeCues(cues)
    .map((cue, index) => [String(index + 1), `${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}`, cue.text.trim(), ""].join("\n"))
    .join("\n");
}

export function parseSrt(input: string): SubtitleCue[] {
  return input
    .replace(/\ufeff/g, "")
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .flatMap((block, fallbackIndex) => {
      const lines = block.split(/\r?\n/);
      const timeLineIndex = lines.findIndex((line) => line.includes("-->"));
      if (timeLineIndex < 0) return [];
      const [startRaw, endRaw] = lines[timeLineIndex]!.split("-->").map((item) => item.trim());
      const start = parseSubtitleTime(startRaw);
      const end = parseSubtitleTime(endRaw);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
      return [{
        index: Number(lines[0]) || fallbackIndex + 1,
        start,
        end,
        text: lines.slice(timeLineIndex + 1).join("\n").trim()
      }];
    });
}

export function srtToWebVtt(input: string) {
  return `WEBVTT\n\n${parseSrt(input)
    .map((cue) => `${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}\n${cue.text}`)
    .join("\n\n")}\n`;
}

export function normalizeCues(cues: SubtitleCue[]) {
  return cues
    .filter((cue) => cue.text.trim() && cue.end > cue.start)
    .sort((a, b) => a.start - b.start)
    .map((cue, index, list) => ({
      ...cue,
      index: index + 1,
      start: Math.max(0, cue.start),
      end: Math.min(cue.end, list[index + 1]?.start ?? cue.end)
    }))
    .filter((cue) => cue.end > cue.start);
}

function parseSubtitleTime(value: string) {
  const match = value.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!match) return NaN;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4].padEnd(3, "0").slice(0, 3)) / 1000;
}

function formatSrtTime(totalSeconds: number) {
  return formatSubtitleTime(totalSeconds, ",");
}

function formatVttTime(totalSeconds: number) {
  return formatSubtitleTime(totalSeconds, ".");
}

function formatSubtitleTime(totalSeconds: number, separator: "," | ".") {
  const safe = Math.max(0, totalSeconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);
  const milliseconds = Math.round((safe - Math.floor(safe)) * 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${separator}${String(milliseconds).padStart(3, "0")}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
