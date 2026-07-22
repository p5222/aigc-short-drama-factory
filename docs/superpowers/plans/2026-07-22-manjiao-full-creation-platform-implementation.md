# Manjiao Full Creation Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Manjiao into a versioned, full-cycle novel-to-video production platform with a unified frontend/admin design system and one final production cutover.

**Architecture:** Introduce focused content-authoring, prompt-runtime, and style-profile modules while retaining the existing Project production domain. Persist every generative step and prompt snapshot, then connect a new content workspace to the existing four-stage production workbench. Replace page-specific theme overrides with semantic tokens and split the monolithic admin surface into reusable operational page patterns.

**Tech Stack:** TypeScript, React 19, Vite, Express 5, Prisma/PostgreSQL, BullMQ/Redis, Zod, Lucide, Node test runner, Docker Compose.

---

## File Map

New backend boundaries:

- `apps/api/src/prompts/catalog.ts`: stable prompt definitions and default versions.
- `apps/api/src/prompts/runtime.ts`: active-version lookup, template rendering, snapshots and validation.
- `apps/api/src/content/service.ts`: content project orchestration and step persistence.
- `apps/api/src/content/schemas.ts`: Zod contracts for analyses, outlines, chapters, scripts and entities.
- `apps/api/src/content/routes.ts`: authenticated content-authoring API.
- `apps/api/src/styles/catalog.ts`: StyleProfile import seed and runtime lookup.
- `apps/api/src/admin/queries.ts`: paginated admin aggregates and operational lists.

New frontend boundaries:

- `apps/web/src/pages/ContentCreatorPage.tsx`: content-authoring route shell.
- `apps/web/src/content/*`: content workspace stages, state model and API presentation.
- `apps/web/src/admin/*`: admin shell, page templates and focused modules.
- `apps/web/src/design-system/*`: shared theme tokens and compact operational primitives.

Existing files modified only at integration points:

- `apps/api/prisma/schema.prisma`
- `packages/shared/src/index.ts`
- `apps/api/src/server.ts`
- `apps/api/src/agents/generator.ts`
- `apps/api/src/agents/storyboardProduction.ts`
- `apps/api/src/db/storyboardActions.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/lib/api.ts`
- `apps/web/src/components/Shell.tsx`
- `apps/web/src/workbench/*`

### Task 1: Database And Shared Contracts

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `packages/shared/src/index.ts`
- Create: `apps/api/prisma/migrations/20260722_full_creation_platform/migration.sql`
- Test: `apps/api/src/content/schemas.test.ts`

- [ ] Add `ContentProject`, `SourceDocument`, `StoryAnalysis`, `StoryOutline`, `StoryChapter`, `ScriptVersion`, `EntityCatalog`, and `StyleProfile` models with user/project relations, version fields, JSON snapshots, timestamps and indexes.
- [ ] Extend `PromptVersion` with `systemPrompt`, `userTemplate`, `variableSchema`, `outputSchema`, `validationRules`, `negativeRules`, and `providerOverrides`, preserving `content` for compatibility.
- [ ] Extend shared types with exact API DTOs and `PagedResult<T>` collections.
- [ ] Add Zod schemas that reject missing story facts, duplicate entity IDs and invalid chapter/step statuses.
- [ ] Run `pnpm --filter @aifilm/api db:generate`, shared typecheck and schema tests.
- [ ] Commit as `feat: add content authoring domain models`.

### Task 2: Prompt Catalog And Runtime

**Files:**
- Create: `apps/api/src/prompts/catalog.ts`
- Create: `apps/api/src/prompts/runtime.ts`
- Create: `apps/api/src/prompts/runtime.test.ts`
- Modify: `apps/api/src/db/seed.ts`

- [ ] Encode the eleven approved prompt definitions from `docs/manjiao-final-prompt-catalog-20260722.md` as versioned seed data.
- [ ] Write failing tests for exact active-version selection, strict missing-variable errors, stable snapshots and legacy `content` fallback.
- [ ] Implement `getActivePromptVersion(key)`, `renderPrompt(version, variables)` and `promptSnapshot(version)`.
- [ ] Ensure one active version per key in a transaction and prevent archived activation.
- [ ] Run prompt runtime tests and API typecheck.
- [ ] Commit as `feat: add versioned prompt runtime`.

### Task 3: Style Profiles

**Files:**
- Create: `apps/api/src/styles/catalog.ts`
- Create: `apps/api/src/styles/catalog.test.ts`
- Modify: `apps/api/src/db/seed.ts`
- Modify: `apps/web/src/lib/api.ts`

- [ ] Convert all four workbook sections and 45 style rows into stable StyleProfile seeds without copyrighted example names in generated prompts.
- [ ] Derive character, scene, lighting, camera, material and negative rules from each source description.
- [ ] Add public enabled-style and admin style-management endpoints with pagination.
- [ ] Test category counts, unique keys and stage-specific injection.
- [ ] Commit as `feat: add structured visual style profiles`.

### Task 4: Content Authoring Service

**Files:**
- Create: `apps/api/src/content/service.ts`
- Create: `apps/api/src/content/routes.ts`
- Create: `apps/api/src/content/service.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/agents/generator.ts`

- [ ] Add CRUD and paginated list APIs for content projects and source documents.
- [ ] Implement step runners for analysis, strategy, outline, chapter, script and entity extraction using PromptVersion snapshots and existing text-provider routing.
- [ ] Persist operation IDs and reject stale completions before writes.
- [ ] Generate chapters independently and support resume from failed chapters.
- [ ] Confirm a ScriptVersion into a production Project without duplicating existing assets or billing twice.
- [ ] Test the three creation modes, stale writes, malformed model JSON repair, resume and project handoff.
- [ ] Commit as `feat: add persistent content creation workflow`.

### Task 5: Production Prompt Integration

**Files:**
- Modify: `apps/api/src/agents/generator.ts`
- Modify: `apps/api/src/agents/storyboardProduction.ts`
- Modify: `apps/api/src/db/storyboardActions.ts`
- Modify: `apps/api/src/db/repository.ts`
- Test: `apps/api/src/prompts/production.test.ts`

- [ ] Replace embedded script, entity, character-board, scene-sheet and storyboard templates with prompt runtime calls.
- [ ] Keep legacy fallback only for historical projects and label it in task snapshots.
- [ ] Store PromptVersion, StyleProfile and reference asset IDs with every generation task.
- [ ] Add 10-second and 15-second adapters over one canonical storyboard structure; return `requiresSplit` rather than overcrowding a shot.
- [ ] Use previous video tail-frame references when the selected provider supports them and preserve existing first-frame fallback otherwise.
- [ ] Run production prompt, pricing and delivery tests.
- [ ] Commit as `refactor: connect production to versioned prompts`.

### Task 6: Content Creator Frontend

**Files:**
- Create: `apps/web/src/pages/ContentCreatorPage.tsx`
- Create: `apps/web/src/content/model.ts`
- Create: `apps/web/src/content/model.test.ts`
- Create: `apps/web/src/content/ContentWorkspace.tsx`
- Create: `apps/web/src/content/content.css`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/Shell.tsx`
- Modify: `apps/web/src/lib/api.ts`

- [ ] Add “内容创作” navigation and the three creation modes.
- [ ] Build the left version/chapters rail, central editor/diff view and right configuration/assessment inspector.
- [ ] Show explicit saved, running, failed, stale and confirmed states from real API data.
- [ ] Connect style/model selection, per-step rerun, chapter continuation and production handoff.
- [ ] Add state-model tests for selection reconciliation and stale operations.
- [ ] Commit as `feat: add content creation workspace`.

### Task 7: Shared Design System And Theme Audit

**Files:**
- Create: `apps/web/src/design-system/tokens.css`
- Create: `apps/web/src/design-system/components.css`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/light-theme.css`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/pages/CineHome.css`
- Modify: `apps/web/src/workbench/styles/*.css`

- [ ] Define semantic light/dark tokens for page, surfaces, text, borders, accent, statuses, disabled states and shadows.
- [ ] Replace scoped hard-coded theme colors on login, home, content creator, wizard, workbench, task, account and admin pages.
- [ ] Remove superseded `!important` overrides only after every consuming component uses semantic tokens.
- [ ] Verify identical layout metrics across themes and WCAG-readable body/muted text contrast.
- [ ] Commit as `refactor: unify application theme system`.

### Task 8: Workbench UI Reconstruction

**Files:**
- Modify: `apps/web/src/workbench/components/*`
- Modify: `apps/web/src/workbench/stages/*`
- Modify: `apps/web/src/workbench/styles/*`
- Test: existing `apps/web/src/workbench/*.test.ts`

- [ ] Rebuild Content, Asset, Shot and Delivery stages around one stable rail/canvas/inspector geometry.
- [ ] Add segmented asset lists for characters, scenes and props with large central preview and structured inspector.
- [ ] Keep only capability-backed commands and real model/pricing choices.
- [ ] Preserve exact episode/scene/shot selection, playback and billing behavior under new components.
- [ ] Run all existing workbench tests and add tests for scene-sheet/identity-board selections.
- [ ] Commit as `feat: rebuild production workbench interface`.

### Task 9: Admin API And Pagination

**Files:**
- Create: `apps/api/src/admin/queries.ts`
- Create: `apps/api/src/admin/queries.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/db/evaluation.ts`
- Modify: `apps/api/src/db/repository.ts`

- [ ] Add paginated contracts for users, redeem codes, works, quality projects, prompt versions, experiments and tasks.
- [ ] Move dashboard and status aggregation to database `groupBy`/count/sum queries.
- [ ] Add transactional batch disable/export metadata for redeem codes and exact filtered totals.
- [ ] Add overview drill-down filters and task failure classifications.
- [ ] Test pagination boundaries, filters, transaction rollback and aggregate accuracy.
- [ ] Commit as `feat: add operational admin queries`.

### Task 10: Admin Frontend Reconstruction

**Files:**
- Create: `apps/web/src/admin/AdminShell.tsx`
- Create: `apps/web/src/admin/AdminTablePage.tsx`
- Create: `apps/web/src/admin/AdminMasterDetail.tsx`
- Create: `apps/web/src/admin/AdminEvaluationPage.tsx`
- Create: `apps/web/src/admin/admin.css`
- Split/Modify: `apps/web/src/pages/AdminPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/lib/api.ts`

- [ ] Implement the approved Sub2API-inspired sidebar, thin header, filter toolbar, dense table and drawer patterns.
- [ ] Connect all pages to paginated APIs, URL/hash filters, loading/error/empty states and pagination.
- [ ] Complete overview drill-down, users, showcase review, quality, redeem, plans, routing, pricing, prompt versions, experiments and tasks.
- [ ] Keep one-admin behavior; do not add role management UI.
- [ ] Add light/dark parity and responsive table overflow without shrinking text below readable sizes.
- [ ] Commit as `feat: rebuild admin operations console`.

### Task 11: ImageGen Design References And Visual QA

**Files:**
- Create: `docs/design-previews/full-redesign-20260722/*.png`
- Create: `docs/design-qa-full-redesign-20260722.md`

- [ ] Generate exactly three 2K frontend references: content workspace, asset stage and shot stage.
- [ ] Generate exactly three 2K admin references: operations overview, dense management table and prompt experiment comparison.
- [ ] Save final selected references in the workspace and record prompts in the QA document.
- [ ] Compare coded desktop/mobile light/dark screenshots against references; log and fix overlap, contrast, spacing and hierarchy defects.
- [ ] Commit as `docs: add full redesign visual QA evidence`.

### Task 12: End-To-End Verification And Production Cutover

**Files:**
- Modify: `docs/manjiao_deployment_quick_reference.md`
- Modify: `docs/design-qa.md`

- [ ] Run shared/API/web unit tests, typechecks and builds.
- [ ] Apply migration to a disposable database and verify existing project compatibility.
- [ ] Run one real test project through content input, script, entities, one identity board, one scene sheet, storyboard, first frame, playable video and export task.
- [ ] Create source, database, storage and web-dist production backups and verify non-empty archives.
- [ ] Deploy the clean committed archive, apply migration, rebuild web/API and restart services.
- [ ] Verify `manjiao.cloud`, `www.manjiao.cloud`, `api.manjiao.cloud`, new asset fingerprints and critical API flows.
- [ ] Retain the newest three verified backups and document rollback.
- [ ] Commit deployment evidence and push `codex/cine4k-light-theme` without force.
