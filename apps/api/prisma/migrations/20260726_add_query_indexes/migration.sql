-- Additive indexes for common tenant, project, and catalog queries.
CREATE INDEX IF NOT EXISTS "Project_userId_idx" ON "Project"("userId");
CREATE INDEX IF NOT EXISTS "ScriptDraft_projectId_idx" ON "ScriptDraft"("projectId");
CREATE INDEX IF NOT EXISTS "Character_projectId_idx" ON "Character"("projectId");
CREATE INDEX IF NOT EXISTS "Asset_projectId_idx" ON "Asset"("projectId");
CREATE INDEX IF NOT EXISTS "Storyboard_projectId_idx" ON "Storyboard"("projectId");
CREATE INDEX IF NOT EXISTS "GenerationTask_userId_idx" ON "GenerationTask"("userId");
CREATE INDEX IF NOT EXISTS "GenerationTask_projectId_idx" ON "GenerationTask"("projectId");
CREATE INDEX IF NOT EXISTS "CreditTransaction_userId_idx" ON "CreditTransaction"("userId");
CREATE INDEX IF NOT EXISTS "CreditTransaction_projectId_idx" ON "CreditTransaction"("projectId");
CREATE INDEX IF NOT EXISTS "RedeemCode_batchId_idx" ON "RedeemCode"("batchId");
CREATE INDEX IF NOT EXISTS "ModelPrice_providerId_idx" ON "ModelPrice"("providerId");
