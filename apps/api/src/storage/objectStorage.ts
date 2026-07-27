import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

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
  const relativePath = assetUrl.replace(/^\/storage\//, "").replace(/\.\./g, "");
  return readFile(resolve(storageRoot, relativePath));
}

async function persistRemoteReference(sourceUrl: string | undefined, nameHint: string, bucket: "images" | "videos") {
  if (!sourceUrl) return undefined;
  if (sourceUrl.startsWith("/storage/")) return sourceUrl;
  if (!sourceUrl.startsWith("data:") && !sourceUrl.startsWith("http://") && !sourceUrl.startsWith("https://")) return sourceUrl;

  const targetDir = resolve(storageRoot, bucket);
  await mkdir(targetDir, { recursive: true });

  const id = crypto.randomUUID();
  if (sourceUrl.startsWith("data:")) {
    const match = sourceUrl.match(/^data:(.+?);base64,(.+)$/);
    if (!match) return sourceUrl;
    const ext = mimeExtension(match[1]);
    const fileName = safeFileName(nameHint, id, ext);
    await writeFile(resolve(targetDir, fileName), Buffer.from(match[2], "base64"));
    return `/storage/${bucket}/${fileName}`;
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) return sourceUrl;
  const contentType = response.headers.get("content-type") || "";
  const sourceExt = extname(new URL(sourceUrl).pathname).replace(".", "");
  const ext = sourceExt || mimeExtension(contentType);
  const fileName = safeFileName(nameHint, id, ext);
  const bytes = Buffer.from(await response.arrayBuffer());
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
  if (mime.includes("quicktime")) return "mov";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "png";
}
