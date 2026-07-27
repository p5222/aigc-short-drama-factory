# Manju Production Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist novel-to-episode production as normal project data, import 《北境婚书》 idempotently, and generate selectable Jimeng 15-second or Doubao 10-second continuity-aware storyboard packages.

**Architecture:** Keep `ContentProject` as the editable source/adaptation record and `Project` as the production workspace. Add per-episode/version entities between them, extend storyboards with profile and frame continuity fields, and execute generation per episode through existing model and queue infrastructure. A deterministic importer normalizes the completed package into the same entities used by regular projects.

**Tech Stack:** TypeScript, Node.js, Express, Prisma/PostgreSQL, BullMQ, React/Vite, Node test runner, Mammoth for DOCX extraction.

---

## File Map

- Modify `apps/api/prisma/schema.prisma`: episode/version, import identity, production profile, and storyboard continuity persistence.
- Create `apps/api/src/production/episodePlanning.ts`: pure episode budgeting and next-range functions.
- Create `apps/api/src/production/storyboardProfiles.ts`: Jimeng/Doubao profile contracts and prompt rendering.
- Create `apps/api/src/production/episodeService.ts`: episode persistence, generation, retry, and version operations.
- Create `apps/api/src/importers/manjuPackage.ts`: package parsing and idempotent database import.
- Create `apps/api/src/scripts/importManjuPackage.ts`: explicit CLI entry point.
- Modify `apps/api/src/content/service.ts`: per-episode generation and idempotent handoff.
- Modify `apps/api/src/content/routes.ts` and `apps/api/src/server.ts`: episode/profile/import-related APIs.
- Modify `apps/api/src/db/mappers.ts`, `apps/api/src/db/repository.ts`, and `packages/shared/src/index.ts`: expose new persisted fields.
- Modify `apps/web/src/pages/wizardSourceModel.ts` and tests: 20,000-character budget and 1..N remaining options.
- Modify `apps/web/src/pages/WizardPage.tsx`: remaining episode selection.
- Modify `apps/web/src/content/ContentWorkspace.tsx`: episode status/version controls and incremental production.
- Modify `apps/web/src/workbench/stages/ShotStage.tsx`: production profile selection and frame continuity display.
- Modify `apps/web/src/lib/api.ts` and `apps/web/src/lib/contentApi.ts`: client contracts.
- Add normalized 《北境婚书》 import fixture and managed image assets under `apps/api/seed-data/beijing-marriage/`.

## Task 1: Persist Episodes and Continuity

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `packages/shared/src/index.ts`
- Create: `apps/api/prisma/migrations/20260727221500_episode_production_workflow/migration.sql`

- [ ] **Step 1: Add schema validation expectations**

Create a schema smoke test in `apps/api/src/production/schemaContract.test.ts` that reads `schema.prisma` and asserts the required models and fields exist:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");

test("persists episode versions and storyboard continuity", () => {
  assert.match(schema, /model ProductionEpisode/);
  assert.match(schema, /model EpisodeScriptVersion/);
  for (const field of ["segmentProfile", "boundaryType", "firstFramePrompt", "lastFramePrompt", "continuitySourceShotId"]) {
    assert.match(schema, new RegExp(field));
  }
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm --filter @aifilm/api exec tsx --test src/production/schemaContract.test.ts`

Expected: FAIL because `ProductionEpisode` is absent.

- [ ] **Step 3: Add Prisma models and relations**

Add `importKey String? @unique`, production settings, episode relations, and these models:

```prisma
model ProductionEpisode {
  id                    String   @id
  contentProjectId      String
  productionProjectId   String?
  episodeNo             Int
  title                 String   @default("")
  sourceStart           Int
  sourceEnd             Int
  sourceCharacterCount  Int
  targetDurationSeconds Int      @default(180)
  status                String   @default("draft")
  activeScriptVersion   Int      @default(0)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  contentProject        ContentProject @relation(fields: [contentProjectId], references: [id], onDelete: Cascade)
  productionProject     Project? @relation(fields: [productionProjectId], references: [id], onDelete: SetNull)
  scripts               EpisodeScriptVersion[]

  @@unique([contentProjectId, episodeNo])
  @@index([productionProjectId, episodeNo])
}

model EpisodeScriptVersion {
  id             String   @id
  episodeId      String
  version        Int
  status         String   @default("draft")
  content        String
  structuredResult Json   @default("{}")
  promptSnapshot Json     @default("{}")
  createdAt      DateTime @default(now())
  episode        ProductionEpisode @relation(fields: [episodeId], references: [id], onDelete: Cascade)

  @@unique([episodeId, version])
}
```

Add project settings `segmentProfile String @default("jimeng_15s")`, `episodeDurationSeconds Int @default(180)`, and `sourceCharactersPerEpisode Int @default(20000)`. Extend `Storyboard` with nullable frame prompts/assets, states, version, boundary type, profile, sequence, and source shot relation fields.

- [ ] **Step 4: Generate and apply the migration locally**

Run: `pnpm --filter @aifilm/api exec prisma migrate dev --schema prisma/schema.prisma --name episode_production_workflow`

Expected: Prisma client generation succeeds and a migration is created.

- [ ] **Step 5: Add shared contracts**

Add `SegmentProfile`, `ProductionEpisode`, `EpisodeScriptVersion`, and the new optional continuity fields to `StoryboardShot`. Keep fields optional at the transport boundary for old rows during deployment.

- [ ] **Step 6: Run validation and commit**

Run: `pnpm --filter @aifilm/api test:unit && pnpm typecheck`

Expected: PASS.

Commit: `git commit -m "feat: persist episode production workflow"`

## Task 2: Replace Episode Count Heuristics

**Files:**
- Create: `apps/api/src/production/episodePlanning.ts`
- Create: `apps/api/src/production/episodePlanning.test.ts`
- Modify: `apps/web/src/pages/wizardSourceModel.ts`
- Modify: `apps/web/src/pages/wizardSourceModel.test.ts`

- [ ] **Step 1: Write planning tests**

Cover effective-character counting, explicit script episodes, 20,000-character novel budgets, semantic boundary preservation, and remaining ranges:

```ts
test("budgets novels at 20000 effective characters per episode", () => {
  assert.equal(planEpisodeBudget("正文".repeat(22500), "novel").maxEpisodes, 3);
});

test("offers every remaining incremental count", () => {
  assert.deepEqual(episodeGenerationOptions(9, 3).map((item) => item.value), [1, 2, 3, 4, 5, 6, "all"]);
  assert.equal(resolveNextEpisodeNumbers(9, [1, 2, 3], 2).join(","), "4,5");
});

test("never allows a requested count above remaining episodes", () => {
  assert.throws(() => resolveNextEpisodeNumbers(3, [1, 2], 2), /剩余 1 集/);
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm --filter @aifilm/api exec tsx --test src/production/episodePlanning.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement pure planning functions**

Export:

```ts
export const DEFAULT_SOURCE_CHARACTERS_PER_EPISODE = 20_000;
export function countEffectiveCharacters(content: string): number;
export function planEpisodeBudget(content: string, sourceType: "novel" | "script"): EpisodeBudget;
export function episodeGenerationOptions(maxEpisodes: number, completedEpisodeNos: number[]): EpisodeGenerationOption[];
export function resolveNextEpisodeNumbers(maxEpisodes: number, completedEpisodeNos: number[], scope: number | "all"): number[];
```

Explicit `第N集` headings win for scripts. Novel chapter headings are boundary candidates, not automatically one episode each. The character budget remains the hard maximum because expansion is disabled.

- [ ] **Step 4: Make web model delegate to the same rules**

Move reusable types/functions to `@aifilm/shared` if browser importing server code would cross package boundaries. Update labels to `生成接下来 N 集` and `生成全部剩余 N 集`.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm --filter @aifilm/api test:unit && pnpm --filter @aifilm/web test:unit`

Expected: PASS with old 2,000-character assertions replaced.

Commit: `git commit -m "feat: plan episodes from production budget"`

## Task 3: Generate and Version Scripts Per Episode

**Files:**
- Create: `apps/api/src/production/episodeService.ts`
- Create: `apps/api/src/production/episodeService.test.ts`
- Modify: `apps/api/src/content/service.ts`
- Modify: `apps/api/src/content/routes.ts`
- Modify: `apps/web/src/lib/contentApi.ts`

- [ ] **Step 1: Write service tests with a repository fake**

Assert that a request for two episodes after 1–3 generates only 4–5, creates one version per episode, retains previous versions on regeneration, and never calls the model for completed episodes.

```ts
assert.deepEqual(modelCalls.map((call) => call.episodeNo), [4, 5]);
assert.equal(savedVersions.get(4)?.version, 1);
await regenerateEpisode(context, episode4.id);
assert.equal(savedVersions.get(4)?.version, 2);
```

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @aifilm/api exec tsx --test src/production/episodeService.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement episode planning persistence**

Create/upsert `ProductionEpisode` rows from semantic source ranges. Save immutable source offsets and character counts. Reject any target above the computed maximum.

- [ ] **Step 4: Implement one model call per episode**

The structured output must include `title`, `scenes`, `dialogue`, `voiceOver`, `sounds`, `estimatedSeconds`, `preservedFacts`, and `endingHook`. Validate total estimated time against the project target and reject new facts not grounded in the source slice.

- [ ] **Step 5: Add APIs**

Add:

```text
GET  /api/content/projects/:id/episodes
POST /api/content/projects/:id/episodes/generate   { scope: number | "all" }
POST /api/content/projects/:id/episodes/:episodeNo/regenerate
GET  /api/content/projects/:id/episodes/:episodeNo/versions
POST /api/content/projects/:id/episodes/:episodeNo/versions/:version/activate
```

- [ ] **Step 6: Preserve editable source chapters**

Ensure handoff reads active episode versions without locking or replacing `StoryChapter`. Editing a source chapter marks affected episode plans stale but does not delete scripts until regeneration is confirmed.

- [ ] **Step 7: Run tests and commit**

Run: `pnpm test && pnpm typecheck`

Expected: PASS.

Commit: `git commit -m "feat: generate versioned scripts by episode"`

## Task 4: Make Content-to-Production Handoff Idempotent

**Files:**
- Modify: `apps/api/src/content/service.ts`
- Modify: `apps/api/src/db/repository.ts`
- Create: `apps/api/src/content/handoff.test.ts`
- Modify: `apps/web/src/content/model.ts`
- Modify: `apps/web/src/content/model.test.ts`

- [ ] **Step 1: Write an idempotency test**

Call handoff twice and assert the same `Project.id`, one production project, stable episode numbers, and updated active script versions.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @aifilm/api exec tsx --test src/content/handoff.test.ts`

Expected: FAIL until the handoff service is extracted.

- [ ] **Step 3: Implement transactional upsert**

Look up `ContentProject.productionProjectId`; create only when absent, otherwise update the existing `Project`. Synchronize `ScriptDraft` from active episode versions without deleting production-only assets.

- [ ] **Step 4: Expose stale and synced states**

Return `productionProjectId`, `episodeCount`, `syncedEpisodeCount`, and `staleEpisodeNos` in `ContentProductionPackage`.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm test && pnpm typecheck`

Expected: PASS.

Commit: `git commit -m "fix: keep content handoff linked to production"`

## Task 5: Import 《北境婚书》 as Normal Data

**Files:**
- Add dependency: `apps/api/package.json`
- Create: `apps/api/src/importers/manjuPackage.ts`
- Create: `apps/api/src/importers/manjuPackage.test.ts`
- Create: `apps/api/src/scripts/importManjuPackage.ts`
- Create: `apps/api/seed-data/beijing-marriage/manifest.json`
- Add: normalized Markdown/JSON and approved PNG assets under `apps/api/seed-data/beijing-marriage/`

- [ ] **Step 1: Add `mammoth` for DOCX extraction**

Run: `pnpm --filter @aifilm/api add mammoth`

Expected: dependency and lockfile update succeed.

- [ ] **Step 2: Write parser tests against a minimal fixture**

Assert 12 ordered episodes, 6 characters, 18 scenes, 10 props, 60 existing compressed shots, and Jimeng prompts mapped by episode. Assert missing or duplicate episode numbers fail with a clear report.

- [ ] **Step 3: Implement parser and normalizer**

Parse DOCX with Mammoth and Markdown by headings/tables, never by filename-only string slicing. Produce a typed `ManjuImportPackage` before any database write.

- [ ] **Step 4: Implement idempotent importer**

Require `--user-email` and `--source-dir`; derive fixed import key `manju:beijing-marriage:v1`. Use a transaction for content project, episodes, scripts, production project, characters, assets, and storyboards. Copy approved PNG files into the application-managed upload directory and store served URLs.

- [ ] **Step 5: Add dry-run and report modes**

Command:

```powershell
pnpm --filter @aifilm/api exec tsx src/scripts/importManjuPackage.ts --source-dir "C:\Users\lisicheng\Desktop\北境婚书-最终优化版" --user-email $env:MANJU_IMPORT_USER_EMAIL --dry-run
```

Dry-run performs full parsing and validation without writes. Real execution prints IDs and inserted/updated counts without printing secrets.

- [ ] **Step 6: Run dry-run, tests, and real local import**

Expected dry-run: 12 chapters, 12 episodes, 6 characters, 18 scenes, 10 props, 60 compressed shots, 12 Jimeng prompt files.

- [ ] **Step 7: Verify repeat import**

Run the real import twice. Expected: identical content and production project IDs; second report contains updates/skips and zero duplicate projects.

- [ ] **Step 8: Commit**

Commit: `git commit -m "feat: import beijing marriage as project data"`

## Task 6: Add Jimeng and Doubao Storyboard Profiles

**Files:**
- Create: `apps/api/src/production/storyboardProfiles.ts`
- Create: `apps/api/src/production/storyboardProfiles.test.ts`
- Modify: `apps/api/src/agents/storyboardProduction.ts`
- Modify: `apps/api/src/prompts/catalog.ts`
- Modify: `apps/api/src/prompts/catalog.test.ts`

- [ ] **Step 1: Write profile tests**

Assert Jimeng produces 15-second timing bands, Doubao produces 10-second bands, only the selected profile renders, and content tokens absent from the episode script are rejected.

```ts
assert.deepEqual(profileFor("jimeng_15s").timingBands, [[0, 4], [4, 8], [8, 12], [12, 15]]);
assert.deepEqual(profileFor("doubao_10s").timingBands, [[0, 3], [3, 7], [7, 10]]);
assert.doesNotMatch(rendered, /班长|递笔|晚自习教室/);
```

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @aifilm/api exec tsx --test src/production/storyboardProfiles.test.ts`

Expected: FAIL because profiles do not exist.

- [ ] **Step 3: Implement shared structural contract**

Define `SegmentProfileDefinition` with duration, timing bands, required fields, provider constraints, and renderer. Do not embed the contaminated examples from the source instruction files.

- [ ] **Step 4: Render continuity-aware prompts**

Require current script excerpt, stable asset references, previous end state, boundary type, first-frame prompt, last-frame prompt, Chinese dialogue, and no-subtitle constraints. Use current episode script as the only narrative source.

- [ ] **Step 5: Add semantic grounding validation**

Reject named roles/scenes/props not present in the active episode or linked asset set. Keep safety checks separate from story grounding so sanitization cannot silently change plot facts.

- [ ] **Step 6: Run tests and commit**

Run: `pnpm --filter @aifilm/api test:unit`

Expected: PASS.

Commit: `git commit -m "feat: add selectable video storyboard profiles"`

## Task 7: Persist Assets, Frames, and Retryable Tasks

**Files:**
- Modify: `apps/api/src/db/storyboardActions.ts`
- Modify: `apps/api/src/db/repository.ts`
- Modify: `apps/api/src/queue/generationQueue.ts`
- Modify: `apps/api/src/server.ts`
- Create: `apps/api/src/production/continuity.test.ts`

- [ ] **Step 1: Write continuity transition tests**

Assert `CONTINUE` reuses the approved previous last frame, `CUT_MATCH` creates an independent matched first frame, and `CUT_SCENE` never reuses the prior scene frame.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @aifilm/api exec tsx --test src/production/continuity.test.ts`

Expected: FAIL against current storyboard persistence.

- [ ] **Step 3: Save generated asset references**

On image success, update the associated `Asset.referenceUrl`; on character reference approval, set `Character.referenceAssetId`. Storyboards must store stable asset IDs instead of name-only prompt mentions.

- [ ] **Step 4: Save first/last frame lifecycle**

Add task types or metadata for first and last frames. Only approved last frames may satisfy a downstream `CONTINUE` dependency.

- [ ] **Step 5: Make tasks independently retryable**

Use one queue job per episode, asset, or video segment. Preserve succeeded sibling jobs and retry only the failed entity.

- [ ] **Step 6: Run tests and commit**

Run: `pnpm test && pnpm typecheck`

Expected: PASS.

Commit: `git commit -m "feat: persist storyboard frame continuity"`

## Task 8: Update the User Workflow

**Files:**
- Modify: `apps/web/src/pages/WizardPage.tsx`
- Modify: `apps/web/src/pages/wizardSourceModel.ts`
- Modify: `apps/web/src/content/ContentWorkspace.tsx`
- Modify: `apps/web/src/content/content.css`
- Modify: `apps/web/src/workbench/stages/ShotStage.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/contentApi.ts`
- Modify: relevant web model tests

- [ ] **Step 1: Write UI model tests**

Test remaining-option labels, profile selection, switch confirmation text, episode stale states, and continuity labels without rendering React.

- [ ] **Step 2: Verify failure**

Run: `pnpm --filter @aifilm/web test:unit`

Expected: FAIL on new expectations.

- [ ] **Step 3: Replace generation-range select**

Show effective character count, recommended maximum, completed count, and all choices from 1 through remaining N plus “全部剩余”. Disable generation when no episodes remain.

- [ ] **Step 4: Add episode list and version controls**

Each row shows source range, target 180 seconds, status, active version, regenerate action, and stale indicator. Keep the source chapter editable after handoff.

- [ ] **Step 5: Add profile selector**

Use a two-option segmented control with `即梦 15 秒` and `豆包 10 秒`. Switching after storyboards exist opens a confirmation dialog explaining that a new version will be created and old storyboards retained.

- [ ] **Step 6: Show continuity data on shot cards**

Display boundary type, first/last frame status, upstream shot, stable asset references, and independent retry action. Do not nest cards or add explanatory marketing copy.

- [ ] **Step 7: Run tests, typecheck, and responsive browser checks**

Run: `pnpm --filter @aifilm/web test:unit && pnpm --filter @aifilm/web typecheck && pnpm --filter @aifilm/web build`

Use Playwright at desktop and mobile widths to verify selector text does not overflow and controls do not overlap.

- [ ] **Step 8: Commit**

Commit: `git commit -m "feat: expose episode and storyboard production controls"`

## Task 9: End-to-End Verification and Server Delivery

**Files:**
- Create: `apps/api/src/importers/manjuPackage.integration.test.ts` when a disposable database is available
- Modify: deployment/import documentation only if an operational command must be recorded

- [ ] **Step 1: Run the complete quality gate**

Run:

```powershell
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: all commands pass.

- [ ] **Step 2: Verify normal project behavior locally**

Log in as the explicit import owner and confirm 《北境婚书》 appears in the standard project list. Open its 12 episodes, assets, compressed storyboards, and Jimeng prompts. Edit a source chapter and verify production data becomes stale but remains present.

- [ ] **Step 3: Verify a new novel path**

Use a fixture slightly above 40,000 effective characters. Expected maximum: 3 episodes. Generate 1, then 2; verify episode numbers 1 followed by 2–3 with no duplicates and no expansion.

- [ ] **Step 4: Verify both profiles independently**

Generate Jimeng for one episode and verify 15-second segments. Switch with confirmation, generate a Doubao version, and verify 10-second segments while the Jimeng version remains available.

- [ ] **Step 5: Verify continuity rules**

Approve a `CONTINUE` tail frame and verify reuse. Verify `CUT_MATCH` and `CUT_SCENE` create independent first frames. Confirm no contaminated example terms appear for unrelated scripts.

- [ ] **Step 6: Deploy using the existing one-command path**

Run: `pnpm ship:server -- "feat: deliver manju production workflow"`

Expected: commit, push, server migration/build/restart, and health check complete successfully.

- [ ] **Step 7: Run production import explicitly**

Execute the importer on the server with the chosen account email and packaged source directory. Run it a second time and confirm no duplicate project is created.

- [ ] **Step 8: Production smoke test**

Verify the server commit, `/health`, imported project visibility, episode counts, asset URLs, profile selection, and one non-costly prompt generation. Do not trigger paid batch image/video generation without explicit confirmation.

Commit any verification-only fixes separately with a precise message.
