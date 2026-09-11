import assert from "node:assert/strict";
import test from "node:test";
import { AUTH_TOKEN_KEY, createAuthStorage } from "./authStorage.ts";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

test("unchecking remember clears an old persistent login and survives only its current tab", () => {
  const local = storage(); const session = storage();
  local.setItem(AUTH_TOKEN_KEY, "old-persistent");
  const auth = createAuthStorage(() => ({ local, session }));
  auth.write("temporary", false);
  assert.equal(local.getItem(AUTH_TOKEN_KEY), null);
  assert.equal(session.getItem(AUTH_TOKEN_KEY), "temporary");
  assert.equal(createAuthStorage(() => ({ local, session })).read(), "temporary");
  assert.equal(createAuthStorage(() => ({ local, session: storage() })).read(), "");
});

test("remembered login persists and logout removes both storage variants", () => {
  const local = storage(); const session = storage();
  session.setItem(AUTH_TOKEN_KEY, "old-session");
  const auth = createAuthStorage(() => ({ local, session }));
  auth.write("remembered", true);
  assert.equal(session.getItem(AUTH_TOKEN_KEY), null);
  assert.equal(createAuthStorage(() => ({ local, session: storage() })).read(), "remembered");
  auth.clear();
  assert.equal(auth.read(), "");
  assert.equal(local.getItem(AUTH_TOKEN_KEY), null);
});

test("blocked storage keeps authentication only in memory and can still log out", () => {
  const auth = createAuthStorage(() => ({}));
  auth.write("temporary", false);
  assert.equal(auth.read(), "temporary");
  auth.clear();
  assert.equal(auth.read(), "");
});
