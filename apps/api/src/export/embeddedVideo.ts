import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { persistVideoBuffer, storageRoot } from "../storage/objectStorage.js";

export interface EmbeddedVideoInput {
  prompt: string;
  imageUrl?: string;
  ratio?: "9:16" | "16:9" | "1:1";
  duration?: number;
  nameHint?: string;
}

export async function generateEmbeddedMjpegVideo(input: EmbeddedVideoInput) {
  const size = videoSizeFromRatio(input.ratio ?? "9:16");
  const fps = 8;
  const duration = Math.max(1, Math.min(8, Math.round(input.duration ?? 3)));
  const frames = await renderAnimatedJpegFrames(input, size, fps, duration);
  const buffer = encodeMjpegAvi({ frames, width: size.width, height: size.height, fps });
  return persistVideoBuffer(buffer, input.nameHint || `embedded-video-${Date.now()}`, "avi");
}

async function renderAnimatedJpegFrames(input: EmbeddedVideoInput, size: { width: number; height: number }, fps: number, duration: number) {
  const totalFrames = Math.max(1, fps * duration);
  const base = await loadBaseImage(input, size);
  const frames: Buffer[] = [];
  for (let index = 0; index < totalFrames; index += 1) {
    const progress = totalFrames <= 1 ? 0 : index / (totalFrames - 1);
    const zoom = 1.02 + progress * 0.035;
    const scaledWidth = Math.ceil(size.width * zoom);
    const scaledHeight = Math.ceil(size.height * zoom);
    const left = Math.max(0, Math.round((scaledWidth - size.width) * (0.5 + Math.sin(progress * Math.PI * 2) * 0.18)));
    const top = Math.max(0, Math.round((scaledHeight - size.height) * (0.5 + Math.cos(progress * Math.PI * 2) * 0.12)));
    const overlay = Buffer.from(animatedOverlaySvg(size.width, size.height, input.prompt, index + 1, totalFrames));
    const frame = await sharp(base)
      .resize(scaledWidth, scaledHeight, { fit: "cover" })
      .extract({ left: Math.min(left, scaledWidth - size.width), top: Math.min(top, scaledHeight - size.height), width: size.width, height: size.height })
      .modulate({ brightness: 1 + Math.sin(progress * Math.PI) * 0.035, saturation: 1.04 })
      .composite([{ input: overlay, left: 0, top: 0 }])
      .jpeg({ quality: 82, chromaSubsampling: "4:2:0" })
      .toBuffer();
    frames.push(frame.length % 2 ? Buffer.concat([frame, Buffer.from([0])]) : frame);
  }
  return frames;
}

async function loadBaseImage(input: EmbeddedVideoInput, size: { width: number; height: number }) {
  const local = input.imageUrl?.startsWith("/storage/") ? resolve(storageRoot, input.imageUrl.replace(/^\/storage\//, "").replace(/\.\./g, "")) : undefined;
  if (local) {
    try {
      return await sharp(await readFile(local)).resize(size.width, size.height, { fit: "cover" }).png().toBuffer();
    } catch {
      // fall through to generated card
    }
  }
  return sharp(Buffer.from(titleCardSvg(size.width, size.height, input.prompt))).png().toBuffer();
}

export async function writeEmbeddedExportBundle(input: { projectId: string; videoUrl: string; audioUrl: string; subtitleUrl: string; manifest: unknown }) {
  const dirName = `embedded-export-${safeSegment(input.projectId)}-${Date.now()}`;
  const dir = resolve(storageRoot, "exports", dirName);
  await mkdir(dir, { recursive: true });
  const manifestPath = resolve(dir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify({
    ...input.manifest as Record<string, unknown>,
    packageType: "embedded-mjpeg-avi",
    videoUrl: input.videoUrl,
    audioUrl: input.audioUrl,
    subtitleUrl: input.subtitleUrl,
    note: "FFmpeg 不可用时的项目内置可迁移包：真实视频片段使用 MJPEG/AVI 纯 TypeScript 编码，音频与字幕作为独立资产随包输出。"
  }, null, 2), "utf8");
  return `/storage/exports/${dirName}/manifest.json`;
}

function encodeMjpegAvi(input: { frames: Buffer[]; width: number; height: number; fps: number }) {
  const moviChunks = input.frames.map((frame) => riffChunk("00dc", frame));
  const moviList = riffList("movi", Buffer.concat(moviChunks));
  let offset = 4;
  const indexEntries = input.frames.map((frame) => {
    const entry = Buffer.alloc(16);
    entry.write("00dc", 0, "ascii");
    entry.writeUInt32LE(0x10, 4);
    entry.writeUInt32LE(offset, 8);
    entry.writeUInt32LE(frame.length, 12);
    offset += 8 + frame.length + (frame.length % 2);
    return entry;
  });
  const hdrl = riffList("hdrl", Buffer.concat([aviMainHeader(input), streamList(input)]));
  return riffFile(Buffer.concat([hdrl, moviList, riffChunk("idx1", Buffer.concat(indexEntries))]));
}

function aviMainHeader(input: { frames: Buffer[]; width: number; height: number; fps: number }) {
  const buffer = Buffer.alloc(56);
  buffer.writeUInt32LE(Math.round(1_000_000 / input.fps), 0);
  buffer.writeUInt32LE(input.width * input.height * 3 * input.fps, 4);
  buffer.writeUInt32LE(0, 8);
  buffer.writeUInt32LE(0x10, 12);
  buffer.writeUInt32LE(input.frames.length, 16);
  buffer.writeUInt32LE(0, 20);
  buffer.writeUInt32LE(1, 24);
  buffer.writeUInt32LE(0, 28);
  buffer.writeUInt32LE(input.width, 32);
  buffer.writeUInt32LE(input.height, 36);
  return riffChunk("avih", buffer);
}

function streamList(input: { frames: Buffer[]; width: number; height: number; fps: number }) {
  return riffList("strl", Buffer.concat([streamHeader(input), streamFormat(input)]));
}

function streamHeader(input: { frames: Buffer[]; width: number; height: number; fps: number }) {
  const buffer = Buffer.alloc(56);
  buffer.write("vids", 0, "ascii");
  buffer.write("MJPG", 4, "ascii");
  buffer.writeUInt32LE(0, 8);
  buffer.writeUInt16LE(0, 12);
  buffer.writeUInt16LE(0, 14);
  buffer.writeUInt32LE(0, 16);
  buffer.writeUInt32LE(1, 20);
  buffer.writeUInt32LE(input.fps, 24);
  buffer.writeUInt32LE(0, 28);
  buffer.writeUInt32LE(input.frames.length, 32);
  buffer.writeUInt32LE(input.width * input.height * 3, 36);
  buffer.writeUInt32LE(0xffffffff, 40);
  buffer.writeUInt32LE(0, 44);
  buffer.writeInt16LE(0, 48);
  buffer.writeInt16LE(0, 50);
  buffer.writeInt16LE(input.width, 52);
  buffer.writeInt16LE(input.height, 54);
  return riffChunk("strh", buffer);
}

function streamFormat(input: { width: number; height: number }) {
  const buffer = Buffer.alloc(40);
  buffer.writeUInt32LE(40, 0);
  buffer.writeInt32LE(input.width, 4);
  buffer.writeInt32LE(input.height, 8);
  buffer.writeUInt16LE(1, 12);
  buffer.writeUInt16LE(24, 14);
  buffer.write("MJPG", 16, "ascii");
  buffer.writeUInt32LE(input.width * input.height * 3, 20);
  return riffChunk("strf", buffer);
}

function riffFile(content: Buffer) {
  const head = Buffer.alloc(12);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(content.length + 4, 4);
  head.write("AVI ", 8, "ascii");
  return Buffer.concat([head, content]);
}

function riffList(type: string, content: Buffer) {
  const head = Buffer.alloc(12);
  head.write("LIST", 0, "ascii");
  head.writeUInt32LE(content.length + 4, 4);
  head.write(type, 8, "ascii");
  return Buffer.concat([head, content, content.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);
}

function riffChunk(id: string, content: Buffer) {
  const head = Buffer.alloc(8);
  head.write(id, 0, "ascii");
  head.writeUInt32LE(content.length, 4);
  return Buffer.concat([head, content, content.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);
}

function titleCardSvg(width: number, height: number, text: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0f766e"/><stop offset="0.55" stop-color="#1f2937"/><stop offset="1" stop-color="#7c2d12"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${width * 0.25}" cy="${height * 0.28}" r="${Math.min(width, height) * 0.18}" fill="#f8fafc" opacity="0.14"/><circle cx="${width * 0.72}" cy="${height * 0.58}" r="${Math.min(width, height) * 0.24}" fill="#2dd4bf" opacity="0.12"/><text x="${width / 2}" y="${height * 0.76}" text-anchor="middle" font-family="Microsoft YaHei, Arial" font-size="${Math.round(width * 0.05)}" font-weight="700" fill="#ffffff">${escapeSvg(text).slice(0, 38)}</text></svg>`;
}

function animatedOverlaySvg(width: number, height: number, text: string, frame: number, total: number) {
  const progress = frame / Math.max(1, total);
  const x = Math.round(width * (0.15 + progress * 0.7));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect y="${height - 92}" width="100%" height="92" fill="#020617" opacity="0.38"/><circle cx="${x}" cy="${Math.round(height * 0.18)}" r="${Math.round(width * 0.035)}" fill="#fde68a" opacity="0.75"/><text x="${width / 2}" y="${height - 38}" text-anchor="middle" font-family="Microsoft YaHei, Arial" font-size="${Math.round(width * 0.035)}" fill="#ffffff">${escapeSvg(text).slice(0, 42)}</text></svg>`;
}

function videoSizeFromRatio(ratio: "9:16" | "16:9" | "1:1") {
  if (ratio === "16:9") return { width: 640, height: 360 };
  if (ratio === "1:1") return { width: 512, height: 512 };
  return { width: 360, height: 640 };
}

function safeSegment(value: string) {
  return value.trim().replace(/[^\w\u4e00-\u9fa5-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "embedded";
}

function escapeSvg(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
