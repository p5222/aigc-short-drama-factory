import assert from "node:assert/strict";
import test from "node:test";
import { DelayedError } from "bullmq";
import { CreationLeaseBusyError, processQueuedCreationJob, type CreationJobData } from "./creationProcessor.js";

test("a live DB lease delays BullMQ delivery without completing it or exhausting retries", async () => {
  const before = Date.now(); let delayedAt = 0; let suppliedToken: string | undefined;
  const job = { id: "lease-test", data: {} as CreationJobData, attemptsMade: 2, opts: { attempts: 3 }, moveToDelayed: async (time: number, token?: string) => { delayedAt = time; suppliedToken = token; } };
  await assert.rejects(processQueuedCreationJob(job, "redis-lock-token", async () => { throw new CreationLeaseBusyError(); }), DelayedError);
  assert.ok(delayedAt >= before + 30_000); assert.equal(suppliedToken, "redis-lock-token"); assert.equal(job.attemptsMade, 2);
});

test("lease delay failure propagates and normal model failures retain their retry semantics", async () => {
  const transportError = new Error("Redis disconnected");
  const job = { id: "lease-test", data: {} as CreationJobData, attemptsMade: 0, opts: { attempts: 3 }, moveToDelayed: async () => { throw transportError; } };
  await assert.rejects(processQueuedCreationJob(job, "token", async () => { throw new CreationLeaseBusyError(); }), error => error === transportError);
  const modelError = new Error("Model rejected");
  await assert.rejects(processQueuedCreationJob(job, "token", async () => { throw modelError; }), error => error === modelError);
  assert.deepEqual(await processQueuedCreationJob(job, "token", async () => ({ mode: "real" })), { mode: "real" });
});
