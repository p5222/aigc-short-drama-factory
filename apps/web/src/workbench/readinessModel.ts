import type { ProjectWorkflow } from "@aifilm/shared";
import { isPersistedPlayableVideoReference } from "@aifilm/shared";
import { buildShotAssetMap, resolveCharacterIdentityAsset, type WorkbenchStage } from "./model.ts";

export interface StageGuidance {
  scope: string;
  title: string;
  detail: string;
  checks: Array<{ label: string; value: string; complete: boolean }>;
  next?: { stage: WorkbenchStage; label: string };
}

export function productionProgress(workflow: ProjectWorkflow, episodeNo: number | null) {
  const shots = workflow.storyboards.filter(shot => episodeNo === null || shot.episodeNo === episodeNo);
  const assets = (workflow.assets ?? []).filter(asset => !asset.isHistorical);
  const images = buildShotAssetMap(shots, assets, "image");
  const videos = buildShotAssetMap(shots, assets, "video");
  const imageCount = shots.filter(shot => images.get(shot.id)?.status === "succeeded" && images.get(shot.id)?.referenceUrl).length;
  const videoCount = shots.filter(shot => videos.get(shot.id)?.status === "succeeded" && isPersistedPlayableVideoReference(videos.get(shot.id)?.referenceUrl)).length;
  const identities = assets.filter(asset => asset.type === "role" || asset.type === "role_derivative");
  const roleCount = workflow.characters.filter(character => resolveCharacterIdentityAsset(character, identities)?.status === "succeeded").length;
  return { shots: shots.length, images: imageCount, videos: videoCount, roles: roleCount, characters: workflow.characters.length, script: Boolean(workflow.script?.content?.trim()) };
}

export function buildStageGuidance(workflow: ProjectWorkflow, stage: WorkbenchStage, episodeNo: number | null): StageGuidance {
  const p = productionProgress(workflow, episodeNo);
  const scope = episodeNo === null ? "全部分集" : `第 ${episodeNo} 集`;
  const script = { label: "项目剧本", value: p.script ? "已保存" : "待准备", complete: p.script };
  const roles = { label: "全剧角色定稿", value: p.characters ? `${p.roles} / ${p.characters}` : "无角色", complete: p.roles >= p.characters };
  const shots = { label: episodeNo === null ? "全部镜头" : "本集镜头", value: `${p.shots} 镜`, complete: p.shots > 0 };
  const images = { label: "有效首帧", value: `${p.images} / ${p.shots}`, complete: p.shots > 0 && p.images === p.shots };
  const videos = { label: "有效视频", value: `${p.videos} / ${p.shots}`, complete: p.shots > 0 && p.videos === p.shots };
  if (stage === "content") return {
    scope, title: "确认剧本，再进入画面制作",
    detail: "核对场次、动作与对白。保存修改后，先统一角色形象，再逐集拆解分镜。",
    checks: [script, shots],
    next: p.script ? { stage: p.characters ? "assets" : "shots", label: p.characters ? "下一步：角色与场景" : "下一步：拆解分镜" } : undefined
  };
  if (stage === "assets") return {
    scope: "全剧共用资产", title: p.roles < p.characters ? "先确认主角形象，再批量制作" : "把统一设定带入每一个镜头",
    detail: "上传参考图后仍需生成并核对角色定稿。检查服装、外貌与场景风格，再进入分镜。",
    checks: [roles, script], next: p.script ? { stage: "shots", label: "下一步：分镜与首帧" } : undefined
  };
  return {
    scope, title: !p.shots ? "先把这一集拆成镜头" : p.images < p.shots ? "先确认少量首帧，再补齐画面" : p.videos < p.shots ? "首帧已齐全，可以制作动态片段" : "片段已齐全，继续剪辑与交付",
    detail: !p.shots ? "选择需要制作的分集，拆解后核对镜头顺序、时长与台词。"
      : p.images < p.shots ? "建议先做 1–3 张首帧，确认角色和构图。失败镜头可单独重试，已有版本保留。"
      : "在成片阶段按镜头确认视频，调整顺序与时长，再按本集范围获取配音和导出报价。",
    checks: [shots, images, videos],
    next: p.images ? { stage: "delivery", label: "下一步：视频与成片" } : p.characters && p.roles < p.characters ? { stage: "assets", label: "先完善角色定稿" } : undefined
  };
}
