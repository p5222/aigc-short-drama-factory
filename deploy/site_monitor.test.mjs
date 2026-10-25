import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { assessBackup, assessReadiness, monitorReadiness } from "./site_monitor.mjs";

const payload = { ok: true, checks: { database: true, redis: true, worker: true, catalog: true }, revision: "a".repeat(40) };
test("readiness requires every dependency and the deployed revision", () => {
  assert.equal(assessReadiness(200, payload, payload.revision).ok, true);
  assert.equal(assessReadiness(503, payload).reason, "http_status");
  assert.equal(assessReadiness(200, { ...payload, checks: { database: true } }).reason, "not_ready");
  assert.equal(assessReadiness(200, payload, "b".repeat(40)).reason, "revision_mismatch");
  assert.equal(assessReadiness(200, null).ok, false);
});
test("backup age never treats missing or future evidence as fresh", () => {
  const now = 1_800_000_000_000;
  assert.equal(assessBackup(now - 29 * 3_600_000, 30, now).ok, true);
  assert.equal(assessBackup(now - 31 * 3_600_000, 30, now).reason, "backup_stale");
  assert.equal(assessBackup(0, 30, now).reason, "backup_missing");
  assert.equal(assessBackup(now + 2 * 3_600_000, 30, now).reason, "backup_time_invalid");
  assert.equal(assessBackup(now, -1, now).reason, "invalid_backup_threshold");
});
test("bounded monitor handles real HTTP malformed responses, failures and timeouts", async () => {
  const server = http.createServer((request, response) => {
    if (request.url === "/slow") return;
    if (request.url === "/invalid") return response.end("not json");
    if (request.url === "/failed") { response.writeHead(503); return response.end(); }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(payload));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await monitorReadiness({ url: base, expectedRevision: payload.revision })).ok, true);
    assert.equal((await monitorReadiness({ url: base + "/invalid" })).reason, "invalid_json");
    assert.equal((await monitorReadiness({ url: base + "/failed" })).reason, "http_status");
    assert.equal((await monitorReadiness({ url: base + "/slow", timeoutMs: 30 })).reason, "timeout");
    assert.equal((await monitorReadiness({ url: "https://user:secret@example.test" })).reason, "invalid_url");
    assert.equal((await monitorReadiness({ url: base, expectedRevision: "invalid" })).reason, "invalid_revision");
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
