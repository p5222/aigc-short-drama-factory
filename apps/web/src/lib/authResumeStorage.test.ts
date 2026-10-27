import assert from "node:assert/strict";
import test from "node:test";
import { createAuthResumeStorage } from "./authResumeStorage.ts";

test("denied storage still preserves recovery and clears it on logout", () => {
  const recovery = createAuthResumeStorage(() => { throw new Error("SecurityError"); });
  recovery.write({ userId: "one", page: "project", projectId: "one-project" });
  assert.deepEqual(recovery.read(), { userId: "one", page: "project", projectId: "one-project" });
  recovery.clear();
  assert.equal(recovery.read(), null);
});

test("quota or method failures use current memory instead of another user's persisted metadata", () => {
  const recovery = createAuthResumeStorage(() => ({
    getItem: () => JSON.stringify({ userId: "old", page: "profile" }),
    setItem: () => { throw new Error("quota"); },
    removeItem: () => { throw new Error("denied"); }
  }));
  recovery.write({ userId: "new", page: "tasks" });
  assert.deepEqual(recovery.read(), { userId: "new", page: "tasks" });
  assert.doesNotThrow(() => recovery.clear());
  assert.equal(recovery.read(), null);
});

test("legacy recovery survives the upgrade while malformed metadata is ignored", () => {
  const values = new Map<string, string>([["manjiao-auth-resume-user", "one"], ["manjiao-auth-resume-page", "wizard"]]);
  const store = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const recovery = createAuthResumeStorage(() => store);
  assert.deepEqual(recovery.read(), { userId: "one", page: "wizard" });
  recovery.clear();
  assert.equal(values.size, 0);
  values.set("manjiao-auth-resume", '{"userId":123,"page":{}}');
  assert.equal(recovery.read(), null);
});
