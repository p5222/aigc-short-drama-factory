import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

const testDatabaseUrl = process.env.AIFILM_TEST_DATABASE_URL;

test("content production handoff reuses its project, entities and produced assets without billing", { skip: !testDatabaseUrl }, async () => {
  const url = new URL(testDatabaseUrl!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_credits_[a-z0-9_]+$/i);
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.AIFILM_LOAD_ENV_FILES = "false";
  const { prisma: db } = await import("../db/client.js");
  const { syncContentToProduction } = await import("./service.js");
  const userId = `audit_sync_${crypto.randomUUID()}`;
  const contentId = `audit_sync_content_${crypto.randomUUID()}`;
  let projectId = "";
  try {
    await db.user.create({ data: { id: userId, name: "Handoff regression", credit: { create: { id: `credit_${crypto.randomUUID()}`, balance: 100 } } } });
    await db.contentProject.create({ data: {
      id: contentId, userId, title: "旧车站", mode: "original", textProvider: "test-text", textModel: "test-model",
      scripts: { create: { id: `script_${crypto.randomUUID()}`, content: "地点：旧车站\n小雨：我修好了怀表。\n阿青：那我们出发。", result: {}, promptSnapshot: {} } },
      entities: { create: {
        id: `catalog_${crypto.randomUUID()}`,
        characters: [{ id: "xiaoyu", name: "小雨", description: "修表师" }],
        scenes: [{ id: "station", name: "旧车站", description: "废弃铁路车站" }],
        props: [{ id: "watch", name: "怀表", description: "刻有日期的怀表" }], promptSnapshot: {}
      } }
    } });
    projectId = await syncContentToProduction(userId, contentId);
    assert.equal(await db.project.count({ where: { userId } }), 1);
    assert.equal(await db.character.count({ where: { projectId } }), 2);
    assert.equal(await db.asset.count({ where: { projectId } }), 4);
    const role = await db.character.findFirstOrThrow({ where: { projectId, name: "小雨" } });
    const roleAsset = await db.asset.findFirstOrThrow({ where: { projectId, relatedCharacterId: role.id } });
    await db.character.update({ where: { id: role.id }, data: { costume: "用户已确认的蓝色工作服" } });
    await db.asset.update({ where: { id: roleAsset.id }, data: { status: "succeeded", referenceUrl: "/storage/verified-role.png" } });
    const secondId = await syncContentToProduction(userId, contentId);
    assert.equal(secondId, projectId);
    assert.equal(await db.project.count({ where: { userId } }), 1);
    assert.equal(await db.character.count({ where: { projectId } }), 2);
    assert.equal(await db.asset.count({ where: { projectId } }), 4);
    assert.equal((await db.character.findUniqueOrThrow({ where: { id: role.id } })).costume, "用户已确认的蓝色工作服");
    assert.equal((await db.asset.findUniqueOrThrow({ where: { id: roleAsset.id } })).referenceUrl, "/storage/verified-role.png");
    assert.equal(await db.creditTransaction.count({ where: { userId } }), 0);
    assert.equal((await db.creditAccount.findUniqueOrThrow({ where: { userId } })).balance, 100);
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: projectId } })).characters, 2);

    await db.storyboard.create({ data: { id: `shot_${crypto.randomUUID()}`, projectId, episodeNo: 1, sceneNo: 1, shotNo: 1, duration: 5, shotSize: "中景", cameraAngle: "平视", cameraMovement: "静止", characters: ["小雨"], scene: "旧车站", pictureDesc: "修表", dialogue: "修好了", voiceOver: "", environmentSound: "", soundEffect: "", imagePrompt: "", videoPrompt: "", referenceAssetIds: [], status: "draft" } });
    const oldScript = await db.scriptDraft.findFirstOrThrow({ where: { projectId } });
    await db.scriptVersion.create({ data: { id: `script_${crypto.randomUUID()}`, contentProjectId: contentId, version: 2, content: "不同版本的剧本", result: {}, promptSnapshot: {} } });
    await assert.rejects(syncContentToProduction(userId, contentId), /已进入分镜制作/);
    assert.equal((await db.scriptDraft.findUniqueOrThrow({ where: { id: oldScript.id } })).content, oldScript.content);
    assert.equal((await db.asset.findUniqueOrThrow({ where: { id: roleAsset.id } })).referenceUrl, "/storage/verified-role.png");
    await assert.rejects(syncContentToProduction("another-user", contentId), /内容项目不存在/);
  } finally {
    await db.contentProject.deleteMany({ where: { id: contentId, userId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  }
});
