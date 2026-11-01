import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectWorkflow } from "@aifilm/shared";
import { buildSpeechTimeline } from "./speechTimeline.js";
import { buildLingGuoSrt, buildLingGuoTtsManifest } from "./lingguoAdapter.js";
import { buildExportSrt, buildVoiceCues } from "../export/videoComposer.js";

function fixture() {
  return {
    project: { id: "speech-test", name: "Speech" }, tasks: [], assets: [],
    characters: [{ name: "林", voiceId: "voice-lin" }, { name: "小周", voiceId: "voice-zhou" }],
    storyboards: [
      { id: "silent", duration: 0.5, characters: [], pictureDesc: "门在风里缓缓关上", dialogue: "", voiceOver: "", episodeNo: 1, sceneNo: 1, shotNo: 1 },
      { id: "talk", duration: 6.25, characters: ["林", "小周"], dialogue: "林（低声）：留下吧。\n小周：（停顿）我等你。", voiceOver: "旁白：灯还亮着。", episodeNo: 1, sceneNo: 1, shotNo: 2 }
    ]
  } as unknown as ProjectWorkflow;
}

test("speech, subtitles and voice manifests retain each speaker plus narration on one timeline", () => {
  const workflow = fixture();
  const cues = buildSpeechTimeline(workflow);
  assert.equal(new Set(cues.map(cue => cue.cueId)).size, 4);
  assert.deepEqual(cues.map(cue => cue.text), ["", "留下吧。", "我等你。", "灯还亮着。"]);
  assert.deepEqual(cues.map(cue => cue.speaker), ["静音", "林", "小周", "旁白"]);
  assert.deepEqual(cues.map(cue => cue.suggestedVoiceId), [undefined, "voice-lin", "voice-zhou", undefined]);
  assert.equal(cues[1].start, 0.5);
  assert.equal(cues.at(-1)!.end, 6.75);
  assert.ok(cues.slice(1).every((cue, index) => cue.start === cues[index].end && cue.duration > 0));
  const srt = buildExportSrt(workflow);
  assert.equal(srt, buildLingGuoSrt(workflow));
  assert.doesNotMatch(srt, /门在风里|低声|停顿|林|小周|旁白/);
  assert.match(srt, /3\n.* --> 00:00:06,750\n灯还亮着。/);
  assert.deepEqual(buildLingGuoTtsManifest(workflow).items.map(cue => cue.cueId), buildVoiceCues(workflow).map(cue => cue.cueId));
});

test("same-line speakers split; spoken parentheses and natural colons survive", () => {
  const workflow = fixture();
  workflow.storyboards[1].dialogue = "林：“注意：请用电话（备用）。” 小周：“知道了。”";
  const cues = buildSpeechTimeline(workflow);
  assert.equal(cues[1].text, "注意：请用电话（备用）。");
  assert.equal(cues[2].text, "知道了。");
  workflow.storyboards[1].dialogue = "注意：门外有人。";
  assert.equal(buildSpeechTimeline(workflow)[1].text, "注意：门外有人。");
});

test("silent projects never turn image descriptions into dialogue or subtitles", () => {
  const workflow = fixture();
  workflow.storyboards.forEach(shot => { shot.dialogue = "无对白"; shot.voiceOver = "（无）"; });
  assert.equal(buildExportSrt(workflow), "");
  assert.ok(buildVoiceCues(workflow).every(cue => !cue.text));
});
