import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "../db/client.js";
import { storageRoot } from "./objectStorage.js";

export const MEDIA_COOKIE = "manjiao_media_session";
let signingKey: Promise<Buffer> | undefined;

export function localMediaPath(value: string): string | undefined {
  try {
    const base = new URL(process.env.PUBLIC_API_BASE_URL || `http://localhost:${process.env.API_PORT || 4000}`);
    const url = new URL(value, base);
    if (url.origin !== base.origin && !value.startsWith("/storage/")) return undefined;
    const path = decodeURIComponent(url.pathname);
    if (!/^\/storage\/(images|videos|audio|exports)\//.test(path)) return undefined;
    if (path.includes("\\") || path.includes("\0") || path.split("/").some(part => part === "." || part === ".." || part.startsWith("."))) return undefined;
    return path;
  } catch { return undefined; }
}

async function getSigningKey() {
  signingKey ??= (async () => {
    const configured = process.env.MEDIA_SIGNING_KEY;
    if (configured) {
      if (configured.length < 32) throw new Error("MEDIA_SIGNING_KEY must contain at least 32 characters");
      return Buffer.from(configured);
    }
    await mkdir(storageRoot, { recursive: true });
    const file = resolve(storageRoot, ".media-signing-key");
    try { await writeFile(file, crypto.randomBytes(48), { flag: "wx", mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    return readFile(file);
  })();
  return signingKey;
}

export function mediaSignature(path: string, expires: number, key: Buffer) {
  return crypto.createHmac("sha256", key).update(`${path}\n${expires}`).digest("hex");
}

export function validMediaSignature(path: string, expires: number, signature: string, key: Buffer, now = Date.now()) {
  if (!Number.isSafeInteger(expires) || expires <= Math.floor(now / 1000) || expires > Math.floor(now / 1000) + 3600) return false;
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  return crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(mediaSignature(path, expires, key), "hex"));
}

/** Only trusted provider adapters call this after resolving project-owned media. */
export async function signProviderMediaUrl(value: string) {
  const path = localMediaPath(value);
  if (!path) return value;
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const url = new URL(path, process.env.PUBLIC_API_BASE_URL || `http://localhost:${process.env.API_PORT || 4000}`);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", mediaSignature(path, expires, await getSigningKey()));
  return url.toString();
}

export async function verifyProviderMediaUrl(path: string, expires: unknown, signature: unknown) {
  if (typeof expires !== "string" || typeof signature !== "string") return false;
  return validMediaSignature(path, Number(expires), signature, await getSigningKey());
}

function urlMatches(path: string) {
  const base = process.env.PUBLIC_API_BASE_URL || `http://localhost:${process.env.API_PORT || 4000}`;
  return [path, new URL(path, base).toString()].map(equals => ({ equals }));
}

export async function isPublishedMedia(path: string) {
  return Boolean(await prisma.showcaseWork.findFirst({
    where: { status: "approved", OR: urlMatches(path).flatMap(match => [{ coverUrl: match }, { videoUrl: match }]) },
    select: { id: true }
  }));
}

export async function userCanReadMedia(userId: string, path: string) {
  if (await prisma.asset.findFirst({
    where: { project: { userId }, OR: urlMatches(path).map(referenceUrl => ({ referenceUrl })) }, select: { id: true }
  })) return true;
  if (await prisma.exportJob.findFirst({
    where: { userId, OR: urlMatches(path).map(outputUrl => ({ outputUrl })) }, select: { id: true }
  })) return true;
  const directory = path.match(/^(\/storage\/exports\/[^/]+\/)[^/]+$/)?.[1];
  const jobs = await prisma.exportJob.findMany({
    where: { userId, outputUrl: { not: null }, OR: [{ errorReason: { contains: path } }, ...(directory ? [{ outputUrl: { contains: directory } }, { errorReason: { contains: directory } }] : [])] },
    select: { outputUrl: true, errorReason: true }
  });
  return jobs.some(job => {
    let metadata: Record<string, unknown> = {};
    try { const parsed = JSON.parse(job.errorReason || "{}"); if (parsed.kind === "export_diagnostics") metadata = parsed; } catch { /* Plain failure messages grant no access. */ }
    const references = [job.outputUrl, metadata.manifestUrl, metadata.subtitleUrl, metadata.audioUrl, metadata.previewUrl]
      .filter((value): value is string => typeof value === "string").map(localMediaPath).filter(Boolean);
    return references.some(reference => reference === path || Boolean(directory && reference!.startsWith(directory)));
  });
}

export async function resolveMediaSession(cookieHeader: string | undefined) {
  const pair = cookieHeader?.split(";").map(part => part.trim()).find(part => part.startsWith(`${MEDIA_COOKIE}=`));
  if (!pair) return null;
  let token: string;
  try { token = decodeURIComponent(pair.slice(MEDIA_COOKIE.length + 1)); } catch { return null; }
  if (!token || token.length > 256) return null;
  const session = await prisma.authSession.findUnique({
    where: { tokenHash: crypto.createHash("sha256").update(token).digest("hex") },
    include: { user: { select: { id: true, status: true, role: true } } }
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== "active") return null;
  return session.user;
}
