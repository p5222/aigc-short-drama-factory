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
  assert.match(prompt, /\[7-10秒\]/);
  assert.doesNotMatch(prompt, /班长|递笔|晚自习|15秒/);
});
