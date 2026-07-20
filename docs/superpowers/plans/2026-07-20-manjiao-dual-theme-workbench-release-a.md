# Manjiao Dual-Theme Workbench Release A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the creator workbench as one immersive four-stage production flow with complete Porcelain light and Graphite dark themes, while exposing only capabilities backed by the current API.

**Architecture:** `ProjectWorkbenchPage` becomes a thin orchestrator around `WorkbenchProvider`, four stage components, and shared workspace primitives. Selection, capabilities, media mapping, task status, and theme behavior move into testable models/hooks; all workbench styles move into a scoped semantic-token system. Existing API calls and production data remain authoritative.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, Lucide React, Node test runner, Playwright, axe-core, CSS Custom Properties, existing Express/Prisma API contracts.

---

## File Map

**Create**

- `apps/web/src/workbench/model.ts`: selection reducer, capability flags, stage completion, media/task selectors.
- `apps/web/src/workbench/model.test.ts`: pure model tests.
- `apps/web/src/workbench/WorkbenchContext.tsx`: provider and command/state interfaces.
- `apps/web/src/workbench/components/WorkbenchHeader.tsx`: immersive header, stage navigation, save state, theme control.
- `apps/web/src/workbench/components/ProductionWorkspace.tsx`: Rail/Canvas/Inspector layout and responsive drawers.
- `apps/web/src/workbench/components/EntityRail.tsx`: shared flat entity list.
- `apps/web/src/workbench/components/MediaCanvas.tsx`: stable media carrier and loading/error states.
- `apps/web/src/workbench/components/Inspector.tsx`: shared property panel.
- `apps/web/src/workbench/components/TaskDrawer.tsx`: real batch task status.
- `apps/web/src/workbench/components/EvaluationDrawer.tsx`: scoped reports and feedback.
- `apps/web/src/workbench/stages/ContentStage.tsx`: script, episode, scene workflow.
- `apps/web/src/workbench/stages/AssetStage.tsx`: character/scene asset workflow.
- `apps/web/src/workbench/stages/ShotStage.tsx`: table/image/video modes with one shot selection.
- `apps/web/src/workbench/stages/DeliveryStage.tsx`: continuous preview, read-only timeline, export and publish.
- `apps/web/src/workbench/styles/tokens.css`: both theme token sets.
- `apps/web/src/workbench/styles/shell.css`: immersive header and three-column shell.
- `apps/web/src/workbench/styles/components.css`: shared controls, rail, canvas, Inspector, drawers.
- `apps/web/src/workbench/styles/stages.css`: stage-specific layouts only.
- `apps/web/src/workbench/styles/responsive.css`: viewport behavior.
- `apps/web/e2e/workbench.spec.ts`: functional, theme, responsive, and accessibility tests.
- `apps/web/playwright.config.ts`: deterministic browser configuration.
- `docs/design-qa.md`: screenshot comparison evidence and final result.

**Modify**

- `apps/web/src/App.tsx`: persisted theme and immersive project route.
- `apps/web/src/pages/ProjectWorkbenchPage.tsx`: orchestration only; remove extracted stage code.
- `apps/web/src/pages/projectWorkbenchModel.ts`: re-export compatibility functions during migration, then reduce.
- `apps/web/src/pages/projectWorkbenchModel.test.ts`: retain legacy selector assertions until migrated.
- `apps/web/src/main.tsx`: import scoped workbench styles; remove legacy override import after migration.
- `apps/web/src/light-theme.css`: delete workbench-specific overrides only.
- `apps/web/src/project-workbench-overrides.css`: remove after all owned rules are migrated.
- `apps/web/src/pages/ProjectStudioV4.css`: remove workbench-owned rules and import.
- `apps/web/package.json` and `pnpm-lock.yaml`: add browser test commands and dependencies.
- `docs/manjiao_deployment_quick_reference.md`: append release, backup, fingerprint, and verification evidence.

## Task 1: Theme, Capabilities, and Selection Model

**Files:**
- Create: `apps/web/src/workbench/model.ts`
- Create: `apps/web/src/workbench/model.test.ts`
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add the model test command and failing tests**

Add `src/workbench/model.test.ts` to `test:unit`, then write tests for persisted theme resolution, Release A capabilities, parent/child selection, rebuild invalidation, and cross-stage shot preservation:

```ts
test("release A hides unsupported commands", () => {
  assert.deepEqual(RELEASE_A_CAPABILITIES, {
    autosave: false,
    singleShotVideo: false,
    timelineEdit: false,
    shotCrud: false,
    perRunModelOverride: false
  });
});

test("keeps a valid shot while changing mode and delivery stage", () => {
  const initial = createWorkbenchState({ episodeNo: 1, sceneKey: storyboardScene("1:1"), shotId: "shot-2" });
  const video = workbenchReducer(initial, { type: "set-shot-mode", mode: "video" });
  const delivery = workbenchReducer(video, { type: "set-stage", stage: "delivery" });
  assert.equal(delivery.activeShotId, "shot-2");
});
```

- [ ] **Step 2: Run the tests and confirm failure**

Run: `pnpm --filter @aifilm/web test:unit`

Expected: FAIL because `src/workbench/model.ts` does not exist.

- [ ] **Step 3: Implement the pure model**

Define exact public types and a reducer with no React dependency:

```ts
export type WorkbenchStage = "content" | "assets" | "shots" | "delivery";
export type ShotMode = "table" | "image" | "video";
export type SceneKey = { source: "derived" | "storyboard"; value: string };
export type ActiveAsset = { type: "character" | "scene"; id: string };

export interface WorkbenchCapabilities {
  autosave: boolean;
  singleShotVideo: boolean;
  timelineEdit: boolean;
  shotCrud: boolean;
  perRunModelOverride: boolean;
}

export const RELEASE_A_CAPABILITIES: WorkbenchCapabilities = Object.freeze({
  autosave: false,
  singleShotVideo: false,
  timelineEdit: false,
  shotCrud: false,
  perRunModelOverride: false
});
```

Implement `createWorkbenchState`, `workbenchReducer`, `reconcileSelection`, `resolveThemePreference`, `buildTaskSummary`, and existing timeline/episode selectors.

- [ ] **Step 4: Verify model behavior**

Run: `pnpm --filter @aifilm/web test:unit`

Expected: all unit tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/src/workbench/model.ts apps/web/src/workbench/model.test.ts pnpm-lock.yaml
git commit -m "feat: add workbench state and capability model"
```

## Task 2: Persisted Theme and Immersive Project Route

**Files:**
- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/src/workbench/WorkbenchContext.tsx`
- Test: `apps/web/src/workbench/model.test.ts`

- [ ] **Step 1: Add failing persisted-theme tests**

```ts
test("uses stored theme before system preference", () => {
  assert.equal(resolveThemePreference("light", true), "light");
  assert.equal(resolveThemePreference(null, true), "dark");
  assert.equal(resolveThemePreference(null, false), "light");
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @aifilm/web test:unit`

Expected: FAIL until the preference inputs are implemented.

- [ ] **Step 3: Make theme initialization deterministic**

Initialize from `localStorage.getItem("manjiao-theme")`, fall back to `matchMedia("(prefers-color-scheme: dark)")`, write `data-theme`, `color-scheme`, and storage whenever the user changes theme.

Render `ProjectWorkbenchPage` outside `Shell` when `activePage === "project"`:

```tsx
if (activePage === "project") {
  return error ? <><div className="error-banner">API 连接异常：{error}</div>{page}</> : page;
}

return <Shell {...shellProps}>{page}</Shell>;
```

Pass `theme` and `onThemeChange` to the workbench page rather than duplicating theme state.

- [ ] **Step 4: Create WorkbenchContext**

Expose `state`, `dispatch`, `capabilities`, `saveState`, and current workflow. Keep async commands outside the reducer.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @aifilm/web test:unit && pnpm --filter @aifilm/web typecheck`

Expected: PASS; project view typechecks without `Shell`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/workbench/WorkbenchContext.tsx apps/web/src/workbench/model.test.ts
git commit -m "feat: add immersive workbench route and persisted theme"
```

## Task 3: Semantic Tokens and Workspace Primitives

**Files:**
- Create: `apps/web/src/workbench/components/WorkbenchHeader.tsx`
- Create: `apps/web/src/workbench/components/ProductionWorkspace.tsx`
- Create: `apps/web/src/workbench/components/EntityRail.tsx`
- Create: `apps/web/src/workbench/components/MediaCanvas.tsx`
- Create: `apps/web/src/workbench/components/Inspector.tsx`
- Create: `apps/web/src/workbench/styles/tokens.css`
- Create: `apps/web/src/workbench/styles/shell.css`
- Create: `apps/web/src/workbench/styles/components.css`
- Create: `apps/web/src/workbench/styles/responsive.css`
- Modify: `apps/web/src/main.tsx`

- [ ] **Step 1: Add all spec tokens verbatim**

Create `tokens.css` with shared typography and both theme blocks. Include `--on-accent`, `--selection`, `--selection-soft`, `--overlay`, `--shadow-popover`, and `--media-border`.

- [ ] **Step 2: Build accessible primitives**

`ProductionWorkspace` must render exactly three direct children and use semantic slots:

```tsx
export function ProductionWorkspace({ rail, canvas, inspector }: Props) {
  return (
    <main className="wb-workspace">
      <EntityRail>{rail}</EntityRail>
      <section className="wb-canvas">{canvas}</section>
      <Inspector>{inspector}</Inspector>
    </main>
  );
}
```

`WorkbenchHeader` receives stages, save state, theme, and callbacks. It must not render unsupported commands or duplicate model controls.

- [ ] **Step 3: Implement exact desktop dimensions**

Use `68px 300px minmax(640px, 1fr) 392px`, stable media aspect ratios, and responsive drawers from the spec. No new `!important`, gradients, glow, or glass effects.

- [ ] **Step 4: Wire scoped imports**

Import the five workbench CSS files from `main.tsx`; keep old overrides temporarily until each migrated stage is verified.

- [ ] **Step 5: Verify tokens and typecheck**

Run:

```powershell
rg -n "!important|linear-gradient|radial-gradient|backdrop-filter" apps/web/src/workbench
pnpm --filter @aifilm/web typecheck
```

Expected: first command has no matches; typecheck PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/main.tsx apps/web/src/workbench/components apps/web/src/workbench/styles
git commit -m "feat: add dual-theme workbench shell"
```

## Task 4: Content Stage

**Files:**
- Create: `apps/web/src/workbench/stages/ContentStage.tsx`
- Modify: `apps/web/src/pages/ProjectWorkbenchPage.tsx`
- Test: `apps/web/src/workbench/model.test.ts`

- [ ] **Step 1: Add failing content selectors tests**

Test episode collection, derived scene source labels, scene reconciliation, and empty second episodes. Assert the primary action calls storyboard generation with both `artStyle` and `videoRatio`.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @aifilm/web test:unit`

Expected: FAIL for missing derived-scene selectors.

- [ ] **Step 3: Implement selectors and ContentStage**

Move script parsing and content rendering from `ProjectWorkbenchPage`. Show `从剧本识别` for derived rows, one selected scene, one primary action, and no precheck/stat card stack.

On success, refresh workflow and dispatch:

```ts
dispatch({ type: "reconcile-workflow", storyboards: resultStoryboards });
dispatch({ type: "set-stage", stage: "assets" });
```

- [ ] **Step 4: Verify current API payload**

Run unit tests and use a temporary API spy in the browser test to assert:

```json
{ "artStyle": "<project.artStyle>", "videoRatio": "<project.videoRatio>" }
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/workbench/stages/ContentStage.tsx apps/web/src/workbench/model.ts apps/web/src/workbench/model.test.ts apps/web/src/pages/ProjectWorkbenchPage.tsx
git commit -m "feat: migrate content stage to unified workbench"
```

## Task 5: Asset Stage

**Files:**
- Create: `apps/web/src/workbench/stages/AssetStage.tsx`
- Modify: `apps/web/src/pages/ProjectWorkbenchPage.tsx`
- Test: `apps/web/src/workbench/model.test.ts`

- [ ] **Step 1: Add failing asset mapping and feedback tests**

Assert character identity resolution, creator-reference separation, scene list derivation, and feedback inputs:

```ts
assert.deepEqual(buildAssetFeedbackTarget(sceneAsset), {
  stage: "image",
  assetId: sceneAsset.id,
  label: "场景资产反馈"
});
```

- [ ] **Step 2: Implement AssetStage**

Use one Character/Scene rail, large real media canvas, and a single Inspector. Keep upload/delete reference, character identity generation, scene generation, model/cost display, and errors. Do not render editable identity fields that lack an update API.

- [ ] **Step 3: Verify real commands**

Assert character generation submits `{ characterIds: [id], forceRegenerate }`; scene generation submits the selected asset ID; reference deletion does not mutate the identity asset.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @aifilm/web test:unit && pnpm --filter @aifilm/web typecheck`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/workbench/stages/AssetStage.tsx apps/web/src/workbench/model.ts apps/web/src/workbench/model.test.ts apps/web/src/pages/ProjectWorkbenchPage.tsx
git commit -m "feat: unify character and scene asset workspace"
```

## Task 6: Shot Stage

**Files:**
- Create: `apps/web/src/workbench/stages/ShotStage.tsx`
- Modify: `apps/web/src/pages/ProjectWorkbenchPage.tsx`
- Test: `apps/web/src/workbench/model.test.ts`

- [ ] **Step 1: Add failing shared-shot and media tests**

Test the same `activeShotId` across table/image/video modes, explicit image/video asset mapping, batch selection retention, save dirty state, and invalidation after storyboard rebuild.

- [ ] **Step 2: Implement one shot rail and three modes**

Move shot editing, image generation, media preview, and project-level video status into `ShotStage`. Hide `新增镜头` and single-shot video regeneration because `shotCrud` and `singleShotVideo` are false.

- [ ] **Step 3: Keep supported generation behavior**

- current image: `generateImages(projectId, { shotIds: [activeShotId] })`;
- selected images: `generateImages(projectId, { shotIds: selectedShotIds })`;
- all pending images: submit pending IDs;
- project video: `generateVideos(projectId)` only.

The confirmation dialog states that changing the model also updates the project default route.

- [ ] **Step 4: Verify save failure behavior**

On `updateStoryboardShot` failure, retain the draft, set save state to `保存失败`, and block selection change until the user retries or confirms discard.

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @aifilm/web test:unit && pnpm --filter @aifilm/web typecheck`

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/workbench/stages/ShotStage.tsx apps/web/src/workbench/model.ts apps/web/src/workbench/model.test.ts apps/web/src/pages/ProjectWorkbenchPage.tsx
git commit -m "feat: consolidate shot table image and video modes"
```

## Task 7: Delivery Stage

**Files:**
- Create: `apps/web/src/workbench/stages/DeliveryStage.tsx`
- Modify: `apps/web/src/pages/ProjectWorkbenchPage.tsx`
- Test: `apps/web/src/workbench/model.test.ts`

- [ ] **Step 1: Add failing timeline and publish-candidate tests**

Test sequential clip layout, poster-only rows, latest playable MP4, single-video candidates, export status, warnings, and published submission history.

- [ ] **Step 2: Implement DeliveryStage**

Render one clip rail, continuous player, read-only timeline, and delivery Inspector. The list must use `<img>` posters and never create one `<video preload="metadata">` per row.

Release A timeline renders playhead, selection, real durations, and zoom. Do not render cut, mute, or reorder controls.

- [ ] **Step 3: Preserve real delivery commands**

Keep `createExportJob` for TTS/subtitle/video_export, download, warnings/errors, publish candidate selection, title/category/description/cover, and existing submissions.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @aifilm/web test:unit && pnpm --filter @aifilm/web typecheck`

Expected: PASS; static inspection finds no list-level `<video>` elements.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/workbench/stages/DeliveryStage.tsx apps/web/src/workbench/model.ts apps/web/src/workbench/model.test.ts apps/web/src/pages/ProjectWorkbenchPage.tsx
git commit -m "feat: simplify delivery timeline and publishing"
```

## Task 8: Task/Evaluation Drawers and Legacy Cleanup

**Files:**
- Create: `apps/web/src/workbench/components/TaskDrawer.tsx`
- Create: `apps/web/src/workbench/components/EvaluationDrawer.tsx`
- Modify: `apps/web/src/pages/ProjectWorkbenchPage.tsx`
- Modify: `apps/web/src/light-theme.css`
- Modify/Delete: `apps/web/src/project-workbench-overrides.css`
- Modify: `apps/web/src/pages/ProjectStudioV4.css`
- Modify: `apps/web/src/main.tsx`

- [ ] **Step 1: Implement real batch task summaries**

Group `ProjectWorkflow.tasks` by task type; expose only server-provided pending/running/succeeded/failed/canceled/refunded state, fallback, and refund information. Do not claim entity-level progress.

- [ ] **Step 2: Implement scoped evaluation drawer**

Use character stage + asset ID, scene image stage + asset ID, and shot image/video asset ID. Keep manual evaluation trigger where currently supported. Quality scores never disable publish.

- [ ] **Step 3: Reduce ProjectWorkbenchPage to orchestration**

It may load export/package data and compose stages, but it must contain no stage body JSX and no direct generate/export/feedback API calls.

- [ ] **Step 4: Remove owned legacy CSS**

Use `rg` to build a selector list before deletion. Delete only selectors used exclusively by the migrated workbench. Remove `project-workbench-overrides.css` import when no required rule remains; do not modify unrelated pages.

- [ ] **Step 5: Verify cleanup**

Run:

```powershell
rg -n "api\.(generate|createExport|submitFeedback)" apps/web/src/pages/ProjectWorkbenchPage.tsx
rg -n "!important" apps/web/src/workbench
pnpm --filter @aifilm/web test:unit
pnpm --filter @aifilm/web typecheck
pnpm --filter @aifilm/web build
```

Expected: first two searches have no matches; all commands PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/main.tsx apps/web/src/light-theme.css apps/web/src/pages/ProjectWorkbenchPage.tsx apps/web/src/pages/ProjectStudioV4.css apps/web/src/workbench
git add -u apps/web/src/project-workbench-overrides.css
git commit -m "refactor: retire legacy workbench UI and overrides"
```

## Task 9: Browser, Visual, Responsive, and Accessibility QA

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/workbench.spec.ts`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `docs/design-qa.md`

- [ ] **Step 1: Add Playwright and axe**

Run:

```bash
pnpm --filter @aifilm/web add -D @playwright/test @axe-core/playwright
pnpm --filter @aifilm/web exec playwright install chromium
```

- [ ] **Step 2: Write deterministic tests**

Use a fixed authenticated project fixture or API route mocks that match real contracts. Assert four-stage switching, selection continuity, explicit save states, current API payloads, real task states, export, feedback target, theme persistence, drawers, and unsupported controls absent.

```ts
await expect(page.getByRole("button", { name: "剪切" })).toHaveCount(0);
await expect(page.getByRole("button", { name: "静音" })).toHaveCount(0);
await expect(page.getByRole("button", { name: "重新生成视频" })).toHaveCount(0);
```

- [ ] **Step 3: Add viewport and overflow checks**

Test `2048x1152`, `1440x900`, `1366x768`, `1024x768`, `768x1024`, and `390x844` in both themes. Exclude `.timeline-scroll` from the document overflow assertion.

- [ ] **Step 4: Add visual comparisons**

Mask dynamic media, then compare the 2048x1152 light/dark states to the two design references. Assert header `68±1px`, rail `300±1px`, Inspector `392±1px`, and pixel difference below 0.5% after stable baselines are accepted.

- [ ] **Step 5: Run accessibility and keyboard tests**

Assert axe serious/critical violations are zero. Exercise Header, Rail, mode tabs, Inspector, Task/Evaluation drawers, Escape close, focus return, and reduced-motion.

- [ ] **Step 6: Record QA evidence**

Write `docs/design-qa.md` with commands, viewport screenshots, mismatches fixed, remaining masked dynamic regions, and final line exactly:

```text
final result: passed
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json apps/web/playwright.config.ts apps/web/e2e/workbench.spec.ts pnpm-lock.yaml docs/design-qa.md
git commit -m "test: verify dual-theme workbench experience"
```

## Task 10: Final Review, Production Backup, Deploy, and Push

**Files:**
- Modify: `docs/manjiao_deployment_quick_reference.md`
- Create locally: `tmp/manjiao_workbench_release_<timestamp>.tar`
- Create on server: `/opt/manjiao-backups/<timestamp>_dual_theme_workbench/`

- [ ] **Step 1: Run the complete local gate**

```bash
pnpm --filter @aifilm/web test:unit
pnpm --filter @aifilm/web typecheck
pnpm --filter @aifilm/web build
pnpm --filter @aifilm/web exec playwright test
pnpm typecheck
```

Expected: all PASS and `docs/design-qa.md` ends with `final result: passed`.

- [ ] **Step 2: Run code review and reality checks**

Use project agents `engineering-frontend-developer.toml`, `testing-reality-checker.toml`, and `testing-accessibility-auditor.toml`. Fix P0/P1 findings, rerun affected gates, and commit each fix separately.

- [ ] **Step 3: Create and verify a clean release archive**

Use `git archive HEAD` so `.env`, storage, databases, node_modules, output, and unrelated untracked files are excluded. List the archive and verify it contains the workbench source and no secrets.

- [ ] **Step 4: Back up production before extraction**

On SSH alias `manjiao`:

```bash
stamp=$(date +%Y%m%d_%H%M%S)
backup=/opt/manjiao-backups/${stamp}_dual_theme_workbench
mkdir -p "$backup"
tar -C /opt/manjiao -czf "$backup/source.tgz" apps/web deploy docker-compose.prod.yml .env.production
docker compose -f /opt/manjiao/docker-compose.prod.yml exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup/aigc_drama.dump"
docker compose -f /opt/manjiao/docker-compose.prod.yml exec -T api sh -lc 'cd /app && tar -czf - storage' > "$backup/storage.tar.gz"
test -s "$backup/source.tgz" && test -s "$backup/aigc_drama.dump" && test -s "$backup/storage.tar.gz"
```

- [ ] **Step 5: Retain the newest three verified backups**

List backup directories newest first, resolve each absolute path under `/opt/manjiao-backups`, and remove only entries after the newest three. Never delete before Step 4 integrity checks pass.

- [ ] **Step 6: Deploy the clean archive**

Upload the timestamped archive to `/tmp`, extract into `/opt/manjiao`, then run:

```bash
cd /opt/manjiao
docker compose -f docker-compose.prod.yml up --build -d web api nginx
docker compose -f docker-compose.prod.yml ps
curl -fsS http://127.0.0.1:8080/health
```

- [ ] **Step 7: Verify public production**

```powershell
curl.exe -fsS https://manjiao.cloud/health
curl.exe -fsS https://api.manjiao.cloud/health
curl.exe -fsSI https://manjiao.cloud/
```

Open production in Chromium and verify login, project open, all four stages, both themes, one real generation confirmation, export visibility, mobile overflow, and no console errors.

- [ ] **Step 8: Record release evidence and commit**

Append timestamp, backup directory, retained backups, asset fingerprint, commands, public HTTP results, browser results, and rollback archive to `docs/manjiao_deployment_quick_reference.md`.

```bash
git add docs/manjiao_deployment_quick_reference.md
git commit -m "docs: record dual-theme workbench deployment"
```

- [ ] **Step 9: Push the current branch**

```bash
git push origin codex/cine4k-light-theme
```

Expected: remote branch advances to the deployment record commit. Do not force-push.

## Self-Review Results

- Spec coverage: all Release A IA, theme, real workflow, task, evaluation, responsive, accessibility, QA, backup, deploy, and push requirements map to Tasks 1-10.
- Release B isolation: unsupported autosave, shot CRUD, single-shot video, timeline edit, per-run model override, and entity-level task progress are hidden, not simulated.
- Type consistency: `WorkbenchStage`, `ShotMode`, `WorkbenchCapabilities`, and shared selection names match the confirmed design spec.
- Placeholder scan: no TBD/TODO or unspecified implementation steps remain.
