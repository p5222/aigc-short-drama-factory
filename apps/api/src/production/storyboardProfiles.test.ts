import assert from "node:assert/strict";
import test from "node:test";
import { profileFor, renderProfiledVideoPrompt } from "./storyboardProfiles.js";

test("defines selectable Jimeng and Doubao timing profiles", () => {
  assert.deepEqual(profileFor("jimeng_15s").timingBands, [[0, 4], [4, 8], [8, 12], [12, 15]]);
  assert.deepEqual(profileFor("doubao_10s").timingBands, [[0, 3], [3, 7], [7, 10]]);
});

test("renders only the selected profile without contaminated example content", () => {
  const prompt = renderProfiledVideoPrompt({
    profile: "doubao_10s",
    shot: { pictureDesc: "婚车穿过暴雪", action: "谢明鸢握紧银簪刀", dialogue: "城门到了", environmentSound: "风雪声", soundEffect: "车轮声", shotSize: "中景", cameraMovement: "跟拍", scene: "北境城门", characters: ["谢明鸢"], referenceAssetIds: ["CHAR_XIE"] },
    previousEndState: "婚车驶近城门",
    firstFramePrompt: "婚车位于画面左侧",
    lastFramePrompt: "银簪刀稳定在掌心"
  });
  assert.match(prompt, /^10秒/);
  assert.match(prompt, /在10秒内自然完成一次/);
  assert.doesNotMatch(prompt, /班长|递笔|晚自习|15秒/);
});

test("motion prompt honors shot duration and the author's edited prompt", () => {
  const prompt = renderProfiledVideoPrompt({ profile: "jimeng_15s",
    shot: { duration: 4, videoPrompt: "手指停在信封封口，镜头固定", pictureDesc: "书桌", action: "抬起信封", dialogue: "", environmentSound: "", soundEffect: "", shotSize: "近景", cameraMovement: "固定", scene: "书房", characters: ["阿青"], referenceAssetIds: [] },
    firstFramePrompt: "信封放在桌上", lastFramePrompt: "信封停在半空" });
  assert.match(prompt, /^4秒/);
  assert.match(prompt, /手指停在信封封口/);
  assert.doesNotMatch(prompt, /15秒|60帧|4K|首个片段|下一段继承/);
});
