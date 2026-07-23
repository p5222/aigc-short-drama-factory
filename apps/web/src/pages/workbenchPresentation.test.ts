import assert from "node:assert/strict";
import test from "node:test";
import type { GenerationTask, Project } from "@aifilm/shared";
import { collectWorkbenchActions, formatRelativeUpdate, projectNextAction, projectStatusLabel, taskStatusLabel } from "./workbenchPresentation.ts";

const project = (id: string, status: Project["status"]): Project => ({
  id, name: id, type: "漫剧", intro: "", sourceType: "script", artStyle: "国漫", videoRatio: "9:16",
  status, episodes: 1, storyboards: 0, characters: 0, imageAssets: 0, videoClips: 0, creditsSpent: 0,
  updatedAt: "2026-07-23T08:00:00.000Z"
});

const task = (id: string, status: GenerationTask["status"]): GenerationTask => ({
  id, type: "image", title: id, provider: "route", model: "model", status, progress: 0,
  estimatedCredits: 10, createdAt: "2026-07-23T08:00:00.000Z", updatedAt: "2026-07-23T08:00:00.000Z"
});

test("presents internal states as creator actions", () => {
  assert.equal(projectStatusLabel("storyboarding"), "待确认分镜");
  assert.equal(projectNextAction(project("p1", "storyboarding")), "确认分镜");
  assert.equal(taskStatusLabel("failed"), "失败待处理");
});

test("separates failed, active and creator-confirmation work", () => {
  const result = collectWorkbenchActions(
    [project("script", "scripting"), project("done", "completed")],
    [task("failed", "failed"), task("running", "running"), task("done", "succeeded")]
  );
  assert.deepEqual(result.failed.map((item) => item.id), ["failed"]);
  assert.deepEqual(result.active.map((item) => item.id), ["running"]);
  assert.deepEqual(result.waiting.map((item) => item.id), ["script"]);
});

test("formats update times for quick scanning", () => {
  const now = new Date("2026-07-23T10:00:00.000Z").getTime();
  assert.equal(formatRelativeUpdate("2026-07-23T09:45:00.000Z", now), "15 分钟前");
  assert.equal(formatRelativeUpdate("2026-07-21T10:00:00.000Z", now), "2 天前");
});
