#!/usr/bin/env bash
# Exercises the packaged production runtime against CI-only PostgreSQL/Redis.
set -euo pipefail
test "${AIFILM_TEST_API_DATABASE_URL:-}" != ""
case "$AIFILM_TEST_API_DATABASE_URL" in postgresql://*@127.0.0.1:*/audit_api_*) ;; *) echo "Isolated CI database required" >&2; exit 2;; esac
name="manjiao-runtime-check-$$"
cleanup() {
  local status=$?
  if [ "$status" -ne 0 ]; then docker logs --tail 80 "$name" >&2 2>/dev/null || true; fi
  docker rm -f "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker run --rm --network none --entrypoint sh manjiao-verify -ec \
  'test ! -d apps/web/node_modules; test ! -d apps/api/src; test -f apps/api/dist/server.js; test -f apps/web/dist/index.html; node apps/api/node_modules/prisma/build/index.js --version'
# Exercise the exact deployment schema command against the isolated test database.
docker run --rm --network host -e DATABASE_URL="$AIFILM_TEST_API_DATABASE_URL" \
  --entrypoint node manjiao-verify apps/api/node_modules/prisma/build/index.js db push \
  --schema apps/api/prisma/schema.prisma --skip-generate
docker run -d --name "$name" --network host \
  -e DATABASE_URL="$AIFILM_TEST_API_DATABASE_URL" -e REDIS_URL="${AIFILM_TEST_REDIS_URL:?}" \
  -e API_PORT=4088 -e APP_REVISION=runtime-image-check \
  -e AIFILM_LOAD_ENV_FILES=false -e SEED_DEFAULT_USERS=false -e SEED_DEMO_USER=false -e SEED_DEMO_DATA=false \
  -e ENABLE_MOCK_PAYMENT=true -e OBJECT_STORAGE_LOCAL_DIR=/tmp/manjiao-runtime-storage \
  manjiao-verify >/dev/null
node --input-type=module <<'JS'
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const base = "http://127.0.0.1:4088";
let healthy = false;
for (let i = 0; i < 60; i++) {
  try {
    const response = await fetch(`${base}/ready`, { signal: AbortSignal.timeout(2000) });
    const body = await response.json();
    healthy = response.ok && body.ok === true && body.revision === "runtime-image-check";
  } catch {}
  if (healthy) break;
  await new Promise(resolve => setTimeout(resolve, 500));
}
assert.ok(healthy, "Packaged API must start with real PostgreSQL, Redis, worker and shared modules");
const registration = await fetch(`${base}/api/auth/register`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: `runtime-${randomUUID()}@example.test`, password: `Runtime-${randomUUID()}`, name: "Runtime check" })
});
assert.equal(registration.status, 201);
const { token } = await registration.json();
for (const [endpoint, status] of [["mock-callback", 404], ["orders", 503]]) {
  const response = await fetch(`${base}/api/billing/${endpoint}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}"
  });
  assert.equal(response.status, status, `Production billing/${endpoint} must reject simulated checkout`);
}
console.log("PRODUCTION_RUNTIME_OK: real dependencies ready; simulated payment and unsupported checkout blocked");
JS
