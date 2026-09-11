import assert from "node:assert/strict";
import test from "node:test";
import type { AssetItem, ExportJob, ShowcaseWork, StoryboardShot } from "@aifilm/shared";
import { buildShowcaseCandidates, canReviseShowcase, createShowcaseSubmitGuard, mergeShowcaseRecord, resolveShowcaseRevision, resolveShowcaseSelection, showcaseCandidateKey, showcaseSubmissionKey } from "./showcasePublishModel.ts";

const shots = [1, 2].map((episodeNo) => ({ id: `s${episodeNo}`, projectId: "p", episodeNo, shotNo: 1, duration: episodeNo * 5 } as StoryboardShot));
const images = shots.map((shot) => ({ id: `image_${shot.id}`, projectId: "p", type: "image", status: "succeeded", referenceUrl: `/storage/${shot.id}.jpg` } as AssetItem));
const jobs = [1, 2].map((episode) => ({ id: `j${episode}`, projectId: "p", type: "video_export", status: "succeeded", sourceStatus: "current", outputKind: "mp4", outputUrl: `/storage/e${episode}.mp4`, storyboardIds: [`s${episode}`], createdAt: `2026-01-0${episode}`, updatedAt: `2026-01-0${episode}` } as ExportJob));

test("current episode stays selected even when another episode has a newer export; cover and duration follow its shots", () => {
  const initial = { id: "export:j1", label: "当前选择", videoUrl: "/storage/e1.mp4", coverUrl: "/wrong-other-episode.jpg", durationLabel: "0:15" };
  const candidates = buildShowcaseCandidates("p", shots, images, jobs, initial);
  const selected = resolveShowcaseSelection(candidates, showcaseCandidateKey(initial));
  assert.equal(candidates[0]!.id, initial.id);
  assert.equal(selected?.videoUrl, "/storage/e1.mp4");
  assert.equal(selected?.coverUrl, "/storage/s1.jpg");
  assert.equal(selected?.durationLabel, "0:05");
  assert.equal(selected?.sourceAssetId, undefined);
});

test("removed or regenerated selection cannot silently fall back to a different video", () => {
  const candidates = buildShowcaseCandidates("p", shots, images, jobs);
  const key = showcaseCandidateKey(candidates[0]!);
  assert.equal(resolveShowcaseSelection(candidates.slice(1), key), undefined);
  assert.equal(resolveShowcaseSelection([{ ...candidates[0]!, videoUrl: "/storage/new-version.mp4" }], key), undefined);
});

test("legacy export does not borrow unrelated episode cover or total duration", () => {
  const candidates = buildShowcaseCandidates("p", shots, images, [{ ...jobs[0]!, storyboardIds: undefined }]);
  assert.equal(candidates[0]!.coverUrl, "");
  assert.equal(candidates[0]!.durationLabel, "时长待核对");
  assert.match(candidates[0]!.label, /范围未记录/);
  assert.deepEqual(buildShowcaseCandidates("other", shots, images, jobs), []);
});

test("stale and unverified exports stay shareable without borrowing current timing or frames", () => {
  for (const sourceStatus of ["stale", "unknown", undefined] as const) {
    const candidates = buildShowcaseCandidates("p", shots.map(shot => ({ ...shot, duration: 100 })), images, [{ ...jobs[0]!, sourceStatus }]);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.videoUrl, jobs[0]!.outputUrl);
    assert.equal(candidates[0]?.coverUrl, "");
    assert.equal(candidates[0]?.durationLabel, "时长待核对");
    assert.match(candidates[0]!.label, sourceStatus === "stale" ? /历史版本.*已更新/ : /历史.*未核验/);
  }
});

test("submission guard prevents concurrent and repeated successful submissions while allowing failed retry", async () => {
  const submit = createShowcaseSubmitGuard();
  let finish!: (value: string) => void;
  let calls = 0;
  const first = submit("a", () => { calls++; return new Promise<string>((resolve) => { finish = resolve; }); });
  assert.equal(await submit("a", async () => { calls++; return "duplicate"; }), undefined);
  finish("created");
  assert.equal(await first, "created");
  assert.equal(await submit("a", async () => { calls++; return "duplicate"; }), undefined);
  await assert.rejects(submit("b", async () => { throw new Error("断网"); }), /断网/);
  assert.equal(await submit("b", async () => "created after retry"), "created after retry");
  assert.equal(calls, 1);
});

test("historical labels distinguish saved counts and export times without deriving current episodes", () => {
  const historic = jobs.map((job, index) => ({ ...job, sourceStatus: "unknown" as const, storyboardIds: Array.from({ length: index + 2 }, (_, i) => `removed-${i}`) }));
  const candidates = buildShowcaseCandidates("p", shots, images, historic);
  assert.match(candidates[0]!.label, /3 镜.*\d{2}-\d{2} \d{2}:\d{2}.*输入版本未核验/);
  assert.match(candidates[1]!.label, /2 镜.*\d{2}-\d{2} \d{2}:\d{2}.*输入版本未核验/);
  assert.doesNotMatch(candidates[0]!.label, /第.*集/);
  const sameTime = buildShowcaseCandidates("p", shots, images, [historic[0]!, { ...historic[0]!, id: "another-job" }]);
  assert.notEqual(sameTime[0]!.label, sameTime[1]!.label);
  const invalidTime = buildShowcaseCandidates("p", shots, images, [{ ...historic[0]!, id: "export_missingtime_12345678", createdAt: "invalid" }]);
  assert.match(invalidTime[0]!.label, /编号 12345678/);
});

test("rejected revision retains its original video selection and cannot borrow a new asset version", () => {
  const candidates = buildShowcaseCandidates("p", shots, images, jobs);
  const work = { id: "work-1", projectId: "p", status: "rejected", videoUrl: "/storage/e1.mp4", reviewNote: "请修改说明", updatedAt: "2026-09-12" } as ShowcaseWork;
  const revision = resolveShowcaseRevision("p", work, candidates);
  assert.equal(revision?.work, work);
  assert.equal(resolveShowcaseSelection(candidates, revision!.candidateKey)?.videoUrl, work.videoUrl);
  assert.equal(resolveShowcaseRevision("other", work, candidates), null);
  assert.equal(resolveShowcaseRevision("p", { ...work, status: "approved" }, candidates), null);
  assert.equal(resolveShowcaseRevision("p", { ...work, status: "pending" }, candidates), null);
  assert.equal(resolveShowcaseRevision("p", { ...work, videoUrl: "/storage/removed.mp4" }, candidates)?.candidateKey, "");
  assert.equal(canReviseShowcase({ status: "draft" }), true);
});

test("revision replaces one record and a later review round gets a fresh submission key", () => {
  const original = { id: "work-1", status: "rejected", reviewNote: "请修改说明", createdAt: "first", updatedAt: "round-1" } as ShowcaseWork;
  const updated = { ...original, status: "pending" as const, updatedAt: "round-2" };
  const other = { ...original, id: "work-2" };
  const records = mergeShowcaseRecord([original, other], updated);
  assert.equal(records.length, 2);
  assert.equal(records[0]?.id, original.id);
  assert.equal(records[0]?.reviewNote, original.reviewNote);
  assert.equal(records[0]?.createdAt, original.createdAt);
  assert.equal(records[1], other);
  assert.notEqual(showcaseSubmissionKey("candidate", original), showcaseSubmissionKey("candidate", updated));
  assert.notEqual(showcaseSubmissionKey("candidate"), showcaseSubmissionKey("candidate", original));
});
