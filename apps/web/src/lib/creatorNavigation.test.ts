import assert from "node:assert/strict";
import test from "node:test";
import { creatorRouteHash, readCreatorRoute, createRequestEpoch, refreshResources } from "./creatorNavigation.ts";

test("creator links preserve project identity across reloads, and reject invalid or admin destinations", () => {
  for (const route of [{ page: "project", projectId: "project-2" }, { page: "content", contentId: "story-4" }, { page: "tasks" }] as const) {
    assert.deepEqual(readCreatorRoute(creatorRouteHash(route)), route);
  }
  for (const hash of ["#/project", "#/project/%broken", "#/project/a%2fb"]) assert.deepEqual(readCreatorRoute(hash), { page: "scripts" });
  assert.deepEqual(readCreatorRoute("#/admin"), { page: "workbench" });
  assert.deepEqual(readCreatorRoute("#public-showcase"), { page: "workbench" });
});

test("an auxiliary failure keeps successful project and queue updates, rejects false refresh success, and preserves failed data", async () => {
  let projects = ["old"], help = ["existing help"], tasks = ["old task"];
  await assert.rejects(refreshResources([
    { label: "作品", read: async () => ["new"], apply: (value: string[]) => { projects = value; } },
    { label: "帮助", read: async () => { throw new Error("HTTP 500"); }, apply: (value: string[]) => { help = value; } },
    { label: "队列", read: async () => ["finished"], apply: (value: string[]) => { tasks = value; } }
  ]), /帮助未能刷新/);
  assert.deepEqual(projects, ["new"]); assert.deepEqual(tasks, ["finished"]); assert.deepEqual(help, ["existing help"]);
});

test("stale reads and reads from a signed-out account never replace current data", async () => {
  const epoch = createRequestEpoch(); const token = epoch.begin(); let applied = false;
  let resolve!: (value: string[]) => void;
  const pending = refreshResources([{ label: "作品", read: () => new Promise<string[]>((done) => { resolve = done; }), apply: () => { applied = true; } }], () => epoch.current(token));
  await Promise.resolve(); epoch.invalidate(); resolve(["private old account"]); await pending;
  assert.equal(applied, false);
  const next = epoch.begin(); assert.equal(epoch.current(token), false); assert.equal(epoch.current(next), true);
});
