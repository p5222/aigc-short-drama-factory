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
  shot: Pick<StoryboardShot, "pictureDesc" | "action" | "dialogue" | "environmentSound" | "soundEffect" | "shotSize" | "cameraMovement" | "scene" | "characters" | "referenceAssetIds"> & Partial<Pick<StoryboardShot, "duration" | "videoPrompt" | "voiceOver">>;
  previousEndState?: string;
  firstFramePrompt: string;
  lastFramePrompt: string;
}) {
  const profile = profileFor(input.profile);
  const action = input.shot.action || input.shot.pictureDesc;
  const duration = input.shot.duration ?? profile.durationSeconds;
  if (!Number.isFinite(duration) || duration < 1 || duration > 15) throw new Error("镜头时长须在1至15秒内，请先拆分镜头。");
  return [
    `${duration}秒连续镜头。${input.shot.shotSize}；${input.shot.cameraMovement || "固定机位"}。`,
    `角色资产：${input.shot.referenceAssetIds.join("、") || input.shot.characters.join("、")}。`,
    `首帧：${input.firstFramePrompt}`,
    input.previousEndState ? `承接上一片段结束状态：${input.previousEndState}` : "以本镜已提供的首帧作为空间和人物状态依据。",
    `主体动作：${action}。在${duration}秒内自然完成一次，结尾短暂停稳。`,
    input.shot.videoPrompt ? `作者确认的运动描述：${input.shot.videoPrompt}` : "",
    input.shot.dialogue || input.shot.voiceOver ? "本镜包含后期配音，表演节奏为说话与反应留时。" : "",
    [input.shot.environmentSound, input.shot.soundEffect].filter(Boolean).length ? `声音设计参考（后期核对）：${[input.shot.environmentSound, input.shot.soundEffect].filter(Boolean).join("；")}。` : "",
    `尾帧：${input.lastFramePrompt}`,
    "当前剧本是唯一剧情来源，不新增人物、场景、道具、动作或心理活动。"
  ].filter(Boolean).join("\n");
}
