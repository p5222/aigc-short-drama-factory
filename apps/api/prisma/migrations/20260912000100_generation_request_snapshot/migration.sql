-- Additive only: durable creation input survives Redis retention and dispatch failures.
ALTER TABLE "GenerationTask" ADD COLUMN IF NOT EXISTS "requestPayload" JSONB;
CREATE INDEX IF NOT EXISTS "CreditTransaction_taskId_userId_type_idx" ON "CreditTransaction"("taskId", "userId", "type");
