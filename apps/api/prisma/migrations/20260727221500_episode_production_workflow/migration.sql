ALTER TABLE "Project"
  ADD COLUMN "segmentProfile" TEXT NOT NULL DEFAULT 'jimeng_15s',
  ADD COLUMN "episodeDurationSeconds" INTEGER NOT NULL DEFAULT 180,
  ADD COLUMN "sourceCharactersPerEpisode" INTEGER NOT NULL DEFAULT 20000;

ALTER TABLE "ContentProject"
  ADD COLUMN "importKey" TEXT;

CREATE UNIQUE INDEX "ContentProject_importKey_key" ON "ContentProject"("importKey");

ALTER TABLE "Storyboard"
  ADD COLUMN "segmentProfile" TEXT,
  ADD COLUMN "sequenceNo" INTEGER,
  ADD COLUMN "startSeconds" DOUBLE PRECISION,
  ADD COLUMN "endSeconds" DOUBLE PRECISION,
  ADD COLUMN "boundaryType" TEXT,
  ADD COLUMN "startState" JSONB,
  ADD COLUMN "endState" JSONB,
  ADD COLUMN "firstFramePrompt" TEXT,
  ADD COLUMN "lastFramePrompt" TEXT,
  ADD COLUMN "firstFrameAssetId" TEXT,
  ADD COLUMN "lastFrameAssetId" TEXT,
  ADD COLUMN "continuitySourceShotId" TEXT,
  ADD COLUMN "promptVersion" TEXT;

CREATE TABLE "ProductionEpisode" (
  "id" TEXT NOT NULL,
  "contentProjectId" TEXT NOT NULL,
  "productionProjectId" TEXT,
  "episodeNo" INTEGER NOT NULL,
  "title" TEXT NOT NULL DEFAULT '',
  "sourceStart" INTEGER NOT NULL,
  "sourceEnd" INTEGER NOT NULL,
  "sourceCharacterCount" INTEGER NOT NULL,
  "targetDurationSeconds" INTEGER NOT NULL DEFAULT 180,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "activeScriptVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductionEpisode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EpisodeScriptVersion" (
  "id" TEXT NOT NULL,
  "episodeId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "content" TEXT NOT NULL,
  "structuredResult" JSONB NOT NULL DEFAULT '{}',
  "promptSnapshot" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EpisodeScriptVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductionEpisode_contentProjectId_episodeNo_key"
  ON "ProductionEpisode"("contentProjectId", "episodeNo");
CREATE INDEX "ProductionEpisode_productionProjectId_episodeNo_idx"
  ON "ProductionEpisode"("productionProjectId", "episodeNo");
CREATE UNIQUE INDEX "EpisodeScriptVersion_episodeId_version_key"
  ON "EpisodeScriptVersion"("episodeId", "version");

ALTER TABLE "ProductionEpisode"
  ADD CONSTRAINT "ProductionEpisode_contentProjectId_fkey"
  FOREIGN KEY ("contentProjectId") REFERENCES "ContentProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionEpisode"
  ADD CONSTRAINT "ProductionEpisode_productionProjectId_fkey"
  FOREIGN KEY ("productionProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EpisodeScriptVersion"
  ADD CONSTRAINT "EpisodeScriptVersion_episodeId_fkey"
  FOREIGN KEY ("episodeId") REFERENCES "ProductionEpisode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
