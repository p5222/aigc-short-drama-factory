import assert from "node:assert/strict";
import test from "node:test";
import { canonicalAdminHash, createAdminNavigation } from "./adminNavigationModel.ts";

function fixture(initial = "平台公告") {
  let url = canonicalAdminHash(initial), allow = false, confirms = 0;
  const accepted: string[] = [], writes: Array<{ hash: string; mode: string }> = [];
  const nav = createAdminNavigation({ readHash: () => url, writeHash: (hash, mode) => { url = hash; writes.push({ hash, mode }); }, canLeave: () => { confirms++; return allow; }, accepted: hash => accepted.push(hash) });
  return { nav, accepted, writes, url: () => url, confirms: () => confirms, allow: () => { allow = true; }, browserMove: (name: string) => { url = canonicalAdminHash(name); } };
}

test("cancelled browser back restores accepted URL without notifying or replacing the editor", () => {
  const f = fixture();
  f.browserMove("用户管理");
  assert.equal(f.nav.syncLocation(), false);
  assert.equal(f.url(), canonicalAdminHash("平台公告"));
  assert.equal(f.nav.readAccepted(), canonicalAdminHash("平台公告"));
  assert.deepEqual(f.accepted, []);
  assert.deepEqual(f.writes, [{ hash: canonicalAdminHash("平台公告"), mode: "replace" }]);
});

test("accepted browser back emits once across popstate and hashchange", () => {
  const f = fixture(); f.allow(); f.browserMove("用户管理");
  f.nav.syncLocation(); f.nav.syncLocation();
  assert.deepEqual(f.accepted, [canonicalAdminHash("用户管理")]);
  assert.equal(f.confirms(), 1); assert.equal(f.writes.length, 0);
});

test("sidebar navigation checks once and synchronizes accepted state without a synthetic hash event", () => {
  const f = fixture(); f.allow();
  assert.equal(f.nav.navigate("模型路由"), true);
  f.nav.syncLocation();
  assert.equal(f.confirms(), 1);
  assert.deepEqual(f.accepted, [canonicalAdminHash("模型路由")]);
  assert.deepEqual(f.writes, [{ hash: canonicalAdminHash("模型路由"), mode: "push" }]);
});

test("cancelled sidebar navigation preserves both URL and editor", () => {
  const f = fixture();
  assert.equal(f.nav.navigate("模型路由"), false);
  assert.equal(f.url(), canonicalAdminHash("平台公告"));
  assert.deepEqual(f.accepted, []); assert.deepEqual(f.writes, []);
});

test("rapid backwards traversals and queued notifications cannot apply rejected destinations", () => {
  const f = fixture();
  f.browserMove("用户管理"); f.nav.syncLocation();
  f.browserMove("运营总览"); f.nav.syncLocation();
  // Previously queued hashchange events read the restored live URL and become no-ops.
  f.nav.syncLocation(); f.nav.syncLocation();
  assert.equal(f.confirms(), 2);
  assert.equal(f.url(), canonicalAdminHash("平台公告"));
  assert.deepEqual(f.accepted, []);
});

test("encoded aliases and same destination do not trigger spurious confirmations", () => {
  const f = fixture();
  f.nav.navigate(canonicalAdminHash("平台公告"));
  assert.equal(f.confirms(), 0);
  assert.equal(canonicalAdminHash("#%E0%A4%A"), "");
  assert.equal(canonicalAdminHash("#"), "");
});
