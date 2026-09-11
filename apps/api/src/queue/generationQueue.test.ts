import assert from "node:assert/strict";
import test from "node:test";

test("generation worker becomes ready and can restart after closing", { skip: !process.env.AIFILM_TEST_REDIS_URL }, async () => {
  const url = new URL(process.env.AIFILM_TEST_REDIS_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.ok(Number(url.pathname.slice(1)) >= 10, "Use a separate Redis database numbered 10 or higher");
  process.env.AIFILM_LOAD_ENV_FILES = "false";
  process.env.REDIS_URL = url.toString();
  const queue = await import("./generationQueue.js");
  try {
    assert.equal(queue.getGenerationWorkerReady(), false);
    await Promise.all([queue.startGenerationWorker(), queue.startGenerationWorker()]);
    assert.equal(queue.getGenerationWorkerReady(), true);
    await queue.closeGenerationWorker();
    assert.equal(queue.getGenerationWorkerReady(), false);
    await queue.startGenerationWorker();
    assert.equal(queue.getGenerationWorkerReady(), true);
  } finally {
    await queue.closeGenerationWorker();
    await queue.generationQueue.close();
    await queue.generationQueueEvents.close();
  }
});
