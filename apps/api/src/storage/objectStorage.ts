import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { downloadPublicMedia } from "./remoteDownload.js";
import { mediaExtension } from "./mediaFormat.js";

export const storageRoot = resolve(process.cwd(), process.env.OBJECT_STORAGE_LOCAL_DIR || "../../storage");

export async function ensureStorageBuckets() {
  await Promise.all([
    mkdir(resolve(storageRoot, "images"), { recursive: true }),
    mkdir(resolve(storageRoot, "videos"), { recursive: true }),
    mkdir(resolve(storageRoot, "audio"), { recursive: true }),
    mkdir(resolve(storageRoot, "exports"), { recursive: true }),
    mkdir(resolve(storageRoot, "logs"), { recursive: true })
  ]);
}

export async function persistImageReference(sourceUrl: string | undefined, nameHint: string) {
  return persistRemoteReference(sourceUrl, nameHint, "images");
}

export async function persistVideoReference(sourceUrl: string | undefined, nameHint: string) {
  return persistRemoteReference(sourceUrl, nameHint, "videos");
}

export async function persistTextReference(content: string, nameHint: string, bucket: "exports" | "logs" | "videos" = "exports", ext = "txt") {
  const targetDir = resolve(storageRoot, bucket);
  await mkdir(targetDir, { recursive: true });
  const fileName = safeFileName(nameHint, crypto.randomUUID(), ext);
  await writeFile(resolve(targetDir, fileName), content, "utf8");
  return `/storage/${bucket}/${fileName}`;
}

export async function persistImageBuffer(buffer: Buffer, nameHint: string, ext = "png") {
  const targetDir = resolve(storageRoot, "images");
  await mkdir(targetDir, { recursive: true });
  const fileName = safeFileName(nameHint, crypto.randomUUID(), ext);
  await writeFile(resolve(targetDir, fileName), buffer);
  return `/storage/images/${fileName}`;
}

export async function persistVideoBuffer(buffer: Buffer, nameHint: string, ext = "mp4") {
  const targetDir = resolve(storageRoot, "videos");
  await mkdir(targetDir, { recursive: true });
  const fileName = safeFileName(nameHint, crypto.randomUUID(), ext);
  await writeFile(resolve(targetDir, fileName), buffer);
  return `/storage/videos/${fileName}`;
}

export async function persistAudioBuffer(buffer: Buffer, nameHint: string, ext = "wav") {
  const targetDir = resolve(storageRoot, "audio");
  await mkdir(targetDir, { recursive: true });
  const fileName = safeFileName(nameHint, crypto.randomUUID(), ext);
  await writeFile(resolve(targetDir, fileName), buffer);
  return `/storage/audio/${fileName}`;
}

export async function readStoredAsset(assetUrl: string) {
  if (!assetUrl.startsWith("/storage/")) throw new Error(`Only local storage assets can be read: ${assetUrl}`);
  const relativePath = decodeURIComponent(assetUrl.split(/[?#]/)[0]!.replace(/^\/storage\//, ""));
  const target = resolve(storageRoot, relativePath);
  const inside = relative(storageRoot, target);
  if (inside.startsWith("..") || isAbsolute(inside)) throw new Error("Storage path is outside the media directory");
  return readFile(target);
}

async function persistRemoteReference(sourceUrl: string | undefined, nameHint: string, bucket: "images" | "videos") {
  if (!sourceUrl) return undefined;
  if (sourceUrl.startsWith("/storage/")) return sourceUrl;
  if (!sourceUrl.startsWith("data:") && !sourceUrl.startsWith("http://") && !sourceUrl.startsWith("https://")) throw new Error("不支持此素材地址");

  const targetDir = resolve(storageRoot, bucket);
  await mkdir(targetDir, { recursive: true });

  const id = crypto.randomUUID();
  if (sourceUrl.startsWith("data:")) {
    const match = sourceUrl.match(/^data:(.+?);base64,(.+)$/);
    if (!match || !/^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm|quicktime|x-msvideo))$/i.test(match[1]!)) throw new Error("请上传 PNG、JPEG、WebP、GIF 图片或受支持的视频");
    if (match[2]!.length > (bucket === "images" ? 28_000_000 : 280_000_000)) throw new Error("素材文件过大");
    const bytes = Buffer.from(match[2]!, "base64");
    const ext = mediaExtension(bytes, bucket);
    const fileName = safeFileName(nameHint, id, ext);
    await writeFile(resolve(targetDir, fileName), bytes);
    return `/storage/${bucket}/${fileName}`;
  }

  const { bytes } = await downloadPublicMedia(sourceUrl, bucket === "images" ? 20 * 1024 * 1024 : 200 * 1024 * 1024);
  const ext = mediaExtension(bytes, bucket);
  const fileName = safeFileName(nameHint, id, ext);
  await writeFile(resolve(targetDir, fileName), bytes);
  return `/storage/${bucket}/${fileName}`;
}

function safeFileName(nameHint: string, id: string, ext: string) {
  const safeHint = nameHint
    .trim()
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${safeHint || "image"}-${id}.${ext || "png"}`;
}

function mimeExtension(mime: string) {
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("octet-stream")) return "mp4";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("x-msvideo")) return "avi";
  if (mime.includes("quicktime")) return "mov";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "png";
}
