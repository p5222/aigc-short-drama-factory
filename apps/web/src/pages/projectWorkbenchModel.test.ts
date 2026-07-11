import assert from "node:assert/strict";
import test from "node:test";
import type { StoryboardShot } from "@aifilm/shared";
import { buildTimelineClipLayout, collectEpisodeNumbers, filterSceneRows, resolveSceneSelection } from "./projectWorkbenchModel.ts";

function shot(id: string, episodeNo: number, sceneNo: number, duration: number): StoryboardShot {
  return {
    id,
    projectId: "project-1",
    episodeNo,
    sceneNo,
    shotNo: 1,
    duration,
    shotSize: "中景",
    cameraAngle: "平视",
    cameraMovement: "固定",
    characters: [],
    scene: `场景 ${sceneNo}`,
    pictureDesc: "",
    dialogue: "",
    voiceOver: "",
    environmentSound: "",
    soundEffect: "",
    imagePrompt: "",
    videoPrompt: "",
    referenceAssetIds: [],
    status: "pending"
  };
}

test("collects distinct episodes without mixing scene selection", () => {
  const shots = [shot("e1-s1", 1, 1, 4), shot("e2-s1", 2, 1, 3), shot("e2-s2", 2, 2, 5)];
  assert.deepEqual(collectEpisodeNumbers(shots, 6), [1, 2]);

  const rows = [
    { id: "scene-1-1", episodeNo: 1, status: "ready" as const },
    { id: "scene-2-1", episodeNo: 2, status: "ready" as const },
    { id: "scene-2-2", episodeNo: 2, status: "risk" as const, risk: "角色未绑定" }
  ];
  assert.deepEqual(filterSceneRows(rows, 2, "all").map((row) => row.id), ["scene-2-1", "scene-2-2"]);
  assert.equal(resolveSceneSelection(rows, 2, "all", "scene-1-1").selectedId, "scene-2-1");
  assert.equal(resolveSceneSelection(rows, 2, "risk", "scene-2-1").selectedId, "scene-2-2");
  assert.equal(rows.filter((row) => row.id === resolveSceneSelection(rows, 2, "all", "scene-2-2").selectedId).length, 1);
});

test("lays timeline clips sequentially using real durations", () => {
  const layout = buildTimelineClipLayout([
    shot("shot-1", 1, 1, 2),
    shot("shot-2", 1, 1, 7),
    shot("shot-3", 1, 2, 1)
  ], 40, 80);

  assert.deepEqual(layout.map(({ id, start, duration, width }) => ({ id, start, duration, width })), [
    { id: "shot-1", start: 0, duration: 2, width: 80 },
    { id: "shot-2", start: 2, duration: 7, width: 280 },
    { id: "shot-3", start: 9, duration: 1, width: 80 }
  ]);
});
