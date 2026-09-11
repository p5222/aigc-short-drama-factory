import assert from "node:assert/strict";
import test from "node:test";
import type { ContentProjectSummary, Project } from "@aifilm/shared";
import { contentMatchesFilter, contentWorkState, createWorkDeletionRunner, productionMatchesFilter, productionWorkState, worksFilterTabs } from "./scriptsPageModel.ts";

test("all real production stages belong to exactly one visible status filter", () => {
  const cases = { draft: "draft", planning: "running", scripting: "running", storyboarding: "running", asseting: "running", rendering: "running", completed: "done" } as const;
  for (const [status, expected] of Object.entries(cases)) {
    const project = { status } as Project;
    assert.equal(productionMatchesFilter(project, "all"), true);
    assert.equal(productionWorkState(project).filter, expected);
    assert.deepEqual(worksFilterTabs.filter((tab) => tab.id !== "all" && productionMatchesFilter(project, tab.id)).map((tab) => tab.id), [expected]);
  }
});

test("old scripts do not classify failed, stale, running or draft content as complete", () => {
  const cases = { failed: "attention", stale: "attention", running: "running", draft: "draft" } as const;
  for (const [status, expected] of Object.entries(cases)) {
    const project = { status, activeStep: "script", chapterCount: 4, scriptCount: 1 } as ContentProjectSummary;
    assert.equal(contentMatchesFilter(project, "done"), false);
    assert.deepEqual(worksFilterTabs.filter((tab) => tab.id !== "all" && contentMatchesFilter(project, tab.id)).map((tab) => tab.id), [expected]);
  }
});

test("confirmed analysis remains in progress and only current ready scripts are marked ready", () => {
  for (const status of ["confirmed", "succeeded"] as const) {
    const project = { status, activeStep: "analysis", chapterCount: 0, scriptCount: 0 } as ContentProjectSummary;
    assert.equal(contentWorkState(project).filter, "running");
    assert.equal(contentMatchesFilter(project, "draft"), false);
    assert.equal(contentWorkState({ ...project, activeStep: "script", scriptCount: 1 }).label, "剧本已就绪");
  }
  assert.match(contentWorkState({ status: "running", activeStep: "strategy", scriptCount: 0 }).label, /创作策略/);
});

test("unrecognized server states remain discoverable without claiming completion", () => {
  assert.equal(productionWorkState({ status: "unknown" } as unknown as Project).filter, "attention");
  assert.equal(contentWorkState({ status: "unknown", scriptCount: 2 } as unknown as ContentProjectSummary).filter, "attention");
});

test("deletion stays pending and double click cannot send a second mutation", async () => {
  let resolve!: () => void;
  let calls = 0;
  const notices: Parameters<Parameters<typeof createWorkDeletionRunner>[0]>[0][] = [];
  const runner = createWorkDeletionRunner((state) => notices.push(state));
  const first = runner.run("project-a", async () => { calls++; await new Promise<void>((done) => { resolve = done; }); });
  assert.equal(runner.isPending("project-a"), true);
  assert.equal(await runner.run("project-a", async () => { calls++; }), false);
  assert.equal(calls, 1);
  assert.deepEqual(notices, [{ projectId: "project-a", pending: true, error: "", deleted: false }]);
  resolve();
  assert.equal(await first, true);
  assert.equal(runner.isPending("project-a"), false);
  assert.equal(notices.at(-1)?.deleted, true);
});

test("failed deletion retains the item, reports the error and permits an explicit retry", async () => {
  const notices: Parameters<Parameters<typeof createWorkDeletionRunner>[0]>[0][] = [];
  const runner = createWorkDeletionRunner((state) => notices.push(state));
  assert.equal(await runner.run("project-a", async () => { throw new Error("项目仍有生成任务，请稍后重试"); }), false);
  assert.equal(notices.some((notice) => notice.deleted), false);
  assert.match(notices.at(-1)!.error, /生成任务/);
  assert.equal(runner.isPending("project-a"), false);
  assert.equal(await runner.run("project-a", async () => {}), true);
  assert.equal(notices.at(-1)?.error, "");
  assert.equal(notices.at(-1)?.deleted, true);
});
