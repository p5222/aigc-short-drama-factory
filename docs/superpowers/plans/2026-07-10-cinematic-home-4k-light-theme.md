# Cinematic Home 4K and Light Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the B1 cinematic card stack with reliable click targets, direct 4K reference playback and active-card synchronization, then replace the creator application's washed-out light mode with the approved Sub2API teal-neutral theme.

**Architecture:** Pure media and card-layout policy lives in a tested model module; `LoginPage` owns DOM media refs, double-buffer transitions, fallback state, and background/card synchronization. Visual cards and semantic hit targets are separate layers. A dedicated stylesheet imported after the legacy CSS owns all creator light-theme tokens and overrides, while the admin console remains unchanged.

**Tech Stack:** React 19, TypeScript 5.9, GSAP 3, Vite 7, Node 24 test runner, HTML5 video, FFmpeg/ffprobe, CSS custom properties, Docker Compose, Nginx.

---

## File Map

- Create `apps/web/src/pages/cineHomeModel.ts`: media-tier policy, fallback candidates, drift tolerance, circular card offsets, and B1/expanded card poses.
- Create `apps/web/src/pages/cineHomeModel.test.mjs`: dependency-free Node tests for the pure model.
- Create `apps/web/src/pages/cineScenes.ts`: five scene definitions and their 4K/2K/fast candidates.
- Modify `apps/web/src/pages/LoginPage.tsx`: background fallback, next-scene preload, visual/hit layers, card videos, synchronization, and keyboard interaction.
- Modify `apps/web/src/pages/CineHome.css`: B1 sizing/positioning, visual/hit-layer CSS, responsive layout, and pointer-event rules.
- Create `apps/web/src/light-theme.css`: approved Sub2API creator-theme tokens and component overrides.
- Modify `apps/web/src/main.tsx`: import the dedicated light theme after `styles.css`.
- Modify `apps/web/src/styles.css`: remove the superseded creator light-theme block only; retain unscoped admin and showcase fixes.
- Modify `apps/web/package.json`: add the focused unit-test command.
- Modify `.env.example` and `.env.production.example`: document `VITE_CINE_MEDIA_TIER=4k` and rollback values.
- Create `apps/web/public/media/cineart-home/*_4k.mp4`: five remuxed FastStart 4K originals.
- Create `apps/web/public/media/cineart-home/ORIGINS.md` and `SHA256SUMS.txt`: provenance and integrity records.
- Verify `deploy/nginx.conf`: existing MP4 Range and immutable-cache rules must remain unchanged.

## Task 1: Add Tested Media and Card Policy

**Files:**
- Create: `apps/web/src/pages/cineHomeModel.ts`
- Create: `apps/web/src/pages/cineHomeModel.test.mjs`
- Modify: `apps/web/package.json`

- [ ] **Step 1: Write the failing model tests**

Create `apps/web/src/pages/cineHomeModel.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMediaCandidates,
  getCardPose,
  normalizeMediaTier,
  relativeCardOffset,
  shouldCorrectDrift
} from "./cineHomeModel.ts";

test("normalizes configured media tiers", () => {
  assert.equal(normalizeMediaTier("4k"), "4k");
  assert.equal(normalizeMediaTier("2k"), "2k");
  assert.equal(normalizeMediaTier("fast"), "fast");
  assert.equal(normalizeMediaTier("unknown"), "4k");
  assert.equal(normalizeMediaTier(undefined), "4k");
});

test("builds ordered fallback candidates", () => {
  assert.deepEqual(buildMediaCandidates("desert", "4k", ""), [
    "/media/cineart-home/desert_4k.mp4",
    "/media/cineart-home/desert_2k.mp4",
    "/media/cineart-home/desert_fast.mp4"
  ]);
  assert.deepEqual(buildMediaCandidates("photo-w", "2k", "https://cdn.example.com/"), [
    "https://cdn.example.com/media/cineart-home/photo-w_2k.mp4",
    "https://cdn.example.com/media/cineart-home/photo-w_fast.mp4"
  ]);
  assert.deepEqual(buildMediaCandidates("punk-future", "fast", ""), [
    "/media/cineart-home/punk-future_fast.mp4"
  ]);
});

test("wraps five-card offsets around the active card", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((index) => relativeCardOffset(index, 0, 5)), [0, 1, 2, -2, -1]);
  assert.deepEqual([0, 1, 2, 3, 4].map((index) => relativeCardOffset(index, 3, 5)), [2, -2, -1, 0, 1]);
});

test("returns the approved B1 collapsed geometry", () => {
  assert.deepEqual(getCardPose(0, 0, false, 5), {
    x: 0, y: -6, z: 120, rotateY: 0, rotateZ: 0, scale: 1, opacity: 1, zIndex: 90
  });
  assert.equal(getCardPose(1, 0, false, 5).x, 20);
  assert.equal(getCardPose(2, 0, false, 5).x, 40);
  assert.equal(getCardPose(4, 0, false, 5).x, -20);
});

test("spreads all cards in expanded geometry", () => {
  assert.equal(getCardPose(1, 0, true, 5).x, 124);
  assert.equal(getCardPose(2, 0, true, 5).x, 220);
  assert.equal(getCardPose(3, 0, true, 5).x, -220);
});

test("only corrects visible playback drift beyond 120ms", () => {
  assert.equal(shouldCorrectDrift(4, 4.1), false);
  assert.equal(shouldCorrectDrift(4, 4.121), true);
  assert.equal(shouldCorrectDrift(4.2, 4), true);
});
```

- [ ] **Step 2: Run the test and verify the module is missing**

Run:

```powershell
node --test apps/web/src/pages/cineHomeModel.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `cineHomeModel.ts`.

- [ ] **Step 3: Implement the pure model**

Create `apps/web/src/pages/cineHomeModel.ts`:

```ts
export type CineMediaTier = "4k" | "2k" | "fast";

export interface CineCardPose {
  x: number;
  y: number;
  z: number;
  rotateY: number;
  rotateZ: number;
  scale: number;
  opacity: number;
  zIndex: number;
}

const fallbackOrder: Record<CineMediaTier, CineMediaTier[]> = {
  "4k": ["4k", "2k", "fast"],
  "2k": ["2k", "fast"],
  fast: ["fast"]
};

export function normalizeMediaTier(value: string | undefined): CineMediaTier {
  return value === "2k" || value === "fast" || value === "4k" ? value : "4k";
}

export function buildMediaCandidates(name: string, preferredTier: CineMediaTier, baseUrl: string): string[] {
  const cleanBaseUrl = baseUrl.replace(/\/+$/, "");
  return fallbackOrder[preferredTier].map((tier) => `${cleanBaseUrl}/media/cineart-home/${name}_${tier}.mp4`);
}

export function relativeCardOffset(index: number, activeIndex: number, total: number): number {
  let offset = index - activeIndex;
  if (offset > total / 2) offset -= total;
  if (offset < -total / 2) offset += total;
  return offset;
}

export function getCardPose(index: number, activeIndex: number, expanded: boolean, total: number): CineCardPose {
  const offset = relativeCardOffset(index, activeIndex, total);
  const depth = Math.abs(offset);
  const isActive = depth === 0;

  if (expanded) {
    const x = offset === 0 ? 0 : Math.sign(offset) * (depth === 1 ? 124 : 220);
    return {
      x,
      y: isActive ? -20 : depth === 1 ? 14 : 34,
      z: isActive ? 120 : -depth * 18,
      rotateY: offset * -5,
      rotateZ: offset * 7,
      scale: isActive ? 1.04 : depth === 1 ? 0.94 : 0.88,
      opacity: isActive ? 1 : depth === 1 ? 0.9 : 0.78,
      zIndex: isActive ? 90 : 70 - depth * 10
    };
  }

  return {
    x: offset * 20,
    y: isActive ? -6 : depth === 1 ? 4 : 10,
    z: isActive ? 120 : -depth * 24,
    rotateY: offset * -2,
    rotateZ: offset * 3,
    scale: isActive ? 1 : depth === 1 ? 0.94 : 0.88,
    opacity: isActive ? 1 : depth === 1 ? 0.88 : 0.72,
    zIndex: isActive ? 90 : 70 - depth * 10
  };
}

export function shouldCorrectDrift(backgroundTime: number, cardTime: number, toleranceSeconds = 0.12): boolean {
  return Math.abs(backgroundTime - cardTime) > toleranceSeconds;
}
```

- [ ] **Step 4: Add and run the focused test command**

Add this script to `apps/web/package.json`:

```json
"test:unit": "node --test src/pages/cineHomeModel.test.mjs"
```

Run:

```powershell
pnpm --filter @aifilm/web test:unit
pnpm --filter @aifilm/web typecheck
```

Expected: six tests PASS; TypeScript exits 0.

- [ ] **Step 5: Commit the policy slice**

```powershell
git add apps/web/package.json apps/web/src/pages/cineHomeModel.ts apps/web/src/pages/cineHomeModel.test.mjs
git commit -m "feat: add cinematic media and card policy"
```

## Task 2: Acquire and Validate the Five 4K Originals

**Files:**
- Create: `apps/web/public/media/cineart-home/desert_4k.mp4`
- Create: `apps/web/public/media/cineart-home/photo-w_4k.mp4`
- Create: `apps/web/public/media/cineart-home/punk-future_4k.mp4`
- Create: `apps/web/public/media/cineart-home/girl-booth_4k.mp4`
- Create: `apps/web/public/media/cineart-home/bicycle-smile_4k.mp4`
- Create: `apps/web/public/media/cineart-home/ORIGINS.md`
- Create: `apps/web/public/media/cineart-home/SHA256SUMS.txt`

- [ ] **Step 1: Verify the target directory before downloading**

Run:

```powershell
$mediaDir = Resolve-Path 'apps/web/public/media/cineart-home'
if ($mediaDir.Path -ne 'E:\AI漫剧\apps\web\public\media\cineart-home') { throw "Unexpected media path: $($mediaDir.Path)" }
```

Expected: no output and exit 0.

- [ ] **Step 2: Download the exact reference assets to temporary source names**

Run:

```powershell
$sources = [ordered]@{
  'desert' = 'https://landpage.geetvip.com/cine-landpage-video/4k/desert_fast.mp4'
  'photo-w' = 'https://landpage.geetvip.com/cine-landpage-video/4k/photo-w_fast.mp4'
  'punk-future' = 'https://landpage.geetvip.com/cine-landpage-video/4k/punk-future_fast.mp4'
  'girl-booth' = 'https://landpage.geetvip.com/cine-landpage-video/4k/girl-booth_fast.mp4'
  'bicycle-smile' = 'https://landpage.geetvip.com/cine-landpage-video/4k/bicycle-smile_fast.mp4'
}

foreach ($entry in $sources.GetEnumerator()) {
  $target = Join-Path $mediaDir "$($entry.Key)_4k.source.mp4"
  curl.exe -fL --retry 3 --retry-delay 2 -o $target $entry.Value
  if ($LASTEXITCODE -ne 0) { throw "Download failed: $($entry.Key)" }
}
```

Expected: five `.source.mp4` files, total size about 97MB.

- [ ] **Step 3: Remux without re-encoding and move the MP4 index to the front**

Run:

```powershell
foreach ($name in $sources.Keys) {
  $source = Join-Path $mediaDir "${name}_4k.source.mp4"
  $target = Join-Path $mediaDir "${name}_4k.mp4"
  ffmpeg -hide_banner -loglevel error -y -i $source -map 0:v:0 -an -c:v copy -movflags +faststart $target
  if ($LASTEXITCODE -ne 0) { throw "FastStart remux failed: $name" }
}
```

Expected: five `_4k.mp4` files; FFmpeg exits 0 and performs no video re-encoding.

- [ ] **Step 4: Validate exact dimensions and durations**

Run:

```powershell
$expected = @{
  'desert' = '3856,2148,24/1'
  'photo-w' = '3856,2148,24/1'
  'punk-future' = '3856,2148,24/1'
  'girl-booth' = '3836,2160,24/1'
  'bicycle-smile' = '3856,2148,24/1'
}

foreach ($name in $expected.Keys) {
  $file = Join-Path $mediaDir "${name}_4k.mp4"
  $actual = ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate -of csv=p=0 $file
  if ($actual.Trim() -ne $expected[$name]) { throw "Unexpected metadata for ${name}: $actual" }
}
```

Expected: no output and exit 0.

- [ ] **Step 5: Record provenance and checksums, then remove temporary sources**

Create `apps/web/public/media/cineart-home/ORIGINS.md` with this exact content:

```markdown
# CineArt Homepage 4K Sources

Downloaded 2026-07-10 and remuxed with `-c:v copy -movflags +faststart`. Video frames were not re-encoded.

| Name | Resolution | FPS | Source |
| --- | --- | --- | --- |
| desert | 3856x2148 | 24 | https://landpage.geetvip.com/cine-landpage-video/4k/desert_fast.mp4 |
| photo-w | 3856x2148 | 24 | https://landpage.geetvip.com/cine-landpage-video/4k/photo-w_fast.mp4 |
| punk-future | 3856x2148 | 24 | https://landpage.geetvip.com/cine-landpage-video/4k/punk-future_fast.mp4 |
| girl-booth | 3836x2160 | 24 | https://landpage.geetvip.com/cine-landpage-video/4k/girl-booth_fast.mp4 |
| bicycle-smile | 3856x2148 | 24 | https://landpage.geetvip.com/cine-landpage-video/4k/bicycle-smile_fast.mp4 |
```

Then run:

```powershell
Get-ChildItem $mediaDir -Filter '*_4k.mp4' | Sort-Object Name | ForEach-Object {
  $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
  "$($hash.Hash.ToLowerInvariant())  $($_.Name)"
} | Set-Content -Path (Join-Path $mediaDir 'SHA256SUMS.txt') -Encoding ascii

Get-ChildItem $mediaDir -Filter '*_4k.source.mp4' | ForEach-Object {
  if ($_.DirectoryName -ne $mediaDir.Path) { throw "Refusing to remove unexpected path: $($_.FullName)" }
  Remove-Item -LiteralPath $_.FullName
}
```

Expected: five final MP4 files, no `.source.mp4` files, and five checksum lines.

- [ ] **Step 6: Commit the asset slice**

```powershell
git add apps/web/public/media/cineart-home/*_4k.mp4 apps/web/public/media/cineart-home/ORIGINS.md apps/web/public/media/cineart-home/SHA256SUMS.txt
git commit -m "feat: add original cinematic 4k media"
```

## Task 3: Move Scene Media Policy Out of LoginPage

**Files:**
- Create: `apps/web/src/pages/cineScenes.ts`
- Modify: `apps/web/src/pages/LoginPage.tsx:32-98`
- Modify: `.env.example`
- Modify: `.env.production.example`

- [ ] **Step 1: Extend the model test for scene fallback selection**

Add to `cineHomeModel.test.mjs`:

```js
test("keeps each scene fallback list independent", () => {
  const desert = buildMediaCandidates("desert", "4k", "");
  const bicycle = buildMediaCandidates("bicycle-smile", "4k", "");
  assert.equal(desert[0], "/media/cineart-home/desert_4k.mp4");
  assert.equal(bicycle[0], "/media/cineart-home/bicycle-smile_4k.mp4");
  assert.notEqual(desert[1], bicycle[1]);
});
```

- [ ] **Step 2: Run the focused tests**

```powershell
pnpm --filter @aifilm/web test:unit
```

Expected: seven tests PASS.

- [ ] **Step 3: Create the scene manifest**

Create `apps/web/src/pages/cineScenes.ts`:

```ts
import type { PublicScene } from "./PublicShowcase";
import { buildMediaCandidates, normalizeMediaTier } from "./cineHomeModel";

export interface CineScene extends PublicScene {
  mediaName: string;
  videoCandidates: string[];
}

const baseUrl = (import.meta.env.VITE_CINE_ASSET_BASE_URL ?? "").replace(/\/+$/, "");
const preferredTier = normalizeMediaTier(import.meta.env.VITE_CINE_MEDIA_TIER);

function scene(input: Omit<CineScene, "videoUrl" | "videoCandidates">): CineScene {
  const videoCandidates = buildMediaCandidates(input.mediaName, preferredTier, baseUrl);
  return { ...input, videoUrl: videoCandidates[0], videoCandidates };
}

export const cineScenes: CineScene[] = [
  scene({
    id: "01", mediaName: "desert", posterUrl: `${baseUrl}/media/cineart-home/desert_poster.jpg`,
    eyebrow: "CINE·CAM 01", meta: "SHOT-LEVEL PRECISION",
    title: { cn: "分镜级精准控制", en: "Shot-level precision" },
    scanLabel: { cn: "[ 分镜级精准控制 ]", en: "[ SHOT LOCKED ]" }, activeLabel: "REC"
  }),
  scene({
    id: "02", mediaName: "photo-w", posterUrl: `${baseUrl}/media/cineart-home/photo-w_poster.jpg`,
    eyebrow: "CINE·CAM 02", meta: "CHARACTER CONSISTENCY",
    title: { cn: "角色跨镜头一致", en: "Character consistency" },
    scanLabel: { cn: "[ 角色一致设定 ]", en: "[ CHARACTER LOCK ]" }
  }),
  scene({
    id: "03", mediaName: "punk-future", posterUrl: `${baseUrl}/media/cineart-home/punk-future_poster.jpg`,
    eyebrow: "CINE·CAM 03", meta: "STYLE, LOCKED",
    title: { cn: "风格一键锁定", en: "Style, locked" },
    scanLabel: { cn: "[ 风格一致设定 ]", en: "[ STYLE LOCKED ]" }
  }),
  scene({
    id: "04", mediaName: "girl-booth", posterUrl: `${baseUrl}/media/cineart-home/girl-booth_poster.jpg`,
    eyebrow: "CINE·CAM 04", meta: "ASSETS THAT COMPOUND",
    title: { cn: "资产沉淀复用", en: "Reusable assets" },
    scanLabel: { cn: "[ 资产沉淀复用 ]", en: "[ ASSET MEMORY ]" }
  }),
  scene({
    id: "05", mediaName: "bicycle-smile", posterUrl: `${baseUrl}/media/cineart-home/bicycle-smile_poster.jpg`,
    eyebrow: "CINE·CAM 05", meta: "QUEUE IT, SHIP IT",
    title: { cn: "极速出片", en: "Queue it, ship it" },
    scanLabel: { cn: "[ 极速生产闭环 ]", en: "[ FAST PIPELINE ]" }
  })
];
```

- [ ] **Step 4: Replace the local scene block and document the tier**

In `LoginPage.tsx`, delete `HomeScene`, `cineAssetBaseUrl`, `cineAsset`, `cineVideoAsset`, and the local `scenes` array. Import and alias the manifest:

```ts
import { cineScenes as scenes } from "./cineScenes";
```

Keep `PublicScene.videoUrl` as the public preview-compatible URL. Add this line to both env examples:

```dotenv
VITE_CINE_MEDIA_TIER=4k
```

Add an adjacent comment in `.env.production.example`:

```dotenv
# Roll back to 2k or fast if direct 4K validation fails on the production network.
```

- [ ] **Step 5: Verify and commit**

```powershell
pnpm --filter @aifilm/web test:unit
pnpm --filter @aifilm/web typecheck
git add apps/web/src/pages/cineScenes.ts apps/web/src/pages/LoginPage.tsx apps/web/src/pages/cineHomeModel.test.mjs .env.example .env.production.example
git commit -m "refactor: centralize cinematic scene media"
```

Expected: tests and typecheck pass; the commit contains no generated build output.

## Task 4: Add Per-Scene Fallback and Real Next-Scene Preload

**Files:**
- Modify: `apps/web/src/pages/LoginPage.tsx:248-403`

- [ ] **Step 1: Add explicit fallback state and slot ownership**

Add these fields near the current scene state and refs:

```ts
const [visibleScene, setVisibleScene] = useState(0);
const [sceneSourceIndexes, setSceneSourceIndexes] = useState(() => scenes.map(() => 0));
const slotSceneIndexes = useRef<[number, number]>([0, 1]);
const sceneUrls = useMemo(
  () => scenes.map((scene, index) => {
    const sourceIndex = sceneSourceIndexes[index] ?? 0;
    return scene.videoCandidates[Math.min(sourceIndex, scene.videoCandidates.length - 1)];
  }),
  [sceneSourceIndexes]
);

const fallbackScene = useCallback((sceneIndex: number, failedSource: string) => {
  setSceneSourceIndexes((current) => {
    const scene = scenes[sceneIndex];
    const currentIndex = current[sceneIndex] ?? 0;
    if (!scene || currentIndex >= scene.videoCandidates.length - 1) return current;
    if (scene.videoCandidates[currentIndex] !== failedSource) return current;
    const next = [...current];
    next[sceneIndex] = currentIndex + 1;
    return next;
  });
}, []);
```

- [ ] **Step 2: Reduce the first-frame timeout to the approved value**

Change:

```ts
const BG_FRAME_TIMEOUT_MS = 8000;
```

Expected: 4K gets eight seconds to expose a drawable frame before fallback.

- [ ] **Step 3: Replace detached warmup with hidden-slot preload**

Delete `warmupVideoRef` and the idle-created detached video effect. Add this callback:

```ts
const primeHiddenSlot = useCallback((sceneIndex: number) => {
  if (publicView !== "home") return;
  const slot = (1 - visibleBgSlot.current) as 0 | 1;
  const video = bgRefs.current[slot];
  if (!video) return;
  slotSceneIndexes.current[slot] = sceneIndex;
  video.poster = scenes[sceneIndex].posterUrl;
  video.preload = "auto";
  if (video.getAttribute("src") !== sceneUrls[sceneIndex]) {
    video.src = sceneUrls[sceneIndex];
    video.load();
  }
  video.pause();
}, [publicView, sceneUrls]);
```

After the initial background has a drawable frame, call:

```ts
primeHiddenSlot(1 % scenes.length);
```

After each crossfade completes and the old slot is released, call:

```ts
primeHiddenSlot((sceneIndex + 1) % scenes.length);
```

- [ ] **Step 4: Reuse a primed slot and fall back on failure**

Replace every background assignment of `scene.videoUrl` with `sceneUrls[sceneIndex]` (or `sceneUrls[0]` for initial load). Add `sceneUrls[0]` and `primeHiddenSlot` to the initial-load effect dependencies, and add `sceneUrls`, `fallbackScene`, and `primeHiddenSlot` to the requested-scene effect dependencies.

For initial load, wait for the first drawable frame before priming the next slot:

```ts
const requestStartedAt = performance.now();
void waitForDrawableFrame(primary).then((ready) => {
  if (!ready) {
    console.warn("[cine-media]", { event: "fallback", scene: scenes[0].mediaName, source: sceneUrls[0] });
    fallbackScene(0, sceneUrls[0]);
    return;
  }
  console.info("[cine-media]", {
    event: "first-frame",
    scene: scenes[0].mediaName,
    source: sceneUrls[0],
    waitMs: Math.round(performance.now() - requestStartedAt)
  });
  primeHiddenSlot(1 % scenes.length);
});
```

When requesting a scene, set `slotSceneIndexes.current[toSlot] = sceneIndex`. Only assign/load `toVideo.src` when it differs from `sceneUrls[sceneIndex]`. Record the request start time before loading:

```ts
const requestStartedAt = performance.now();
```

After a drawable frame is ready, update the visible scene and record first-frame latency:

```ts
setVisibleScene(sceneIndex);
console.info("[cine-media]", {
  event: "first-frame",
  scene: scenes[sceneIndex].mediaName,
  source: sceneUrls[sceneIndex],
  waitMs: Math.round(performance.now() - requestStartedAt)
});
```

Replace the failed-frame branch with:

```ts
if (!ready) {
  stopAndReleaseVideo(toVideo);
  console.warn("[cine-media]", {
    event: "fallback",
    scene: scenes[sceneIndex].mediaName,
    source: sceneUrls[sceneIndex]
  });
  fallbackScene(sceneIndex, sceneUrls[sceneIndex]);
  return;
}
```

Wire each background element error to its owned scene:

```tsx
onError={() => {
  const sceneIndex = slotSceneIndexes.current[slot];
  fallbackScene(sceneIndex, sceneUrls[sceneIndex]);
}}
```

Add an effect that reloads the visible slot if its current source itself falls back after playback has begun:

```ts
useEffect(() => {
  if (publicView !== "home") return;
  const video = bgRefs.current[visibleBgSlot.current];
  const expectedSource = sceneUrls[visibleScene];
  if (!video || !expectedSource || video.getAttribute("src") === expectedSource) return;
  slotSceneIndexes.current[visibleBgSlot.current] = visibleScene;
  video.poster = scenes[visibleScene].posterUrl;
  video.src = expectedSource;
  video.load();
  void video.play().catch(() => undefined);
}, [publicView, sceneUrls, visibleScene]);
```

- [ ] **Step 5: Verify rapid requests cannot revive stale sources**

Run:

```powershell
pnpm --filter @aifilm/web test:unit
pnpm --filter @aifilm/web typecheck
```

Expected: all tests pass; the existing `bgRequestId` guard remains in place and TypeScript exits 0.

- [ ] **Step 6: Commit the playback foundation**

```powershell
git add apps/web/src/pages/LoginPage.tsx
git commit -m "feat: add cinematic 4k fallback preload"
```

## Task 5: Build the B1 Visual Stack and Independent Hit Map

**Files:**
- Modify: `apps/web/src/pages/LoginPage.tsx:404-439, 808-858`
- Modify: `apps/web/src/pages/CineHome.css:317-510, 989-1110`

- [ ] **Step 1: Split visual and interaction refs**

Replace `cardRefs` with:

```ts
const visualCardRefs = useRef<Array<HTMLDivElement | null>>([]);
const hitCardRefs = useRef<Array<HTMLButtonElement | null>>([]);
const cardVideoRefs = useRef<Array<HTMLVideoElement | null>>([]);
```

- [ ] **Step 2: Drive both layers from the tested pose function**

Import `getCardPose` and `relativeCardOffset`, and import `KeyboardEvent` as a type alongside `FormEvent`. Then replace the current card animation effect with:

```ts
useEffect(() => {
  if (publicView !== "home") return undefined;
  const animated: Element[] = [];

  scenes.forEach((_scene, index) => {
    const pose = getCardPose(index, activeScene, stackExpanded, scenes.length);
    const visual = visualCardRefs.current[index];
    const hit = hitCardRefs.current[index];
    const targets = [visual, hit].filter((element): element is HTMLElement => Boolean(element));
    animated.push(...targets);
    gsap.to(targets, {
      x: pose.x, y: pose.y, z: pose.z,
      rotateY: pose.rotateY, rotateZ: pose.rotateZ,
      scale: pose.scale, opacity: pose.opacity,
      force3D: true, transformPerspective: 1180,
      duration: stackExpanded ? 0.5 : 0.38,
      ease: "power3.out", overwrite: true
    });
    if (visual) visual.style.zIndex = String(pose.zIndex);
    if (hit) hit.style.zIndex = String(200 + pose.zIndex);
  });

  return () => gsap.killTweensOf(animated);
}, [activeScene, publicView, stackExpanded]);
```

- [ ] **Step 3: Render visual cards and semantic hit targets separately**

Replace the current `scenes.map` card buttons with this two-layer structure:

```tsx
<div className="cine-card-visual-layer" aria-hidden="true">
  {scenes.map((scene, index) => {
    const isActive = index === activeScene;
    return (
      <div
        className={isActive ? "cine-film-card cine-card-visual active" : "cine-film-card cine-card-visual"}
        key={`visual-${scene.id}`}
        ref={(node) => { visualCardRefs.current[index] = node; }}
      >
        <video
          className="cine-card-media"
          src={sceneUrls[index]}
          poster={scene.posterUrl}
          muted
          playsInline
          loop
          preload={isActive ? "auto" : "metadata"}
          onError={() => fallbackScene(index, sceneUrls[index])}
          ref={(node) => { cardVideoRefs.current[index] = node; }}
        />
        <div className="cine-card-overlay" />
        <div className="cine-card-sheen" />
        <div className="cine-card-corners" />
        <div className="cine-card-head"><span>{scene.eyebrow}</span>{isActive ? <b>{scene.activeLabel ?? "REC"}</b> : null}</div>
        <div className="cine-card-body"><p>{scene.meta}</p><strong>{scene.title[locale]}</strong>{isActive ? <small>00:00:00:00</small> : null}</div>
        {isActive ? <div className="cine-active-scan-ui"><i /><span>{scene.scanLabel[locale]}</span></div> : null}
      </div>
    );
  })}
</div>
<div className="cine-card-hit-layer">
  {scenes.map((scene, index) => {
    const offset = relativeCardOffset(index, activeScene, scenes.length);
    return (
      <button
        className="cine-card-hit"
        data-offset={offset}
        key={`hit-${scene.id}`}
        type="button"
        aria-label={`切换到${scene.title[locale]}`}
        aria-pressed={index === activeScene}
        onClick={() => selectScene(index)}
        onKeyDown={(event) => handleCardKeyDown(event, index)}
        ref={(node) => { hitCardRefs.current[index] = node; }}
      />
    );
  })}
</div>
```

Add keyboard navigation:

```ts
function handleCardKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const nextIndex = (index + (event.key === "ArrowRight" ? 1 : -1) + scenes.length) % scenes.length;
  selectScene(nextIndex);
  hitCardRefs.current[nextIndex]?.focus();
}
```

- [ ] **Step 4: Implement B1 dimensions and hit clipping**

Replace the card-stack dimensions and add the hit-map rules in `CineHome.css`:

```css
.cine-card-stack {
  left: clamp(24px, 2.6vw, 40px);
  bottom: clamp(24px, 4vh, 40px);
  width: 500px;
  height: 290px;
  contain: layout;
}

.cine-film-card,
.cine-card-hit {
  position: absolute;
  left: 144px;
  bottom: 32px;
  width: 132px;
  height: 176px;
  transform-origin: bottom center;
}

.cine-card-visual {
  pointer-events: none;
}

.cine-card-media,
.cine-card-overlay,
.cine-card-sheen,
.cine-card-corners,
.cine-card-head,
.cine-card-body,
.cine-active-scan-ui {
  pointer-events: none;
}

.cine-card-hit {
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
}

.cine-card-stack.collapsed .cine-card-hit[data-offset="-2"],
.cine-card-stack.collapsed .cine-card-hit[data-offset="-1"] {
  clip-path: inset(0 calc(100% - 22px) 0 0);
}

.cine-card-stack.collapsed .cine-card-hit[data-offset="1"],
.cine-card-stack.collapsed .cine-card-hit[data-offset="2"] {
  clip-path: inset(0 0 0 calc(100% - 22px));
}

.cine-card-stack.collapsed .cine-card-hit[data-offset="0"],
.cine-card-stack.expanded .cine-card-hit {
  clip-path: inset(0);
}

.cine-card-hit:focus-visible {
  outline: 2px solid #00fba6;
  outline-offset: 4px;
}
```

Update the mobile stack only with responsive scale/position; do not add hover-dependent controls:

```css
@media (max-width: 900px) {
  .cine-card-stack { left: -8px; bottom: 94px; transform: scale(.72); transform-origin: left bottom; }
}

@media (max-width: 520px) {
  .cine-card-stack { left: -22px; bottom: 104px; transform: scale(.62); }
}
```

- [ ] **Step 5: Verify build and commit**

```powershell
pnpm --filter @aifilm/web typecheck
pnpm --filter @aifilm/web build
git add apps/web/src/pages/LoginPage.tsx apps/web/src/pages/CineHome.css
git commit -m "fix: make cinematic card stack fully interactive"
```

Expected: typecheck/build pass and no new chunk-loading error appears.

## Task 6: Synchronize the Active Card with the Visible Background

**Files:**
- Modify: `apps/web/src/pages/LoginPage.tsx:262-480`

- [ ] **Step 1: Add the background-to-card synchronization effect**

Import `shouldCorrectDrift`, then add:

```ts
useEffect(() => {
  if (publicView !== "home") return undefined;
  const background = bgRefs.current[visibleBgSlot.current];
  const card = cardVideoRefs.current[visibleScene];
  if (!background || !card) return undefined;

  let canceled = false;
  let frameHandle: number | null = null;
  const frameVideo = background as HTMLVideoElement & {
    requestVideoFrameCallback?: (callback: () => void) => number;
    cancelVideoFrameCallback?: (handle: number) => void;
  };

  const align = () => {
    if (shouldCorrectDrift(background.currentTime, card.currentTime)) card.currentTime = background.currentTime;
    card.playbackRate = background.playbackRate;
  };
  const play = () => { align(); void card.play().catch(() => undefined); };
  const pause = () => card.pause();
  const tick = () => {
    if (canceled) return;
    align();
    frameHandle = frameVideo.requestVideoFrameCallback?.(tick) ?? null;
  };

  card.muted = true;
  card.currentTime = background.currentTime;
  if (background.paused) card.pause(); else void card.play().catch(() => undefined);
  frameHandle = frameVideo.requestVideoFrameCallback?.(tick) ?? null;
  background.addEventListener("play", play);
  background.addEventListener("pause", pause);
  background.addEventListener("seeking", align);
  background.addEventListener("ratechange", align);

  return () => {
    canceled = true;
    background.removeEventListener("play", play);
    background.removeEventListener("pause", pause);
    background.removeEventListener("seeking", align);
    background.removeEventListener("ratechange", align);
    if (frameHandle !== null) frameVideo.cancelVideoFrameCallback?.(frameHandle);
    card.pause();
  };
}, [publicView, sceneUrls, visibleScene]);
```

- [ ] **Step 2: Pause every non-active card after a scene change**

Add:

```ts
useEffect(() => {
  cardVideoRefs.current.forEach((video, index) => {
    if (!video || index === visibleScene) return;
    video.pause();
  });
}, [visibleScene]);
```

- [ ] **Step 3: Pause media when the page becomes hidden**

Add a `visibilitychange` effect that pauses both background slots and all card videos while hidden. On visibility restore, play only the visible background; the synchronization effect resumes the active card from the background time.

Use this exact handler body:

```ts
const handleVisibility = () => {
  if (document.hidden) {
    bgRefs.current.forEach((video) => video?.pause());
    cardVideoRefs.current.forEach((video) => video?.pause());
    return;
  }
  const visible = bgRefs.current[visibleBgSlot.current];
  if (visible) void visible.play().catch(() => undefined);
};
```

- [ ] **Step 4: Verify and commit synchronization**

```powershell
pnpm --filter @aifilm/web test:unit
pnpm --filter @aifilm/web typecheck
git add apps/web/src/pages/LoginPage.tsx
git commit -m "feat: sync active cinematic card playback"
```

Expected: unit tests/typecheck pass; only one card video can remain unpaused.

## Task 7: Replace the Creator Light Theme with the Approved Token Layer

**Files:**
- Create: `apps/web/src/light-theme.css`
- Modify: `apps/web/src/main.tsx:4`
- Modify: `apps/web/src/styles.css:25889-26153`

- [ ] **Step 1: Remove only the superseded scoped creator block**

Delete the block beginning with:

```css
/* 2026-07-07 sub2api light creator theme: soft teal console, clearer text and panels. */
```

and ending immediately before the first unscoped `.admin-v2-page` rule. Do not delete the unscoped admin/showcase rules from the rest of `styles.css`.

- [ ] **Step 2: Create the global token and shell layer**

Create `apps/web/src/light-theme.css` with:

```css
:root[data-theme="light"] {
  color-scheme: light;
  --light-page: #f6f9fb;
  --light-surface: #ffffff;
  --light-subtle: #f8fbfd;
  --light-text: #101828;
  --light-muted: #667085;
  --light-border: #e4ebf2;
  --light-border-strong: #d7e3ec;
  --light-accent: #009b8f;
  --light-accent-ink: #04786f;
  --light-selected: #eaf9f6;
  --light-disabled: #98a2b3;
  --light-success: #15803d;
  --light-warning: #b45309;
  --light-danger: #b42318;
  --light-info: #1d4ed8;
  --light-shadow: 0 4px 12px rgba(31, 64, 91, .06);
}

:root[data-theme="light"] body,
:root[data-theme="light"] #root,
:root[data-theme="light"] .app-shell,
:root[data-theme="light"] .main {
  color: var(--light-text) !important;
  background: var(--light-page) !important;
}

:root[data-theme="light"] .sidebar,
:root[data-theme="light"] .topbar {
  border-color: var(--light-border) !important;
  background: var(--light-surface) !important;
  box-shadow: none !important;
}

:root[data-theme="light"] .panel,
:root[data-theme="light"] .u-card,
:root[data-theme="light"] .metric-card,
:root[data-theme="light"] .project-card,
:root[data-theme="light"] .plan-card,
:root[data-theme="light"] .list-row,
:root[data-theme="light"] .task-row,
:root[data-theme="light"] .profile-section,
:root[data-theme="light"] .queue-list-card,
:root[data-theme="light"] .queue-detail-card,
:root[data-theme="light"] .production-console,
:root[data-theme="light"] .generation-confirm-dialog,
:root[data-theme="light"] .project-route-drawer {
  border: 1px solid var(--light-border) !important;
  border-radius: 8px !important;
  color: var(--light-text) !important;
  background: var(--light-surface) !important;
  box-shadow: var(--light-shadow) !important;
}

:root[data-theme="light"] h1,
:root[data-theme="light"] h2,
:root[data-theme="light"] h3,
:root[data-theme="light"] strong,
:root[data-theme="light"] .crumb {
  color: var(--light-text) !important;
}

:root[data-theme="light"] p,
:root[data-theme="light"] small,
:root[data-theme="light"] .muted,
:root[data-theme="light"] .nav-section > p {
  color: var(--light-muted) !important;
}

:root[data-theme="light"] input,
:root[data-theme="light"] textarea,
:root[data-theme="light"] select {
  border-color: var(--light-border-strong) !important;
  color: var(--light-text) !important;
  background: var(--light-subtle) !important;
  box-shadow: none !important;
}

:root[data-theme="light"] input::placeholder,
:root[data-theme="light"] textarea::placeholder {
  color: var(--light-disabled) !important;
}

:root[data-theme="light"] input:focus,
:root[data-theme="light"] textarea:focus,
:root[data-theme="light"] select:focus {
  border-color: var(--light-accent) !important;
  outline: 0;
  box-shadow: 0 0 0 3px rgba(0, 155, 143, .12) !important;
}

:root[data-theme="light"] :disabled,
:root[data-theme="light"] [aria-disabled="true"] {
  color: var(--light-disabled) !important;
  background: #f2f4f7 !important;
  opacity: 1;
}
```

- [ ] **Step 3: Add navigation, control, and status states**

Append:

```css
:root[data-theme="light"] .nav-item,
:root[data-theme="light"] .ghost-button,
:root[data-theme="light"] .icon-button,
:root[data-theme="light"] .tabs button,
:root[data-theme="light"] .step-tabs button,
:root[data-theme="light"] .filter-row button,
:root[data-theme="light"] .choice-pill,
:root[data-theme="light"] .choice-card,
:root[data-theme="light"] .mode-option {
  border-color: var(--light-border) !important;
  color: #344054 !important;
  background: var(--light-surface) !important;
  box-shadow: none !important;
}

:root[data-theme="light"] .nav-item:hover,
:root[data-theme="light"] .nav-item.active,
:root[data-theme="light"] .tabs button.active,
:root[data-theme="light"] .step-tabs button.active,
:root[data-theme="light"] .filter-row button.active,
:root[data-theme="light"] .choice-pill.active,
:root[data-theme="light"] .choice-card.active,
:root[data-theme="light"] .mode-option.active {
  border-color: #8adbd3 !important;
  color: var(--light-accent-ink) !important;
  background: var(--light-selected) !important;
}

:root[data-theme="light"] .primary-button,
:root[data-theme="light"] .production-action:not(.secondary) {
  border-color: var(--light-accent) !important;
  color: #ffffff !important;
  background: var(--light-accent) !important;
  box-shadow: none !important;
}

:root[data-theme="light"] .status.success,
:root[data-theme="light"] .stage-pill.done { color: var(--light-success) !important; background: #ecfdf3 !important; }
:root[data-theme="light"] .status.warning { color: var(--light-warning) !important; background: #fffaeb !important; }
:root[data-theme="light"] .status.danger,
:root[data-theme="light"] .danger-text { color: var(--light-danger) !important; background: #fef3f2 !important; }
:root[data-theme="light"] .status.info { color: var(--light-info) !important; background: #eff6ff !important; }
```

- [ ] **Step 4: Add workbench-specific surfaces**

Append grouped selectors for the current production desks:

```css
:root[data-theme="light"] .project-workbench .workbench-hero,
:root[data-theme="light"] .project-workbench .script-story-structure-strip article,
:root[data-theme="light"] .project-workbench .design-stage-strip article,
:root[data-theme="light"] .project-workbench .video-loop-progress-strip article,
:root[data-theme="light"] .project-workbench .canvas-workflow-steps article,
:root[data-theme="light"] .project-workbench .storyboard-global-preview-panel,
:root[data-theme="light"] .project-workbench .script-scene-layout > *,
:root[data-theme="light"] .project-workbench .design-desk-layout > *,
:root[data-theme="light"] .project-workbench .director-desk-layout > *,
:root[data-theme="light"] .project-workbench .video-loop-layout > * {
  border-color: var(--light-border) !important;
  border-radius: 8px !important;
  color: var(--light-text) !important;
  background: var(--light-surface) !important;
  box-shadow: var(--light-shadow) !important;
}

:root[data-theme="light"] .project-workbench .script-scene-list button,
:root[data-theme="light"] .project-workbench .design-shot-card,
:root[data-theme="light"] .project-workbench .video-clip-list button,
:root[data-theme="light"] .project-workbench .canvas-beat-grid button,
:root[data-theme="light"] .project-workbench .asset-flow-grid article,
:root[data-theme="light"] .task-monitor,
:root[data-theme="light"] .shot-card,
:root[data-theme="light"] .director-shot-card,
:root[data-theme="light"] .video-draft-card {
  border-color: var(--light-border) !important;
  color: var(--light-text) !important;
  background: var(--light-subtle) !important;
}

:root[data-theme="light"] .project-workbench .script-scene-list button.active,
:root[data-theme="light"] .project-workbench .design-shot-card.active,
:root[data-theme="light"] .project-workbench .video-clip-list button.active,
:root[data-theme="light"] .project-workbench .canvas-beat-grid button.active {
  border-color: #8adbd3 !important;
  color: var(--light-text) !important;
  background: var(--light-selected) !important;
  box-shadow: inset 3px 0 0 var(--light-accent) !important;
}
```

- [ ] **Step 5: Import last, verify, and commit**

In `main.tsx`:

```ts
import "./styles.css";
import "./light-theme.css";
```

Run:

```powershell
pnpm --filter @aifilm/web typecheck
pnpm --filter @aifilm/web build
git diff --check -- apps/web/src/styles.css apps/web/src/light-theme.css apps/web/src/main.tsx
git add apps/web/src/styles.css apps/web/src/light-theme.css apps/web/src/main.tsx
git commit -m "feat: unify creator light theme colors"
```

Expected: build passes and the old scoped block is absent from `styles.css`.

## Task 8: Local Browser and Performance Verification

**Files:**
- Create: `docs/design-previews/cine-home-4k-b1-desktop.png`
- Create: `docs/design-previews/cine-home-4k-b1-mobile.png`
- Create: `docs/design-previews/creator-light-theme-sub2api.png`

- [ ] **Step 1: Run all static checks**

```powershell
pnpm --filter @aifilm/web test:unit
pnpm --filter @aifilm/web typecheck
pnpm --filter @aifilm/web build
git diff --check
```

Expected: all commands exit 0; Vite may report its existing chunk-size warning but no build error.

- [ ] **Step 2: Start the local app and verify the desktop card geometry**

Start the existing web/API development services in a persistent terminal:

```powershell
pnpm dev
```

Expected: Vite is available at `http://localhost:5173` and the API listens on port 4000. In a real browser at 1280x720 and 1440x900 verify:

- Collapsed main card is 132x176 CSS pixels before responsive scaling.
- Four side strips are visible, each approximately 18-22px.
- The stack left/bottom margins remain between 24px and 40px.
- Hover expands all five cards without changing the stack container size.

Capture `cine-home-4k-b1-desktop.png`.

- [ ] **Step 3: Verify real coordinate clicks and keyboard behavior**

For each visible hit region, use `document.elementFromPoint` only to identify a safe visible coordinate, then issue a real browser coordinate click. After each click assert:

- Exactly one hit button has `aria-pressed="true"`.
- The pressed index equals the active background scene.
- The visible background URL changes to the selected scene.
- ArrowLeft/ArrowRight moves focus and selection to the expected adjacent scene.

Expected: all five scenes are selectable both collapsed and expanded.

- [ ] **Step 4: Verify 4K playback and decoder discipline**

Read the active DOM state and assert:

- Visible background `videoWidth` is 3836 or 3856.
- The active card source is the same scene and is playing.
- Four non-active card videos report `paused === true`.
- Background/card absolute `currentTime` drift remains at or below 0.12s after stabilization.
- No media element remains in a permanent `NETWORK_NO_SOURCE` state.
- Browser console has no errors.

- [ ] **Step 5: Exercise one real 4K-to-2K fallback locally**

With the development server running, temporarily move only `desert_4k.mp4` after verifying both paths remain inside the media directory:

```powershell
$mediaDir = Resolve-Path 'apps/web/public/media/cineart-home'
$source = Join-Path $mediaDir 'desert_4k.mp4'
$hold = Join-Path $mediaDir 'desert_4k.hold.mp4'
if ((Split-Path $source) -ne $mediaDir.Path -or (Split-Path $hold) -ne $mediaDir.Path) { throw 'Unsafe fallback-test path' }
Move-Item -LiteralPath $source -Destination $hold
```

Reload the homepage, select the desert scene, and assert the final active source ends with `desert_2k.mp4` without a black frame. Always restore the original file in a `finally` cleanup step:

```powershell
if (Test-Path $hold) { Move-Item -LiteralPath $hold -Destination $source }
```

Expected: fallback is visible in the `[cine-media]` diagnostic and the 4K file is restored before continuing.

- [ ] **Step 6: Verify mobile and light theme**

At 390x844 and 320x720 verify homepage horizontal overflow equals 0 and capture `cine-home-4k-b1-mobile.png`. Log into the creator app, switch to light mode, visit workbench, project workbench, queue, credits, settings, and an open modal. Verify computed colors match the approved tokens and no visible text has white-on-white or muted text below the intended contrast. Capture `creator-light-theme-sub2api.png`.

- [ ] **Step 7: Commit evidence**

```powershell
git add docs/design-previews/cine-home-4k-b1-desktop.png docs/design-previews/cine-home-4k-b1-mobile.png docs/design-previews/creator-light-theme-sub2api.png
git commit -m "test: capture cinematic and light theme verification"
```

## Task 9: Production Backup, Deployment, and Rollback Check

**Files:**
- Modify on server: `/opt/manjiao/apps/web/src/**`
- Create on server: `/opt/manjiao/apps/web/public/media/cineart-home/*_4k.mp4`
- Create on server: `/opt/manjiao-backups/${timestamp}_cine4k_light/`

- [ ] **Step 1: Create a production backup**

On the server, create a timestamped directory and archive the current source and static volume before changing files:

```bash
timestamp=$(date +%Y%m%d_%H%M%S)
backup=/opt/manjiao-backups/${timestamp}_cine4k_light
mkdir -p "$backup"
tar -C /opt/manjiao -czf "$backup/source.tgz" apps/web deploy docker-compose.prod.yml .env.production
docker run --rm -v manjiao_web_dist:/source:ro -v "$backup":/backup nginx:1.27-alpine sh -lc 'tar -C /source -czf /backup/web-dist.tgz .'
```

Expected: `source.tgz` and `web-dist.tgz` both exist and are non-empty.

- [ ] **Step 2: Upload changed source and 4K assets**

From `E:\AI漫剧`, upload only the files from Tasks 1-7 plus the five 4K media files:

```powershell
scp apps/web/package.json manjiao:/opt/manjiao/apps/web/package.json
scp apps/web/src/main.tsx apps/web/src/light-theme.css apps/web/src/styles.css manjiao:/opt/manjiao/apps/web/src/
scp apps/web/src/pages/LoginPage.tsx apps/web/src/pages/CineHome.css apps/web/src/pages/cineHomeModel.ts apps/web/src/pages/cineHomeModel.test.mjs apps/web/src/pages/cineScenes.ts manjiao:/opt/manjiao/apps/web/src/pages/
scp .env.example .env.production.example manjiao:/opt/manjiao/
scp apps/web/public/media/cineart-home/desert_4k.mp4 apps/web/public/media/cineart-home/photo-w_4k.mp4 apps/web/public/media/cineart-home/punk-future_4k.mp4 apps/web/public/media/cineart-home/girl-booth_4k.mp4 apps/web/public/media/cineart-home/bicycle-smile_4k.mp4 apps/web/public/media/cineart-home/ORIGINS.md apps/web/public/media/cineart-home/SHA256SUMS.txt manjiao:/opt/manjiao/apps/web/public/media/cineart-home/
```

Expected: every `scp` exits 0. Do not upload `.env.local`, local `dist`, `.superpowers`, or unrelated dirty-worktree files.

- [ ] **Step 3: Set the production experiment tier**

Ensure `/opt/manjiao/.env.production` contains:

```dotenv
VITE_CINE_MEDIA_TIER=4k
```

Do not print the rest of the production environment or any secrets.

- [ ] **Step 4: Build using the running dependency cache and publish the static volume**

Use the running API container's installed workspace dependencies if the one-shot web container cannot reach npm:

```bash
cd /opt/manjiao
docker compose -f docker-compose.prod.yml exec -T api pnpm --filter @aifilm/web test:unit
docker compose -f docker-compose.prod.yml exec -T api pnpm --filter @aifilm/web build
tar -C /opt/manjiao/apps/web/dist -cf - . | docker run --rm -i -v manjiao_web_dist:/target nginx:1.27-alpine tar -C /target -xf -
docker compose -f docker-compose.prod.yml restart nginx
```

Expected: tests/build exit 0 and Nginx restarts successfully.

- [ ] **Step 5: Verify production health and static media**

Check:

```powershell
curl.exe -fsS https://manjiao.cloud/health
curl.exe -fsSI https://manjiao.cloud/media/cineart-home/desert_4k.mp4
curl.exe -fsSI https://manjiao.cloud/media/cineart-home/bicycle-smile_4k.mp4
```

Expected: health returns `ok: true`; MP4 responses are HTTP 200 with `Accept-Ranges: bytes` and immutable cache headers.

- [ ] **Step 6: Repeat the critical production browser checks**

Verify at minimum:

- B1 collapsed strips are visible.
- A visible side strip switches scenes by coordinate click.
- Expanded cards all switch scenes.
- Active background reports 4K dimensions.
- Four inactive card videos are paused.
- Creator light workbench matches the approved teal-neutral theme.
- Browser console has no errors.

- [ ] **Step 7: Exercise the rollback path without changing production**

Confirm that setting `VITE_CINE_MEDIA_TIER=2k` and rebuilding would resolve `_2k.mp4` candidates first. Record the exact backup directory and current asset hash in the release report. Do not perform the rollback unless validation fails or the user requests it.

---

## Final Checkpoint

- [ ] Every design requirement maps to a completed task.
- [ ] All seven model tests pass.
- [ ] TypeScript and Vite production build pass.
- [ ] Five self-hosted 4K files match expected dimensions and checksums.
- [ ] Collapsed and expanded cards are clickable with real coordinates.
- [ ] Active card/background drift stays within 120ms after stabilization.
- [ ] Light-theme text, surfaces, controls, and states use the approved tokens.
- [ ] Desktop/mobile screenshots and production health checks pass.
- [ ] Production backup and rollback instructions are recorded.
