import type { SegmentProfile, StoryboardShot } from "@aifilm/shared";

export interface StoryboardProfileDefinition {
  id: SegmentProfile;
  label: string;
  durationSeconds: 10 | 15;
  timingBands: ReadonlyArray<readonly [number, number]>;
}

const profiles: Record<SegmentProfile, StoryboardProfileDefinition> = {
  jimeng_15s: { id: "jimeng_15s", label: "即梦 15 秒", durationSeconds: 15, timingBands: [[0, 4], [4, 8], [8, 12], [12, 15]] },
  doubao_10s: { id: "doubao_10s", label: "豆包 10 秒", durationSeconds: 10, timingBands: [[0, 3], [3, 7], [7, 10]] }
};

export function profileFor(profile: SegmentProfile) {
  return profiles[profile];
}

export function renderProfiledVideoPrompt(input: {
  profile: SegmentProfile;
  shot: Pick<StoryboardShot, "pictureDesc" | "action" | "dialogue" | "environmentSound" | "soundEffect" | "shotSize" | "cameraMovement" | "scene" | "characters" | "referenceAssetIds">;
  previousEndState?: string;
  firstFramePrompt: string;
  lastFramePrompt: string;
}) {
  const profile = profileFor(input.profile);
  const action = input.shot.action || input.shot.pictureDesc;
  const timeline = profile.timingBands.map(([start, end], index) => {
    const detail = index === 0
      ? `承接首帧，建立${input.shot.scene}内的人物站位与动作起点`
      : index === profile.timingBands.length - 1
        ? `完成“${action}”，稳定停在指定尾帧状态`
        : `连续推进“${action}”，保持人物身份、服装、光向和道具位置`;
    return `[${start}-${end}秒] ${input.shot.shotSize}，${input.shot.cameraMovement || "稳定运镜"}；${detail}。`;
  });
  return [
    `${profile.durationSeconds}秒，4K，60帧，画面连贯，无字幕、无水印、无Logo。`,
    `角色资产：${input.shot.referenceAssetIds.join("、") || input.shot.characters.join("、")}。`,
    `首帧：${input.firstFramePrompt}`,
    input.previousEndState ? `承接上一片段结束状态：${input.previousEndState}` : "首个片段，建立人物与空间关系。",
    ...timeline,
    input.shot.dialogue ? `中文对白：${input.shot.dialogue}；只生成语音，禁止字幕。` : "",
    [input.shot.environmentSound, input.shot.soundEffect].filter(Boolean).length ? `声音：${[input.shot.environmentSound, input.shot.soundEffect].filter(Boolean).join("；")}。` : "",
    `尾帧：${input.lastFramePrompt}`,
    "当前剧本是唯一剧情来源，不新增人物、场景、道具、动作或心理活动。"
  ].filter(Boolean).join("\n");
}
