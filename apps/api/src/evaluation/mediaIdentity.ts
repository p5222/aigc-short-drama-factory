import crypto from "node:crypto";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

/** Verify bytes only in our existing media buckets; never fetch arbitrary sample URLs. */
export async function mediaContentHash(url: string | null | undefined, budget?: { remainingBytes: number }): Promise<string | undefined> {
  if (!url) return undefined;
  const { localMediaPath } = await import("../storage/mediaAccess.js");
  const { storageRoot } = await import("../storage/objectStorage.js");
  const local = localMediaPath(url);
  if (!local) return undefined;
  try {
    const root = await realpath(storageRoot);
    const path = await realpath(resolve(root, local.slice("/storage/".length)));
    const within = relative(root, path);
    if (within.startsWith("..") || isAbsolute(within)) return undefined;
    const file = await open(path, "r");
    try {
      const before = await file.stat();
      if (!before.isFile() || before.size > 128 * 1024 * 1024) return undefined;
      if (budget && before.size > budget.remainingBytes) return undefined;
      if (budget) budget.remainingBytes -= before.size;
      const hash = crypto.createHash("sha256");
      for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
      const after = await file.stat();
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) return undefined;
      return hash.digest("hex");
    } finally { await file.close(); }
  } catch { return undefined; }
}
