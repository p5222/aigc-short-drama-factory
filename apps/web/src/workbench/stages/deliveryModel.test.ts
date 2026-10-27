import assert from "node:assert/strict";
import test from "node:test";
import type { AssetItem, ExportJob, StoryboardShot } from "@aifilm/shared";
import {
  applyShotOrder,
  buildDeliveryClipLayout,
  buildShotMediaIndex,
  clipLayout,
  collectDeliveryEpisodes,
  deliveryTimelineCanvas,
  fitPxPerSecond,
  formatTimecode,
  getDeliveryCandidates,
  getDeliveryExportState,
  getDeliveryStats,
  getExportSummary,
  getNextPlayableShotId,
  getRemainingVideoShots,
  getShotFailureMessage,
  normalizeShotDuration,
  normalizePersistedMediaUrl,
  playheadOffset,
  partitionDeliveryExportJobs,
  reduceDeliveryAutoPlay,
  reorder,
  resolveShotVideoStatus,
  resolveSingleDeliveryCandidate,
  rulerTicks,
  videoUnitCredits,
  waveformPoints
} from "./deliveryModel.ts";

const shot = (id: string, duration: number): StoryboardShot => ({ id, projectId: "p", episodeNo: 1, sceneNo: 1, shotNo: 1, duration, shotSize: "", cameraAngle: "", cameraMovement: "", characters: [], scene: "", pictureDesc: id, dialogue: "", voiceOver: "", environmentSound: "", soundEffect: "", imagePrompt: "", videoPrompt: "", referenceAssetIds: [], status: "succeeded" });
const asset = (id: string, shotId: string, url?: string): AssetItem => ({ id: `video_${shotId}`, projectId: "p", type: "video", name: id, description: "", prompt: "", referenceUrl: url, status: url ? "succeeded" : "failed" });

test("export uses only the displayed episode in its dragged order and blocks incomplete clips", () => {
  const storyboard = [shot("a", 2), shot("b", 3), { ...shot("c", 4), episodeNo: 2 }];
  const visible = applyShotOrder(storyboard.filter((item) => item.episodeNo === 1), ["b", "a"]);
  const ready = [asset("a", "a", "/storage/a.mp4"), asset("b", "b", "/storage/b.mp4")];
  assert.deepEqual(getDeliveryExportState(visible, ready), { storyboardIds: ["b", "a"], missingVideoCount: 0, canExportVideo: true });
  assert.equal(getDeliveryExportState(visible, [ready[0]!]).canExportVideo, false);
  assert.equal(getDeliveryExportState(visible, [ready[0]!, { ...ready[1]!, status: "running" }]).missingVideoCount, 1);
  assert.equal(getDeliveryExportState([], ready).canExportVideo, false);
});

test("normalizes invalid durations and lays clips sequentially", () => {
  assert.deepEqual(buildDeliveryClipLayout([shot("a", 0), shot("b", -2), shot("c", 3)]).map((clip) => ({ id: clip.id, start: clip.start, duration: clip.duration })), [
    { id: "a", start: 0, duration: 1 }, { id: "b", start: 1, duration: 1 }, { id: "c", start: 2, duration: 3 }
  ]);
  assert.equal(normalizeShotDuration(Number.NaN), 1);
  assert.deepEqual(buildDeliveryClipLayout([shot("a", 2), shot("b", 3)], 52, 96, new Map([["a", 5], ["b", Number.NaN]])).map((item) => item.duration), [5, 3]);
});

test("publishing resolves one latest MP4, otherwise one shot", () => {
  const shots = [shot("a", 2), shot("b", 4)];
  const assets = [asset("a", "a", "https://cdn.test/a.mp4"), asset("b", "b", "https://cdn.test/b.mp4")];
  const jobs: ExportJob[] = [{ id: "new", projectId: "p", type: "video_export", status: "succeeded", sourceStatus: "current", outputUrl: "https://cdn.test/new.mp4", outputKind: "mp4", createdAt: "2025-01-02", updatedAt: "2025-01-02" }];
  assert.equal(resolveSingleDeliveryCandidate(shots, assets, jobs)?.id, "export:new");
  assert.equal(resolveSingleDeliveryCandidate(shots, assets, [])?.id, "asset:video_a");
});

test("returns only persisted playable videos and latest successful mp4", () => {
  const shots = [shot("a", 2), shot("b", 4)];
  const assets = [asset("a", "a", "https://cdn.test/a.mp4"), asset("b", "b", "task-123")];
  const jobs: ExportJob[] = [
    { id: "old", projectId: "p", type: "video_export", status: "succeeded", sourceStatus: "current", outputUrl: "https://cdn.test/old.mp4", outputKind: "mp4", createdAt: "2025-01-01", updatedAt: "2025-01-01" },
    { id: "new", projectId: "p", type: "video_export", status: "succeeded", sourceStatus: "current", outputUrl: "https://cdn.test/new.mp4", outputKind: "mp4", createdAt: "2025-01-02", updatedAt: "2025-01-02" }
  ];
  assert.deepEqual(getDeliveryCandidates(shots, assets, jobs).map((candidate) => candidate.id), ["export:new", "asset:video_a"]);
  assert.equal(getNextPlayableShotId(shots, assets, ""), "a");
  assert.equal(getNextPlayableShotId(shots, assets, "b"), null);
});

test("summarizes export status, warnings and errors without hiding failures", () => {
  const summary = getExportSummary([{ id: "x", projectId: "p", type: "tts", status: "failed", warnings: ["缺少音频"], errorReason: "超时", createdAt: "", updatedAt: "" }]);
  assert.equal(summary.status, "failed");
  assert.deepEqual(summary.messages, ["缺少音频", "超时"]);
});

test("auto play targets the next playable clip exactly once and manual selection cancels", () => {
  const pending = reduceDeliveryAutoPlay(null, { type: "ended", shotId: "b", url: "https://cdn.test/b.mp4" });
  assert.deepEqual(pending, { shotId: "b", url: "https://cdn.test/b.mp4" });
  assert.equal(reduceDeliveryAutoPlay(pending, { type: "consumed", shotId: "b", url: "https://cdn.test/b.mp4" }), null);
  assert.equal(reduceDeliveryAutoPlay(pending, { type: "manual" }), null);
  assert.equal(reduceDeliveryAutoPlay(null, { type: "ended" }), null);
});

test("normalizes persisted media source identity across relative and absolute URLs", () => {
  assert.equal(normalizePersistedMediaUrl("/storage/clip.mp4?x=1#t", "https://manjiao.cloud"), normalizePersistedMediaUrl("https://manjiao.cloud/storage/clip.mp4?x=1#t", "https://manjiao.cloud"));
  assert.notEqual(normalizePersistedMediaUrl("https://cdn.other/storage/clip.mp4", "https://manjiao.cloud"), normalizePersistedMediaUrl("https://manjiao.cloud/storage/clip.mp4", "https://manjiao.cloud"));
  assert.notEqual(normalizePersistedMediaUrl("/storage/clip.mp4?x=1"), normalizePersistedMediaUrl("/storage/clip.mp4?x=2"));
});

/* ------------------------- Delivery V2 helper tests ------------------------ */

const rawAsset = (partial: Partial<AssetItem> & Pick<AssetItem, "id" | "type" | "status">): AssetItem => ({
  projectId: "p", name: partial.id, description: "", prompt: "", ...partial
});

test("clipLayout keeps width proportional to duration with a minimal clickable width", () => {
  const layout = clipLayout([shot("a", 2), shot("b", 10)], 10);
  assert.deepEqual(layout.map((clip) => clip.width), [20, 100]);
  assert.deepEqual(layout.map((clip) => clip.start), [0, 2]);
  assert.equal(clipLayout([shot("tiny", 1)], 8)[0]!.width, 16);
});

test("reorder moves items, clamps target and rejects invalid source", () => {
  assert.deepEqual(reorder(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
  assert.deepEqual(reorder(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
  assert.deepEqual(reorder(["a", "b", "c"], 1, 99), ["a", "c", "b"]);
  assert.deepEqual(reorder(["a", "b", "c"], 9, 0), ["a", "b", "c"]);
  assert.deepEqual(reorder(["a", "b", "c"], 1, 1), ["a", "b", "c"]);
});

test("applyShotOrder ignores unknown ids and appends shots missing from the order", () => {
  const shots = [shot("a", 1), shot("b", 1), shot("c", 1)];
  assert.deepEqual(applyShotOrder(shots, ["c", "ghost", "a"]).map((item) => item.id), ["c", "a", "b"]);
  assert.deepEqual(applyShotOrder(shots, []).map((item) => item.id), ["a", "b", "c"]);
});

test("fitPxPerSecond fills the container and clamps to the 8-40 zoom range", () => {
  assert.equal(fitPxPerSecond(400, 20), 20);
  assert.equal(fitPxPerSecond(100000, 10), 40);
  assert.equal(fitPxPerSecond(40, 100), 8);
  assert.equal(fitPxPerSecond(400, 0), 16);
  assert.equal(fitPxPerSecond(0, 10), 16);
});

test("playheadOffset accumulates rendered widths and clamps progress inside the clip", () => {
  const layout = clipLayout([shot("a", 2), shot("b", 3)], 10);
  assert.equal(playheadOffset(layout, "a", 1, 10), 10);
  assert.equal(playheadOffset(layout, "b", 1, 10), layout[0]!.width + 10);
  assert.equal(playheadOffset(layout, "b", 99, 10), layout[0]!.width + layout[1]!.width);
  assert.equal(playheadOffset(layout, "missing", 1, 10), 0);
});

test("rulerTicks covers the total duration in 4s steps including the trailing tick", () => {
  assert.deepEqual(rulerTicks(10), [0, 4, 8, 12]);
  assert.deepEqual(rulerTicks(8), [0, 4, 8]);
  assert.deepEqual(rulerTicks(0), [0, 4]);
  assert.deepEqual(rulerTicks(5, 2), [0, 2, 4, 6]);
});

test("formatTimecode renders m:ss and optional tenths", () => {
  assert.equal(formatTimecode(0), "0:00");
  assert.equal(formatTimecode(65), "1:05");
  assert.equal(formatTimecode(3.46, true), "0:03.4");
  assert.equal(formatTimecode(Number.NaN), "0:00");
});

test("resolveShotVideoStatus mirrors asset lifecycle including queued task references", () => {
  assert.equal(resolveShotVideoStatus(undefined), "missing");
  assert.equal(resolveShotVideoStatus(asset("a", "a", "https://cdn.test/a.mp4")), "succeeded");
  assert.equal(resolveShotVideoStatus(asset("b", "b")), "failed");
  assert.equal(resolveShotVideoStatus(rawAsset({ id: "video_c", type: "video", status: "running", referenceUrl: "task-1" })), "running");
  assert.equal(resolveShotVideoStatus(rawAsset({ id: "video_d", type: "video", status: "succeeded", referenceUrl: "task-2" })), "missing");
  assert.equal(resolveShotVideoStatus(rawAsset({ id: "video_e", type: "video", status: "succeeded", referenceUrl: "" })), "missing");
});

test("buildShotMediaIndex resolves audio and subtitle assets by shot id convention", () => {
  const shots = [shot("a", 2), shot("b", 2)];
  const assets = [
    rawAsset({ id: "audio_a", type: "audio", status: "succeeded", referenceUrl: "/storage/a.mp3" }),
    rawAsset({ id: "subtitle_b", type: "subtitle", status: "succeeded", referenceUrl: "/storage/b.srt" })
  ];
  assert.equal(buildShotMediaIndex(shots, assets, "audio").get("a")?.id, "audio_a");
  assert.equal(buildShotMediaIndex(shots, assets, "audio").has("b"), false);
  assert.equal(buildShotMediaIndex(shots, assets, "subtitle").get("b")?.id, "subtitle_b");
});

test("getDeliveryStats counts videos, falls back to full-track tts audio and detects subtitles", () => {
  const shots = [shot("a", 2), shot("b", 4)];
  const assets = [asset("a", "a", "https://cdn.test/a.mp4"), asset("b", "b")];
  const none = getDeliveryStats(shots, assets, []);
  assert.deepEqual([none.total, none.videoReady, none.audioCovered, none.hasTrackAudio, none.hasSubtitle], [2, 1, 0, false, false]);
  const jobs: ExportJob[] = [
    { id: "t", projectId: "p", type: "tts", status: "succeeded", sourceStatus: "current", storyboardIds: ["a", "b"], audioUrl: "/storage/tts.mp3", createdAt: "", updatedAt: "" },
    { id: "s", projectId: "p", type: "subtitle", status: "succeeded", sourceStatus: "current", storyboardIds: ["a", "b"], subtitleUrl: "/storage/sub.srt", createdAt: "", updatedAt: "" }
  ];
  const full = getDeliveryStats(shots, assets, jobs);
  assert.deepEqual([full.audioCovered, full.hasTrackAudio, full.hasSubtitle], [2, true, true]);
  const perShot = getDeliveryStats(shots, [...assets, rawAsset({ id: "audio_a", type: "audio", status: "succeeded", referenceUrl: "/storage/a.mp3" })], jobs);
  assert.equal(perShot.audioCovered, 2);
});

test("export scope requires exact order and excludes unknown historical ranges", () => {
  const base: ExportJob = { id: "current", projectId: "p", type: "tts", status: "succeeded", sourceStatus: "current", audioUrl: "/storage/audio.mp3", createdAt: "", updatedAt: "", storyboardIds: ["b", "a"] };
  const jobs = [base, { ...base, id: "reordered", storyboardIds: ["a", "b"] }, { ...base, id: "other-episode", storyboardIds: ["c"] }, { ...base, id: "history", storyboardIds: undefined }];
  const scoped = partitionDeliveryExportJobs(jobs, ["b", "a"]);
  assert.deepEqual(scoped.current.map((job) => job.id), ["current"]);
  assert.deepEqual(scoped.other.map((job) => job.id), ["reordered", "other-episode"]);
  assert.deepEqual(scoped.history.map((job) => job.id), ["history"]);
  assert.equal(getDeliveryStats([shot("a", 2), shot("b", 4)], [], [base, jobs[3]!]).hasTrackAudio, false);
});

test("project-wide legacy audio assets never mark another episode complete", () => {
  const shots = [shot("a", 2), shot("b", 4)];
  const assets = [rawAsset({ id: "project_audio", type: "audio", status: "succeeded", referenceUrl: "/storage/old.mp3" }), rawAsset({ id: "project_subtitle", type: "subtitle", status: "succeeded", referenceUrl: "/storage/old.srt" })];
  assert.deepEqual(getDeliveryStats(shots, assets, []), { total: 2, videoReady: 0, audioCovered: 0, hasTrackAudio: false, hasSubtitle: false });
});

test("changed and unverified exports remain downloadable history but cannot satisfy current delivery", () => {
  const shots = [shot("a", 2), shot("b", 4)];
  const base: ExportJob = { id: "old", projectId: "p", type: "video_export", status: "succeeded", outputUrl: "/storage/old.mp4", outputKind: "mp4", audioUrl: "/storage/old.mp3", subtitleUrl: "/storage/old.srt", storyboardIds: ["a", "b"], createdAt: "", updatedAt: "" };
  for (const sourceStatus of ["stale", "unknown", undefined] as const) {
    const jobs = [{ ...base, sourceStatus }];
    const partition = partitionDeliveryExportJobs(jobs, ["a", "b"]);
    assert.equal(partition.current.length, 0);
    assert.equal(partition.history[0]?.outputUrl, "/storage/old.mp4");
    assert.equal(getDeliveryCandidates(shots, [], jobs).length, 0);
    assert.equal(getDeliveryStats(shots, [], jobs).audioCovered, 0);
    assert.equal(getDeliveryStats(shots, [], jobs).hasSubtitle, false);
  }
  const running = { ...base, id: "running", status: "running" as const };
  assert.equal(partitionDeliveryExportJobs([running], ["a", "b"]).current[0]?.id, "running");
});

test("getRemainingVideoShots mirrors server eligibility: no playable video and an existing frame image", () => {
  const shots = [shot("a", 2), shot("b", 2), shot("c", 2)];
  const assets = [
    asset("a", "a", "https://cdn.test/a.mp4"),
    rawAsset({ id: "image_a", type: "image", status: "succeeded", referenceUrl: "/storage/a.png" }),
    rawAsset({ id: "image_b", type: "image", status: "succeeded", referenceUrl: "/storage/b.png" })
  ];
  assert.deepEqual(getRemainingVideoShots(shots, assets).map((item) => item.id), ["b"]);
});

test("remaining submissions exclude failed, missing or temporary frames and videos still generating", () => {
  const shots = ["failed-frame", "no-url", "blob", "running", "ready"].map(id => shot(id, 2));
  const frames = shots.map(item => rawAsset({ id: `image_${item.id}`, type: "image", status: "succeeded", referenceUrl: "/storage/frame.png" }));
  frames[0].status = "failed";
  frames[1].referenceUrl = undefined;
  frames[2].referenceUrl = "blob:temporary";
  const assets = [...frames, rawAsset({ id: "video_running", type: "video", status: "running" })];
  assert.deepEqual(getRemainingVideoShots(shots, assets).map(item => item.id), ["ready"]);
});

test("getShotFailureMessage prefers provider error on the asset, then task errorReason, then a safe default", () => {
  const failed = rawAsset({ id: "video_a", type: "video", status: "failed", description: "余额不足：视频渠道拒绝任务" });
  assert.equal(getShotFailureMessage(failed, []), "余额不足：视频渠道拒绝任务");
  const defaultDescription = rawAsset({ id: "video_b", type: "video", status: "failed", description: "基于分镜图生成视频：某镜头" });
  const tasks = [
    { id: "t1", type: "video", title: "图生视频生成", provider: "p", model: "m", status: "failed", progress: 0, estimatedCredits: 0, errorReason: "上游超时", createdAt: "2025-01-01", updatedAt: "2025-01-01" },
    { id: "t2", type: "video", title: "图生视频生成", provider: "p", model: "m", status: "failed", progress: 0, estimatedCredits: 0, errorReason: "配额已用尽", createdAt: "2025-01-02", updatedAt: "2025-01-02" }
  ] as never[];
  assert.equal(getShotFailureMessage(defaultDescription, tasks), "配额已用尽");
  assert.equal(getShotFailureMessage(undefined, []), "生成失败，可重试");
});

test("videoUnitCredits displays only an exact unambiguous route price", () => {
  const prices = [
    { id: "1", providerId: "dashscope-video", providerName: "百炼", modality: "video", model: "wan", unit: "video_second", unitCredits: 16, vendorCostCny: 0.2, enabled: true },
    { id: "2", providerId: "other", providerName: "其他", modality: "video", model: "wan-turbo", unit: "video_second", unitCredits: 9, vendorCostCny: 0.1, enabled: true },
    { id: "3", providerId: "off", providerName: "禁用", modality: "video", model: "off-model", unit: "video_second", unitCredits: 99, vendorCostCny: 1, enabled: false }
  ] as never[];
  assert.equal(videoUnitCredits(prices, "dashscope-video", "wan"), 16);
  assert.equal(videoUnitCredits(prices, "unknown-provider", "wan-turbo"), undefined);
  assert.equal(videoUnitCredits(prices, "off", "off-model"), undefined);
  assert.equal(videoUnitCredits([...prices, prices[0]!], "dashscope-video", "wan"), undefined);
});

test("collectDeliveryEpisodes dedupes episode numbers with a fallback range", () => {
  const shots = [shot("a", 1), shot("b", 1), shot("c", 1)];
  shots[0]!.episodeNo = 2; shots[1]!.episodeNo = 1; shots[2]!.episodeNo = 2;
  assert.deepEqual(collectDeliveryEpisodes(shots), [1, 2]);
  assert.deepEqual(collectDeliveryEpisodes([], 3), [1, 2, 3]);
});

test("waveformPoints is deterministic, bounded and polyline-ready", () => {
  const first = waveformPoints("audio_a", 120, 28, 12);
  assert.equal(first, waveformPoints("audio_a", 120, 28, 12));
  assert.notEqual(first, waveformPoints("audio_b", 120, 28, 12));
  const pairs = first.split(" ").map((pair) => pair.split(",").map(Number));
  assert.equal(pairs.length, 13);
  for (const [x, y] of pairs) {
    assert.ok(x! >= 0 && x! <= 120);
    assert.ok(y! >= 0 && y! <= 28);
  }
});


test("short timelines retain the viewport for track labels and empty states without stretching clips", () => {
  const clips = clipLayout([shot("short-a", 1), shot("short-b", 1)], 16);
  assert.deepEqual(clips.map(clip => clip.width), [16, 16]);
  const canvas = deliveryTimelineCanvas(1422, clips.reduce((sum, clip) => sum + clip.width, 0));
  assert.equal(canvas.contentWidth, 1422);
  assert.equal(canvas.laneWidth, 1334);
  assert.equal(canvas.labelWidth, 64);
  assert.equal(deliveryTimelineCanvas(375, 32).laneWidth, 287);
});

test("long timelines scroll without truncating clips and invalid measurements use a readable baseline", () => {
  assert.equal(deliveryTimelineCanvas(375, 2400).laneWidth, 2448);
  assert.equal(deliveryTimelineCanvas(375, 2400).contentWidth, 2536);
  assert.equal(deliveryTimelineCanvas(Number.NaN, Number.NaN).laneWidth, 240);
  assert.equal(deliveryTimelineCanvas(-1, -1).contentWidth, 328);
});
