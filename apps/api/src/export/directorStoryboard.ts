import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ProjectWorkflow, StoryboardShot } from "@aifilm/shared";
import { persistTextReference, storageRoot } from "../storage/objectStorage.js";

export interface DirectorStoryboardRow {
  id: string;
  shotId: string;
  shotNo: string;
  duration: number;
  lens: string;
  fov: number;
  shotSize: string;
  cameraAngle: string;
  cameraMovement: string;
  sketchPrompt: string;
  directorNotes: string[];
  blockingNotes: string[];
  seedancePrompt: string;
  blockingSvg: string;
}

export interface DirectorStoryboardPackage {
  title: string;
  htmlUrl: string;
  markdownUrl: string;
  rows: DirectorStoryboardRow[];
  stats: {
    shots: number;
    duration: number;
    avgShotDuration: number;
  };
}

export async function createDirectorStoryboardPackage(workflow: ProjectWorkflow): Promise<DirectorStoryboardPackage> {
  const rows = workflow.storyboards.map((shot, index) => buildDirectorStoryboardRow(workflow, shot, index));
  const title = `${workflow.project.name} 导演分镜表`;
  const session = `director-storyboard-${safeSegment(workflow.project.id)}-${Date.now()}`;
  const dir = resolve(storageRoot, "exports", session);
  await mkdir(dir, { recursive: true });
  const html = renderDirectorStoryboardHtml(workflow, rows);
  const markdown = renderDirectorStoryboardMarkdown(workflow, rows);
  await writeFile(resolve(dir, "director-storyboard.html"), html, "utf8");
  await writeFile(resolve(dir, "director-storyboard.md"), markdown, "utf8");
  return {
    title,
    htmlUrl: `/storage/exports/${session}/director-storyboard.html`,
    markdownUrl: `/storage/exports/${session}/director-storyboard.md`,
    rows,
    stats: {
      shots: rows.length,
      duration: rows.reduce((sum, row) => sum + row.duration, 0),
      avgShotDuration: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.duration, 0) / rows.length * 10) / 10 : 0
    }
  };
}

export async function persistDirectorPromptGuide() {
  return persistTextReference(DIRECTOR_PROMPT_GUIDE, "director-prompt-guide", "exports", "md");
}

export function buildDirectorStoryboardRow(workflow: ProjectWorkflow, shot: StoryboardShot, index: number): DirectorStoryboardRow {
  const lens = inferLens(shot);
  const fov = lensToFov(lens);
  const shotNo = `${shot.episodeNo}-${shot.sceneNo}-${shot.shotNo}`;
  const characters = shot.characters.length ? shot.characters : ["主体"];
  const blocking = buildBlocking(shot, characters, index);
  const directorNotes = [
    `设备/镜头：Cooke S7/i ${lens}，${shot.cameraAngle || "平视"}，${shot.shotSize || "中景"}，FOV 约 ${fov}°。`,
    `站位调度：${blocking.description}`,
    `画面执行：${shot.pictureDesc}；动作只保留一个主节拍：${shot.action || shot.emotion || "情绪推进"}。`,
    `连续性：首帧锁定 ${blocking.firstAnchor}；尾帧锁定 ${blocking.lastAnchor}。`
  ];
  const blockingNotes = [
    `CAM 位于 ${blocking.cameraLabel}，镜头方向保持 ${blocking.axisLabel}。`,
    `人物关系：${blocking.description}`,
    `FOV：${fov}°，避免越轴、站位互换、服装发型漂移。`
  ];
  return {
    id: `DS-${String(index + 1).padStart(2, "0")}`,
    shotId: shot.id,
    shotNo,
    duration: shot.duration,
    lens,
    fov,
    shotSize: shot.shotSize,
    cameraAngle: shot.cameraAngle,
    cameraMovement: shot.cameraMovement,
    sketchPrompt: buildSketchPrompt(workflow, shot, lens, fov),
    directorNotes,
    blockingNotes,
    seedancePrompt: buildEnhancedSeedancePrompt(workflow, shot, lens, fov, blocking),
    blockingSvg: renderBlockingSvg(shot, characters, blocking, fov)
  };
}

function buildSketchPrompt(workflow: ProjectWorkflow, shot: StoryboardShot, lens: string, fov: number) {
  return [
    `Rough grayscale director storyboard sketch, ${workflow.project.videoRatio} frame.`,
    `${shot.shotSize}, ${shot.cameraAngle}, ${lens}, FOV ${fov} degrees.`,
    `Characters: ${shot.characters.join(", ") || "scene subject"}.`,
    `Scene: ${shot.scene}. Action: ${shot.pictureDesc}.`,
    `Mood: ${shot.emotion || "dramatic continuity"}.`,
    "Black-and-white pencil storyboard, clean composition, no subtitles, no speech bubbles, no title text, no watermark.",
    "4K ultra-high-definition, clean and noise-free, stable composition, sharp and well-defined subject."
  ].join(" ");
}

function buildEnhancedSeedancePrompt(workflow: ProjectWorkflow, shot: StoryboardShot, lens: string, fov: number, blocking: ReturnType<typeof buildBlocking>) {
  return [
    `使用已锁定角色参考和场景参考生成 ${workflow.project.videoRatio} 视频段。`,
    `首帧锚点：${blocking.firstAnchor}`,
    `镜头：${shot.shotSize} / ${shot.cameraAngle} / ${lens} / FOV ${fov}° / ${shot.cameraMovement}。`,
    `画面：${shot.pictureDesc}`,
    `站位：${blocking.description}`,
    `主动作：${shot.action || "轻微表演动作"}；情绪：${shot.emotion || "情绪推进"}。`,
    shot.dialogue ? `对白作为角色语音出现：${shot.dialogue}` : "",
    shot.voiceOver ? `旁白作为画外音出现：${shot.voiceOver}` : "",
    [shot.environmentSound, shot.soundEffect].filter(Boolean).length ? `声音：${[shot.environmentSound, shot.soundEffect].filter(Boolean).join("；")}` : "",
    `尾帧锚点：${blocking.lastAnchor}`,
    "避免项：固定避免项：不要生成对白字幕、标题字、解释字、旁白字卡、水印；对白只作为角色语音出现；已指定的道具文字可以保留。本段特殊避免项：不要交换人物站位；不要改变服装发型；不要越轴；不要增加额外人物。"
  ].filter(Boolean).join("\n");
}

function buildBlocking(shot: StoryboardShot, characters: string[], index: number) {
  const left = characters[0] || "主体";
  const right = characters[1] || (characters.length > 1 ? characters[1] : "环境锚点");
  const center = characters.length > 2 ? characters[2] : left;
  const axisLabel = index % 2 === 0 ? "screen-left -> screen-right" : "screen-right -> screen-left";
  const cameraLabel = shot.cameraAngle.includes("俯") ? "高位俯拍" : shot.cameraAngle.includes("低") ? "低位仰拍" : "正前方偏左";
  const description = characters.length > 1
    ? `${left} 位于 screen-left foreground，${right} 位于 screen-right midground，${center} 保持中心视觉锚点，视线沿 ${axisLabel}。`
    : `${left} 位于 center midground，重要道具/场景锚点放在 background，视线和动作沿 ${axisLabel}。`;
  return {
    left,
    right,
    center,
    axisLabel,
    cameraLabel,
    description,
    firstAnchor: `${left} 在 ${characters.length > 1 ? "画面左前景" : "画面中心"}，身体朝向镜头轴线，场景为 ${shot.scene}`,
    lastAnchor: `${left} 保持同一服装和发型，动作结束在 ${shot.cameraMovement || "稳定构图"} 的末端`
  };
}

function inferLens(shot: StoryboardShot) {
  const text = `${shot.shotSize} ${shot.cameraAngle} ${shot.pictureDesc}`;
  if (/特写|微距|手|眼|道具|手机|戒指|机关|剑柄/.test(text)) return /微距|道具|手/.test(text) ? "100mm" : "85mm";
  if (/近景|中近景|对话|表情|反应/.test(text)) return "50mm";
  if (/全景|远景|建立|空间|人群/.test(text)) return "24mm";
  if (/移动|跟拍|走|进入|离开/.test(text)) return "35mm";
  return "50mm";
}

function lensToFov(lens: string) {
  const value = Number(lens.replace(/[^\d.]/g, ""));
  if (value <= 24) return 74;
  if (value <= 35) return 54;
  if (value <= 50) return 40;
  if (value <= 85) return 24;
  return 20;
}

function renderBlockingSvg(shot: StoryboardShot, characters: string[], blocking: ReturnType<typeof buildBlocking>, fov: number) {
  const leftLabel = escapeXml(characters[0] || "主体");
  const rightLabel = escapeXml(characters[1] || "环境");
  const centerLabel = escapeXml(characters[2] || "道具/锚点");
  const fovWidth = Math.max(34, Math.min(96, fov * 1.15));
  return `<svg viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="人物站位机位FOV">
  <rect x="8" y="8" width="304" height="204" rx="10" fill="#fbf8ef" stroke="#d8cfbd"/>
  <rect x="76" y="24" width="168" height="30" rx="6" fill="#efe7d5" stroke="#d8cfbd"/>
  <text x="160" y="43" text-anchor="middle" font-size="12" fill="#574b36">${escapeXml(shot.scene)}</text>
  <path d="M160 184 L${160 - fovWidth} 68 Q160 88 ${160 + fovWidth} 68 Z" fill="#bae6fd" opacity="0.42" stroke="#38bdf8"/>
  <circle cx="160" cy="184" r="17" fill="#f59e0b" stroke="#92400e"/>
  <text x="160" y="188" text-anchor="middle" font-size="11" font-weight="700" fill="#111827">CAM</text>
  <path d="M160 165 L160 74" stroke="#2563eb" stroke-width="4" marker-end="url(#arrow)"/>
  <circle cx="82" cy="116" r="20" fill="#d1d5db" stroke="#6b7280"/>
  <text x="82" y="151" text-anchor="middle" font-size="12" fill="#1f2937">${leftLabel}</text>
  <circle cx="238" cy="116" r="20" fill="#d1d5db" stroke="#6b7280"/>
  <text x="238" y="151" text-anchor="middle" font-size="12" fill="#1f2937">${rightLabel}</text>
  <circle cx="160" cy="82" r="16" fill="#fde68a" stroke="#b45309"/>
  <text x="160" y="112" text-anchor="middle" font-size="12" fill="#1f2937">${centerLabel}</text>
  <text x="160" y="206" text-anchor="middle" font-size="11" fill="#0f172a">${escapeXml(blocking.axisLabel)} · FOV ${fov}°</text>
  <defs><marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#2563eb"/></marker></defs>
</svg>`;
}

function renderDirectorStoryboardHtml(workflow: ProjectWorkflow, rows: DirectorStoryboardRow[]) {
  const duration = rows.reduce((sum, row) => sum + row.duration, 0);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escapeHtml(workflow.project.name)} 导演分镜表</title><style>
body{margin:0;background:#eee9dd;color:#1f2937;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}.page{max-width:1560px;margin:0 auto;padding:24px}.hero{display:grid;grid-template-columns:1fr auto;gap:20px;align-items:end;padding:20px 22px;border:1px solid #d8cfbd;background:#fbf8ef;border-radius:12px}.hero h1{margin:0 0 8px;font-size:30px}.meta{display:flex;gap:10px;flex-wrap:wrap}.meta span{padding:6px 10px;border:1px solid #d8cfbd;border-radius:999px;background:#fffaf0;font-size:13px}.row{display:grid;grid-template-columns:38% 34% 28%;gap:14px;margin-top:14px;padding:14px;border:1px solid #d8cfbd;background:#fffdf7;border-radius:12px}.sketch{min-height:260px;border:1px solid #d8cfbd;background:linear-gradient(135deg,#f8fafc,#e7e5df);display:grid;place-items:center;border-radius:8px;overflow:hidden}.sketch svg{width:100%;height:100%}.notes,.blocking{display:grid;gap:10px}.shot-head{grid-column:1/-1;display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #e6ddcc;padding-bottom:8px;font-weight:800}.pill{font-size:12px;color:#6b4f1d}.card{border:1px solid #eadfca;background:#fffaf0;border-radius:8px;padding:10px}.card h3{margin:0 0 8px;font-size:14px}.card p,.card li{font-size:13px;line-height:1.55}.prompt{white-space:pre-wrap;font-size:12px;color:#334155;max-height:150px;overflow:auto}.blocking svg{width:100%;height:auto}.footer{margin:20px 0;color:#6b7280;font-size:13px}</style></head><body><main class="page">
<section class="hero"><div><h1>${escapeHtml(workflow.project.name)} · 导演分镜表</h1><p>左侧草图 brief，中间导演执行说明，右侧人物站位 + CAM + FOV。所有文字和站位图由确定性 HTML/SVG 生成。</p><div class="meta"><span>${workflow.project.videoRatio}</span><span>${workflow.project.artStyle}</span><span>${rows.length} 镜</span><span>${duration}s</span></div></div><strong>Seedance 2.0 Ready</strong></section>
${rows.map((row) => `<section class="row"><div class="shot-head"><span>${escapeHtml(row.shotNo)} · ${escapeHtml(row.shotSize)} · ${escapeHtml(row.cameraAngle)}</span><span class="pill">${escapeHtml(row.lens)} / FOV ${row.fov}° / ${row.duration}s</span></div><div class="sketch">${renderSketchPlaceholder(row)}</div><div class="notes"><div class="card"><h3>导演执行说明</h3><ul>${row.directorNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul></div><div class="card"><h3>Seedance 提示词</h3><div class="prompt">${escapeHtml(row.seedancePrompt)}</div></div></div><div class="blocking"><div class="card"><h3>人物站位 + 机位 + FOV</h3>${row.blockingSvg}</div><div class="card"><h3>连续性检查</h3><ul>${row.blockingNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul></div></div></section>`).join("\n")}
<p class="footer">生成规则：草图只承载视觉构图，中文说明、CAM、FOV、站位和提示词由 HTML/SVG 精确绘制。</p></main></body></html>`;
}

function renderSketchPlaceholder(row: DirectorStoryboardRow) {
  return `<svg viewBox="0 0 520 300" xmlns="http://www.w3.org/2000/svg"><rect width="520" height="300" fill="#f3f0e8"/><path d="M20 230 C120 130 180 210 270 112 S420 80 500 170" fill="none" stroke="#64748b" stroke-width="4" opacity=".45"/><circle cx="235" cy="132" r="42" fill="#d1d5db" stroke="#475569"/><path d="M235 176 L205 246 M235 176 L270 246 M205 206 L270 206" stroke="#475569" stroke-width="7" stroke-linecap="round"/><rect x="342" y="74" width="112" height="64" rx="18" fill="#d9d3c4" stroke="#78716c"/><text x="24" y="34" font-size="18" fill="#334155" font-weight="700">${escapeXml(row.shotNo)}</text><text x="24" y="62" font-size="14" fill="#64748b">${escapeXml(row.sketchPrompt).slice(0, 86)}</text></svg>`;
}

function renderDirectorStoryboardMarkdown(workflow: ProjectWorkflow, rows: DirectorStoryboardRow[]) {
  return [`# ${workflow.project.name} 导演分镜表`, "", `- 镜头数：${rows.length}`, `- 总时长：${rows.reduce((sum, row) => sum + row.duration, 0)}s`, "", ...rows.flatMap((row) => [
    `## ${row.shotNo}`,
    `- 镜头：${row.shotSize} / ${row.cameraAngle} / ${row.lens} / FOV ${row.fov}° / ${row.cameraMovement}`,
    `- 导演执行：${row.directorNotes.join(" ")}`,
    `- 草图 Prompt：${row.sketchPrompt}`,
    "```text",
    row.seedancePrompt,
    "```",
    ""
  ])].join("\n");
}

function safeSegment(value: string) {
  return value.trim().replace(/[^\w\u4e00-\u9fa5-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "director";
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeXml(value: string) {
  return escapeHtml(value);
}

const DIRECTOR_PROMPT_GUIDE = `# 导演分镜增强提示词规则

## 角色板

- 角色参考图不做机械三视图目录，改为电影感身份板。
- 大型 hero 全身视角作为身份锚点，辅以侧面、背面、坐姿、蹲姿、俯视/仰视、表情、轮廓和细节研究。
- 所有视角严格保持同一脸型、发型、服装、身体比例和姿势语言。

## 分镜与视频

- 每个 Seedance 视频段不超过 15 秒，优先 6-12 秒。
- 先写 First-frame anchor、Last-frame anchor 和 Continuity handoff，再写提示词。
- 每镜固定包含景别、机位角度、焦距、FOV、运镜、站位、动作、声音和避免项。
- 禁止对白字幕、解释字、标题字、水印；对白只作为角色语音出现。

## 导演表

- 左侧：分镜草图或草图 prompt。
- 中间：导演执行说明，包括设备/镜头、站位调度、画面+台词+声音、转场。
- 右侧：SVG 人物站位 + CAM + 方向箭头 + FOV 扇形。
- 所有长中文说明、CAM、FOV 和人物标签用 HTML/SVG 生成，不交给图像模型渲染。
`;
