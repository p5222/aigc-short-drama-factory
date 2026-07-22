-- Generated for the full creation platform redesign.
-- Production currently applies the same schema through `prisma db push`; this
-- migration keeps the additive changes reproducible for environments that use
-- migration-based deployment.
ALTER TABLE "PromptVersion"
  ADD COLUMN IF NOT EXISTS "systemPrompt" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "userTemplate" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "variableSchema" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "outputSchema" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "validationRules" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "negativeRules" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "providerOverrides" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS "StyleProfile" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "summary" TEXT NOT NULL DEFAULT '',
  "characterRules" JSONB NOT NULL DEFAULT '[]',
  "sceneRules" JSONB NOT NULL DEFAULT '[]',
  "lightingRules" JSONB NOT NULL DEFAULT '[]',
  "cameraRules" JSONB NOT NULL DEFAULT '[]',
  "materialRules" JSONB NOT NULL DEFAULT '[]',
  "negativeRules" JSONB NOT NULL DEFAULT '[]',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StyleProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "StyleProfile_key_key" ON "StyleProfile"("key");
CREATE INDEX IF NOT EXISTS "StyleProfile_category_enabled_sortOrder_idx" ON "StyleProfile"("category", "enabled", "sortOrder");
