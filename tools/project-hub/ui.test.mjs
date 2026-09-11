import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { actionReadiness, deploymentSummary, operationStatusLabel, reconcileSelection, safeGithubUrl } from "./public/app.js";

const status = { branch: "main", clean: true, ahead: 0, behind: 0, project: { deployEnabled: true }, files: [] };
test("server deployment and functional branch actions obey distinct prerequisites", () => {
  const main = actionReadiness(status);
  assert.equal(main.deploy, true); assert.equal(main.commit, false); assert.equal(main.push, false);
  const feature = actionReadiness({ ...status, branch: "codex/feature" });
  assert.equal(feature.deploy, false); assert.equal(feature.commit, true); assert.equal(feature.push, true);
  assert.equal(actionReadiness({ ...status, branch: "Main" }).commit, false);
  for (const changed of [{ clean: false }, { ahead: 1 }, { behind: 1 }, { branch: "master" }, { project: { deployEnabled: false } }]) assert.equal(actionReadiness({ ...status, ...changed }).deploy, false);
  for (const action of ["fetch", "pull", "branch", "switch", "commit", "push", "deploy", "verify"]) assert.equal(actionReadiness(status, true)[action], false);
});
test("pre-existing index and conflicts block selective commits, unstaged files do not", () => {
  for (const code of ["M ", "A ", "UU", "R "]) assert.equal(actionReadiness({ ...status, branch: "codex/a", files: [{ code }] }).commit, false);
  for (const code of [" M", "??", " D"]) assert.equal(actionReadiness({ ...status, branch: "codex/a", files: [{ code }] }).commit, true);
});
test("retry deploy is restricted to the persisted accepted full commit", () => {
  const head = "a".repeat(40);
  assert.equal(actionReadiness({ ...status, head, lastDeployment: { deployment: "accepted", commit: head } }).retryDeploy, true);
  assert.equal(actionReadiness({ ...status, head, lastDeployment: { deployment: "verified", commit: head } }).retryDeploy, false);
  assert.equal(actionReadiness({ ...status, head, lastDeployment: { deployment: "accepted", commit: "b".repeat(40) } }).retryDeploy, false);
  assert.equal(actionReadiness({ ...status, head, lastDeployment: null }).retryDeploy, false);
  assert.equal(actionReadiness({ ...status, head: "aaaaaaa", lastDeployment: { deployment: "accepted", commit: "aaaaaaa" } }).retryDeploy, false);
});
test("accepted deployment never reports verified or successful online release", () => {
  assert.match(deploymentSummary({ status: "succeeded", result: { deployment: "accepted", commit: "a".repeat(40) } }), /线上版本尚未核验/);
  assert.match(deploymentSummary({ status: "succeeded", result: { deployment: "verified", commit: "a".repeat(40) } }), /线上版本已核验/);
  assert.match(deploymentSummary({ status: "failed", result: { deployment: "verified" } }), /失败/);
  assert.match(deploymentSummary({ status: "interrupted" }), /已中断/);
  assert.match(deploymentSummary(null), /尚无/);
});
test("deployment task labels distinguish accepted code from verified online release", () => {
  for (const action of ["deploy", "retryDeploy", "verify"]) {
    const job = { action, status: "succeeded" };
    assert.equal(operationStatusLabel({ ...job, result: { deployment: "accepted" } }), "已接收，待核验");
    assert.equal(operationStatusLabel({ ...job, result: { deployment: "verified" } }), "已核验");
    assert.equal(operationStatusLabel(job), "已执行，未核验");
    assert.equal(operationStatusLabel({ ...job, result: { message: "操作完成。" } }), "已执行，未核验");
    for (const [status, label] of [["running", "执行中"], ["failed", "失败"], ["interrupted", "已中断"]]) {
      assert.equal(operationStatusLabel({ ...job, status, result: { deployment: "verified" } }), label);
    }
  }
  assert.equal(operationStatusLabel({ action: "push", status: "succeeded", result: { deployment: "accepted" } }), "已完成");
});
test("audit deployment labels use only the matching successful task and stay unverified without evidence", () => {
  const entry = { id: "deployment-1", projectId: "project-1", action: "deploy", status: "succeeded", message: "操作完成。" };
  const job = { ...entry, result: { deployment: "accepted" } };
  assert.equal(operationStatusLabel(entry, [job]), "已接收，待核验");
  assert.equal(operationStatusLabel(entry, [{ ...job, result: { deployment: "verified" } }]), "已核验");
  assert.equal(operationStatusLabel(entry), "已执行，未核验");
  for (const changed of [{ id: "other-task" }, { projectId: "other-project" }, { action: "verify" }, { status: "failed" }]) {
    assert.equal(operationStatusLabel(entry, [{ ...job, ...changed }]), "已执行，未核验");
  }
  assert.equal(operationStatusLabel({ ...entry, status: "failed" }, [job]), "失败");
  assert.equal(operationStatusLabel({ ...entry, status: "interrupted" }, [job]), "已中断");
});
test("external GitHub links reject credentials, non-web schemes and lookalike domains", () => {
  assert.equal(safeGithubUrl("https://github.com/team/repo/compare/main...feature"), "https://github.com/team/repo/compare/main...feature");
  for (const url of ["javascript:alert(1)", "http://github.com/team/repo", "https://github.com.evil.test/team/repo", "https://token@github.com/team/repo", "https://github.com:444/team/repo", "not a url"]) assert.equal(safeGithubUrl(url), "");
});
test("refresh keeps only still-present allowed selected files", () => {
  const selected = reconcileSelection([{ name: "a.js", blocked: false }, { name: ".env", blocked: true }, { name: "new.js" }], new Set(["a.js", ".env", "removed.js"]));
  assert.deepEqual([...selected], ["a.js"]);
});
test("UI bindings exist and unauthenticated HTML hides all project controls", async () => {
  const [html, js, handbook] = await Promise.all([readFile(new URL("./public/index.html", import.meta.url), "utf8"), readFile(new URL("./public/app.js", import.meta.url), "utf8"), readFile(new URL("./public/handbook.html", import.meta.url), "utf8")]);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "duplicate DOM IDs");
  for (const [, id] of js.matchAll(/\$\("([^"]+)"\)/g)) assert.ok(ids.includes(id), `missing element ${id}`);
  assert.match(html, /id="app-view" hidden/);
  assert.match(js, /const API = "\/ops\/api"/);
  assert.doesNotMatch(js, /innerHTML|localStorage|sessionStorage/);
  assert.match(js, /expectedCommit: confirmed\.head/);
  for (const [, anchor] of [...html.matchAll(/handbook\.html#([\w-]+)/g), ...handbook.matchAll(/href="#([\w-]+)"/g)]) assert.ok(handbook.includes(`id="${anchor}"`), `missing handbook section ${anchor}`);
});
