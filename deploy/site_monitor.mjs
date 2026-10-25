import { pathToFileURL } from "node:url";

export function assessReadiness(status, payload, expectedRevision) {
  if (status !== 200) return { ok: false, reason: "http_status", status };
  if (!payload || payload.ok !== true || !payload.checks || ["database", "redis", "worker", "catalog"].some(key => payload.checks[key] !== true)) {
    return { ok: false, reason: "not_ready" };
  }
  if (expectedRevision && payload.revision !== expectedRevision) return { ok: false, reason: "revision_mismatch" };
  return { ok: true, revision: /^[a-f0-9]{40}$/i.test(payload.revision ?? "") ? payload.revision : "development" };
}

export function assessBackup(latestMs, maxAgeHours = 30, now = Date.now()) {
  if (!Number.isFinite(latestMs) || latestMs <= 0) return { ok: false, reason: "backup_missing" };
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) return { ok: false, reason: "invalid_backup_threshold" };
  const ageHours = (now - latestMs) / 3_600_000;
  if (ageHours < -1) return { ok: false, reason: "backup_time_invalid" };
  return { ok: ageHours <= maxAgeHours, reason: ageHours <= maxAgeHours ? "fresh" : "backup_stale", ageHours: Math.round(Math.max(0, ageHours) * 10) / 10 };
}

export async function monitorReadiness({ url = "https://manjiao.cloud/ready", expectedRevision, timeoutMs = 4000 } = {}) {
  let endpoint;
  try { endpoint = new URL(url); } catch { return { ok: false, reason: "invalid_url" }; }
  if (endpoint.username || endpoint.password || !(endpoint.protocol === "https:" || (endpoint.protocol === "http:" && ["localhost", "127.0.0.1"].includes(endpoint.hostname)))) {
    return { ok: false, reason: "invalid_url" };
  }
  if (expectedRevision && !/^[a-f0-9]{40}$/i.test(expectedRevision)) return { ok: false, reason: "invalid_revision" };
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) return { ok: false, reason: "invalid_timeout" };
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(timeoutMs), redirect: "error", headers: { "Cache-Control": "no-cache" } });
    if (response.status !== 200) return assessReadiness(response.status, null, expectedRevision);
    const text = await response.text();
    if (text.length > 16_384) return { ok: false, reason: "invalid_response" };
    let payload;
    try { payload = JSON.parse(text); } catch { return { ok: false, reason: "invalid_json" }; }
    return assessReadiness(response.status, payload, expectedRevision);
  } catch (error) {
    return { ok: false, reason: error?.name === "TimeoutError" || error?.name === "AbortError" ? "timeout" : "unreachable" };
  }
}

async function main() {
  const readiness = await monitorReadiness({
    url: process.env.MONITOR_URL || undefined,
    expectedRevision: process.env.MONITOR_REVISION || undefined,
    timeoutMs: Number(process.env.MONITOR_TIMEOUT_MS || 4000)
  });
  const backup = process.env.MONITOR_BACKUP_CHECK === "true" ? assessBackup(Number(process.env.MONITOR_BACKUP_LATEST_MS), Number(process.env.MONITOR_BACKUP_MAX_AGE_HOURS || 30)) : undefined;
  const result = { ok: readiness.ok && (!backup || backup.ok), time: new Date().toISOString(), readiness, ...(backup ? { backup } : {}) };
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}
if (!process.argv[1] || process.argv[1] === "-" || import.meta.url === pathToFileURL(process.argv[1]).href) await main();
