import assert from "node:assert/strict";
import test from "node:test";
import type { AssetItem, ExportJob, StoryboardShot } from "@aifilm/shared";
import { buildShowcaseCandidates, createShowcaseSubmitGuard, resolveShowcaseSelection, showcaseCandidateKey } from "./showcasePublishModel.ts";

const shots = [1, 2].map((episodeNo) => ({ id: `s${episodeNo}`, projectId: "p", episodeNo, shotNo: 1, duration: episodeNo * 5 } as StoryboardShot));
const images = shots.map((shot) => ({ id: `image_${shot.id}`, projectId: "p", type: "image", status: "succeeded", referenceUrl: `/storage/${shot.id}.jpg` } as AssetItem));
const jobs = [1, 2].map((episode) => ({ id: `j${episode}`, projectId: "p", type: "video_export", status: "succeeded", outputKind: "mp4", outputUrl: `/storage/e${episode}.mp4`, storyboardIds: [`s${episode}`], createdAt: `2026-01-0${episode}`, updatedAt: `2026-01-0${episode}` } as ExportJob));

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
