# Episode Routing And Sample Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace word-count-only episode limits with structural detection, simplify model routing, migrate Ripp to image generation, and import the 12-episode sample through the normal wizard.

**Architecture:** A pure shared wizard model detects source structure and returns an episode recommendation consumed by the UI and request normalizer. Provider catalogs hide deprecated ZML rows while runtime aliases remain compatible. A versioned sample manifest feeds the same project creation API used by pasted content.

**Tech Stack:** React 19, TypeScript, Node test runner, Fastify API, Prisma, OpenAI-compatible image API.

---

### Task 1: Structural episode analysis

**Files:**
- Create: `apps/web/src/pages/wizardSourceModel.ts`
- Create: `apps/web/src/pages/wizardSourceModel.test.ts`
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/pages/WizardPage.tsx`

- [ ] Write failing tests proving five chapter headings produce a five-episode maximum, explicit episode headings win for scripts, and unstructured novels fall back to roughly 2000 characters per episode.
- [ ] Run `node --experimental-strip-types --test apps/web/src/pages/wizardSourceModel.test.ts` and confirm the missing module/function failure.
- [ ] Implement `analyzeSourceEpisodes(content, sourceType)` and `episodeScopeOptions(analysis)` as pure functions.
- [ ] Replace WizardPage's `ceil(words / 2000)` calculation and clamp `targetEpisodes` through the structural analysis.
- [ ] Add the new test file to `apps/web/package.json` and run the web unit suite.

### Task 2: Episode range UI

**Files:**
- Modify: `apps/web/src/pages/WizardPage.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/pages/wizardSourceModel.test.ts`

- [ ] Add failing assertions for the labels `先生成 1 集`, `先生成前 2 集`, and `生成全部 N 集`.
- [ ] Replace the maximum-episode summary with detected structure, evidence, and a bounded production-range selector.
- [ ] Ensure source type changes recompute selection without silently merging or expanding source units.
- [ ] Run web unit tests and typecheck.

### Task 3: Route UI and ZML deprecation

**Files:**
- Modify: `apps/web/src/pages/WizardPage.tsx`
- Modify: `apps/web/src/components/ModelRoutePicker.tsx`
- Modify: `apps/web/src/creation-workspace.css`
- Modify: `apps/api/src/seed/catalogData.ts`
- Modify: `apps/api/src/db/seed.ts`
- Test: `apps/api/src/seed/catalogData.test.ts`

- [ ] Write failing catalog tests asserting no enabled provider or price uses a `zml-` ID and Ripp is absent from text providers.
- [ ] Remove the auto/custom switch and render the three route channels with the shared picker.
- [ ] Disable/remove ZML catalog rows while retaining runtime alias normalization for historical records.
- [ ] Run API catalog tests and web tests.

### Task 4: Ripp GPT Image 2 provider

**Files:**
- Modify: `apps/api/src/seed/catalogData.ts`
- Modify: `apps/api/src/db/mappers.ts`
- Modify: `apps/api/src/providers/dashscopeImage.ts`
- Modify: `packages/shared/src/imageGeneration.ts`
- Test: `apps/api/src/providers/dashscopeImage.test.ts`

- [ ] Write failing tests for canonical provider `ripp-image`, default model `gpt-image-2`, Base URL normalization, and `RIPP_IMAGE_API_KEY` lookup.
- [ ] Implement the OpenAI-compatible Ripp image branch without exposing credentials.
- [ ] Add an enabled image catalog and exact pricing row; remove Ripp DeepSeek text rows.
- [ ] Test `/v1/images/generations` with a 1x minimal request and record only status, response type, and error category.
- [ ] Run provider tests, shared tests, and typecheck.

### Task 5: Normal-flow sample import

**Files:**
- Create: `apps/web/public/samples/beijing-marriage/manifest.json`
- Create: `scripts/build_beijing_marriage_sample.ps1`
- Modify: `apps/web/src/pages/WizardPage.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/pages/wizardSourceModel.test.ts`

- [ ] Define and test a manifest parser that validates title, source type, 12 ordered episodes, and optional asset metadata.
- [ ] Build the manifest deterministically from the supplied desktop package without copying DOCX duplicates.
- [ ] Add “导入示例：北境婚书” to the content-input step and load the manifest into the existing form.
- [ ] Confirm it reports `12章 -> 12集` and follows the same next-step/start handlers as pasted content.
- [ ] Run web tests and build.

### Task 6: Verification and deployment

**Files:**
- Modify: `deploy/model-keys.local.txt` (ignored)
- Modify: server `.env.production` through the existing deployment connection

- [ ] Store the Ripp key only in ignored local/server environment configuration and scan the staged diff for secrets.
- [ ] Run `pnpm test`, `pnpm typecheck`, `pnpm build`, and `git diff --check`.
- [ ] Run the existing one-click server shipment with an intentional commit message.
- [ ] Verify server `main` and `deployed` both resolve to the new commit and production health returns HTTP 200.

