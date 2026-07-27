import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { prisma } from "../db/client.js";

interface PackageAsset { id: string; name: string; type: "character" | "scene" | "prop"; content: string }
interface PackageEpisode { episodeNo: number; title: string; script: string; storyboard: string; videoPrompt: string }
interface BeijingMarriagePackage {
  version: 2;
  importKey: string;
  title: string;
  sourceType: "script";
  description: string;
  production: { episodeDurationSeconds: number; sourceCharactersPerEpisode: number; segmentProfile: "jimeng_15s"; videoRatio: "16:9"; artStyle: string };
  episodes: PackageEpisode[];
  assets: { characters: PackageAsset[]; scenes: PackageAsset[]; props: PackageAsset[] };
}

export interface ImportedShot {
  episodeNo: number;
  shotNo: number;
  text: string;
  scene: string;
  characters: string[];
  referenceNames: string[];
  videoPrompt: string;
  boundaryType: "CONTINUE" | "CUT_SCENE";
}

function sections(content: string, heading: RegExp) {
  const matches = [...content.matchAll(heading)];
  return matches.map((match, index) => content.slice(match.index!, matches[index + 1]?.index ?? content.length));
}

function field(section: string, label: string) {
  return section.match(new RegExp(`\\*\\*${label}\\*\\*[：:]([^\\n]+)`))?.[1]?.trim() ?? "";
}

function namesFrom(value: string) {
  return value.split(/[、,，｜|]/).map((item) => item.replace(/@/g, "").trim()).filter((item) => item && item !== "无关键物品");
}

function promptByShot(content: string) {
  const result = new Map<number, string>();
  for (const section of sections(content, /^### 镜头\s*(\d+)\s*$/gm)) {
    const shotNo = Number(section.match(/^### 镜头\s*(\d+)/m)?.[1]);
    const prompt = section.match(/```text\s*([\s\S]*?)```/)?.[1]?.trim();
    if (shotNo && prompt) result.set(shotNo, prompt);
  }
  return result;
}

export function parseEpisodeShots(episode: PackageEpisode): ImportedShot[] {
  const prompts = promptByShot(episode.videoPrompt);
  let previousScene = "";
  return sections(episode.storyboard, /^## 镜头\s*(\d+)\s*$/gm).map((section) => {
    const shotNo = Number(section.match(/^## 镜头\s*(\d+)/m)?.[1]);
    const text = field(section, "镜头文案");
    const sceneValue = field(section, "场景");
    const scene = sceneValue.split(/[｜|]/)[0]?.trim() || "未命名场景";
    const characters = namesFrom(field(section, "角色").split(/[｜|]/)[0] ?? "");
    const props = namesFrom(field(section, "物品"));
    const boundaryType = !previousScene || previousScene !== scene ? "CUT_SCENE" as const : "CONTINUE" as const;
    previousScene = scene;
    return { episodeNo: episode.episodeNo, shotNo, text, scene, characters, referenceNames: [...characters, ...props], videoPrompt: prompts.get(shotNo) ?? "", boundaryType };
  });
}

export async function readBeijingMarriagePackage(path: string): Promise<BeijingMarriagePackage> {
  const parsed = JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, "")) as BeijingMarriagePackage;
  if (parsed.version !== 2 || parsed.importKey !== "manju:beijing-marriage:v1") throw new Error("北境婚书导入包版本无效");
  if (parsed.episodes.length !== 12 || parsed.episodes.some((episode, index) => episode.episodeNo !== index + 1)) throw new Error("北境婚书必须包含连续12集");
  if (parsed.assets.characters.length !== 6 || parsed.assets.scenes.length !== 18 || parsed.assets.props.length !== 10) throw new Error("北境婚书资产数量不完整");
  const shots = parsed.episodes.flatMap(parseEpisodeShots);
  if (shots.length !== 60 || shots.some((shot) => !shot.text || !shot.videoPrompt)) throw new Error("北境婚书必须包含60个完整分镜及视频提示词");
  return parsed;
}

function stableId(prefix: string, value: string) {
  return `${prefix}_${crypto.createHash("sha1").update(value).digest("hex").slice(0, 16)}`;
}

function assetDescription(content: string) {
  return content.replace(/^#.+$/m, "").trim().slice(0, 1600);
}

export async function importBeijingMarriage(input: { manifestPath: string; userEmail: string; dryRun?: boolean }) {
  const pkg = await readBeijingMarriagePackage(input.manifestPath);
  const shots = pkg.episodes.flatMap(parseEpisodeShots);
  if (input.dryRun) return { dryRun: true, episodes: pkg.episodes.length, shots: shots.length, characters: 6, scenes: 18, props: 10 };
  const user = await prisma.user.findUnique({ where: { email: input.userEmail } });
  if (!user) throw new Error(`导入归属账号不存在：${input.userEmail}`);

  const contentProjectId = "content_beijing_marriage";
  const productionProjectId = "proj_beijing_marriage";
  const allScript = pkg.episodes.map((episode) => `第${episode.episodeNo}集 ${episode.title}\n${episode.script}`).join("\n\n");
  const assetIdByName = new Map<string, string>();
  [...pkg.assets.characters, ...pkg.assets.scenes, ...pkg.assets.props].forEach((asset) => assetIdByName.set(asset.name, stableId(asset.type, asset.name)));

  await prisma.$transaction(async (tx) => {
    await tx.contentProject.upsert({
      where: { importKey: pkg.importKey },
      create: { id: contentProjectId, importKey: pkg.importKey, userId: user.id, title: pkg.title, mode: "adaptation", status: "confirmed", activeStep: "entity", productionProjectId, styleProfile: { name: pkg.production.artStyle } },
      update: { userId: user.id, title: pkg.title, status: "confirmed", activeStep: "entity", productionProjectId, styleProfile: { name: pkg.production.artStyle } }
    });
    await tx.sourceDocument.upsert({
      where: { id: "source_beijing_marriage_scripts" },
      create: { id: "source_beijing_marriage_scripts", contentProjectId, kind: "script", title: "北境婚书12集剧本", content: allScript, metadata: { importKey: pkg.importKey } },
      update: { content: allScript, metadata: { importKey: pkg.importKey } }
    });
    await tx.project.upsert({
      where: { id: productionProjectId },
      create: { id: productionProjectId, userId: user.id, name: pkg.title, type: "古风权谋", intro: pkg.description, sourceType: "script", artStyle: pkg.production.artStyle, videoRatio: pkg.production.videoRatio, status: "storyboarding", episodes: 12, storyboards: 60, characters: 6, segmentProfile: pkg.production.segmentProfile, episodeDurationSeconds: 180, sourceCharactersPerEpisode: 20000, allowExpansion: false },
      update: { userId: user.id, name: pkg.title, intro: pkg.description, artStyle: pkg.production.artStyle, videoRatio: pkg.production.videoRatio, status: "storyboarding", episodes: 12, storyboards: 60, characters: 6, segmentProfile: pkg.production.segmentProfile, episodeDurationSeconds: 180, sourceCharactersPerEpisode: 20000, allowExpansion: false }
    });
    await tx.scriptDraft.upsert({ where: { id: "script_beijing_marriage_active" }, create: { id: "script_beijing_marriage_active", projectId: productionProjectId, name: "北境婚书12集剧本", content: allScript, synopsis: pkg.description }, update: { content: allScript, synopsis: pkg.description } });

    for (const episode of pkg.episodes) {
      const episodeId = `episode_beijing_${episode.episodeNo}`;
      await tx.productionEpisode.upsert({
        where: { contentProjectId_episodeNo: { contentProjectId, episodeNo: episode.episodeNo } },
        create: { id: episodeId, contentProjectId, productionProjectId, episodeNo: episode.episodeNo, title: episode.title, sourceStart: 0, sourceEnd: episode.script.length, sourceCharacterCount: episode.script.replace(/\s/g, "").length, targetDurationSeconds: 180, status: "confirmed", activeScriptVersion: 1 },
        update: { productionProjectId, title: episode.title, sourceEnd: episode.script.length, sourceCharacterCount: episode.script.replace(/\s/g, "").length, status: "confirmed", activeScriptVersion: 1 }
      });
      await tx.episodeScriptVersion.upsert({
        where: { episodeId_version: { episodeId, version: 1 } },
        create: { id: `episode_script_beijing_${episode.episodeNo}_v1`, episodeId, version: 1, status: "confirmed", content: episode.script, structuredResult: { storyboard: episode.storyboard }, promptSnapshot: { source: "ai-manju-drama-production", importKey: pkg.importKey } },
        update: { status: "confirmed", content: episode.script, structuredResult: { storyboard: episode.storyboard } }
      });
    }

    for (const [index, asset] of pkg.assets.characters.entries()) {
      const id = assetIdByName.get(asset.name)!;
      await tx.character.upsert({ where: { id }, create: { id, projectId: productionProjectId, name: asset.name, identity: assetDescription(asset.content), appearance: assetDescription(asset.content), costume: "按角色资产锁定", personality: "按剧本表现", prompt: asset.content, negativePrompt: "换脸、换装、比例漂移、额外人物", consistencyLevel: "high", seed: 41000 + index }, update: { name: asset.name, identity: assetDescription(asset.content), appearance: assetDescription(asset.content), prompt: asset.content, consistencyLevel: "high" } });
    }
    for (const asset of [...pkg.assets.scenes, ...pkg.assets.props]) {
      const id = assetIdByName.get(asset.name)!;
      await tx.asset.upsert({ where: { id }, create: { id, projectId: productionProjectId, type: asset.type, name: asset.name, description: assetDescription(asset.content), prompt: asset.content, status: "pending" }, update: { name: asset.name, description: assetDescription(asset.content), prompt: asset.content } });
    }

    for (const shot of shots) {
      const id = `shot_beijing_${shot.episodeNo}_${shot.shotNo}`;
      const referenceAssetIds = shot.referenceNames.map((name) => assetIdByName.get(name)).filter((value): value is string => Boolean(value));
      const data = {
        projectId: productionProjectId, episodeNo: shot.episodeNo, sceneNo: shot.shotNo, shotNo: shot.shotNo, sequenceNo: shot.shotNo,
        duration: 15, startSeconds: (shot.shotNo - 1) * 15, endSeconds: shot.shotNo * 15, shotSize: "按提示词", cameraAngle: "按提示词", cameraMovement: "电影级轨道运镜", characters: shot.characters,
        scene: shot.scene, pictureDesc: shot.text, action: shot.text, dialogue: shot.text, voiceOver: "", environmentSound: "按剧本", soundEffect: "按剧本", imagePrompt: `首帧：${shot.text}`, videoPrompt: shot.videoPrompt,
        referenceAssetIds, status: "pending", segmentProfile: "jimeng_15s", promptVersion: "beijing-v1", boundaryType: shot.boundaryType,
        startState: shot.shotNo === 1 ? "本集建立镜头" : "承接上一镜审核状态", endState: shot.text, firstFramePrompt: `建立${shot.scene}的人物站位与动作起点`, lastFramePrompt: `保持人物、服装、光向和道具，停在：${shot.text}`,
        continuitySourceShotId: shot.boundaryType === "CONTINUE" ? `shot_beijing_${shot.episodeNo}_${shot.shotNo - 1}` : null
      };
      await tx.storyboard.upsert({ where: { id }, create: { id, ...data }, update: data });
    }
  });
  return { dryRun: false, contentProjectId, productionProjectId, episodes: 12, shots: 60, characters: 6, scenes: 18, props: 10 };
}
