CREATE TABLE IF NOT EXISTS "AdminAuditLog" (
  "id" TEXT PRIMARY KEY,
  "actorId" TEXT NOT NULL,
  "actorRole" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "target" TEXT NOT NULL,
  "details" JSONB NOT NULL DEFAULT '{}',
  "ipAddress" TEXT,
  "status" TEXT NOT NULL DEFAULT 'started',
  "statusCode" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "AdminAuditLog_createdAt_id_idx" ON "AdminAuditLog"("createdAt", "id");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_actorId_createdAt_idx" ON "AdminAuditLog"("actorId", "createdAt");
