import assert from "node:assert/strict";
import test from "node:test";
import { resolveStoryboardReferenceAssets } from "./storyboardProduction.js";

test("first frame resolves approved character and scene references by names", () => {
  const workflow = {
    project: { artStyle: "国漫写实", videoRatio: "9:16" },
    characters: [{ id: "char_lw", name: "林晚", referenceAssetId: "role_lw_turnaround" }],
    assets: [
      { id: "role_lw_turnaround", type: "role_derivative", name: "林晚身份板", relatedCharacterId: "char_lw", referenceUrl: "/storage/linwan.png" },
      { id: "scene_room", type: "scene", name: "黎明前的青黑屋内", referenceUrl: "/storage/room.png" }
    ],
    storyboards: []
  } as any;
  const shot = { characters: ["林晚", "七日前"], scene: "关键场景：黎明前的青黑屋内", referenceAssetIds: [] } as any;
  assert.deepEqual(resolveStoryboardReferenceAssets(workflow, shot).map((asset) => asset.id), ["role_lw_turnaround", "scene_room"]);
});
