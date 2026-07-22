# Manjiao deployment quick reference

Updated: 2026-07-07

This file records non-secret deployment facts for future Codex sessions. Do not add server passwords, private key contents, `.env.production`, database passwords, or API keys here.

## Server

- Production URL: `https://manjiao.cloud/`
- Health check: `https://manjiao.cloud/health`
- Server IP: `43.139.101.102`
- SSH user: `ubuntu`
- SSH alias on this Windows machine: `manjiao`
- SSH key path on this Windows machine: `~/.ssh/manjiao_tencent`
- Server project directory: `/opt/manjiao`
- Backup root: `/opt/manjiao-backups`
- Compose file: `/opt/manjiao/docker-compose.prod.yml`
- Caddy proxies `manjiao.cloud` and `www.manjiao.cloud` to `127.0.0.1:8080`.

The server project directory is currently a source upload directory, not a Git worktree. Do not assume `git pull` works in `/opt/manjiao`.

## Current Deploy Shape

1. Commit and push locally to GitHub `main`.
2. Create a clean archive from the committed `HEAD`, not from the dirty working tree.
3. Upload the archive with `scp` using the `manjiao` SSH alias.
4. Extract over `/opt/manjiao`.
5. Run the production web build service to refresh the `web_dist` Docker volume.
6. Restart nginx and verify public health + asset fingerprint.

## Commands

Create archive locally from the committed snapshot:

```powershell
git archive --format=tar --output=tmp\manjiao_release_HEAD.tar HEAD
scp tmp\manjiao_release_HEAD.tar manjiao:/tmp/manjiao_release_HEAD.tar
```

Backup before release:

```bash
cd /opt/manjiao
STAMP=$(date +%Y%m%d_%H%M%S)
TARGET="/opt/manjiao-backups/$STAMP"
mkdir -p "$TARGET"
docker compose -f docker-compose.prod.yml exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$TARGET/aigc_drama.dump"
docker compose -f docker-compose.prod.yml exec -T api sh -lc 'cd /app && tar -czf - storage' > "$TARGET/storage.tar.gz"
docker compose -f docker-compose.prod.yml ps > "$TARGET/compose-ps.txt"
```

Deploy:

```bash
tar -xf /tmp/manjiao_release_HEAD.tar -C /opt/manjiao
cd /opt/manjiao
docker compose -f docker-compose.prod.yml up web
docker compose -f docker-compose.prod.yml restart nginx
docker compose -f docker-compose.prod.yml ps
curl -fsS http://127.0.0.1:8080/health
```

Verify from local machine:

```powershell
Invoke-WebRequest https://manjiao.cloud/health -UseBasicParsing
Invoke-WebRequest https://www.manjiao.cloud/health -UseBasicParsing
(Invoke-WebRequest https://manjiao.cloud/ -UseBasicParsing).Content
```

## 2026-07-07 Project Workbench V2 Polish And Cloud TTS Deployment Note

- 2026-07-07 22:52 CineART-authorized cinematic home deployed from working-tree archive `manjiao_release_worktree_20260707_224908.tar`.
- Backup directory: `/opt/manjiao-backups/20260707_224908`.
- New public asset fingerprint after deploy: `assets/index-CeXBpgek.js` and `assets/index-BAa0Il80.css`.
- Verification passed: local `pnpm --filter @aifilm/web typecheck`; local and server `pnpm --filter @aifilm/web build`; production `https://manjiao.cloud/health` and `https://www.manjiao.cloud/health` returned 200; production home referenced the new asset fingerprint; `/media/cineart-home/desert_fast.mp4` returned 200 as `video/mp4`; fresh Chrome production DOM check showed `.cine-home-page` visible, `.app-shell` absent, scene switch working, login/register modal switching working, login modal not overflowing, one active background video, and two playing videos total.
- UI changes deployed: authorized CineART-style full-screen video home, project brand lockup `漫角 / MANJIAO.CLOUD`, local authorized video assets, CineART-style language menu and film-card scene switching, modal login/register using existing project API logic, and V1 front-end rollback backup in `docs/frontend-v1-backups/v1-before-cineart-home-20260707`.
- GitHub push note: local commit `ed46b95 feat: clone cinematic home experience` was created, but `git push origin main` failed twice from this machine because `github.com:443` reset/timed out. Server deployment was still completed through SSH archive upload.

- 2026-07-07 21:52 Project Production Workbench V3 UI optimization deployed from working-tree archive `manjiao_release_worktree_20260707_214248.tar`.
- Backup directory: `/opt/manjiao-backups/20260707_214248`.
- New public asset fingerprint after deploy: `assets/index-wVszJuAj.js` and `assets/index-DwXG44a2.css`.
- Verification passed: local `pnpm --filter @aifilm/web typecheck`; local and server `pnpm --filter @aifilm/web build`; browser check at 1905px viewport across `剧本解析`, `角色场景`, `设计总台`, and `视频闭环` reported no horizontal overflow; server-local `http://127.0.0.1:8080/health` returned 200; `https://manjiao.cloud/health` returned 200; `https://www.manjiao.cloud/health` returned 200; both public homepages referenced the new asset fingerprint.
- UI changes included: full-width project workbench layout, fixed script scene workbench inherited two-column grid bug, dense aligned production panels, aspect-aware character/storyboard/video media frames, purposeful storyboard global empty state, hidden prompt internals by default, and retained video preview seek controls.

- 2026-07-07 20:16 Modern Dark Creation Workspace hotfix deployed from working-tree archive `manjiao_release_worktree_20260707_201537.tar`.
- Backup directory: `/opt/manjiao-backups/20260707_201319`.
- New public asset fingerprint after deploy: `assets/index-BcFt9327.js` and `assets/index-CMSU8Mym.css`.
- Verification passed: server-local `http://127.0.0.1:8080/health` returned 200; `https://manjiao.cloud/health` returned 200; `https://www.manjiao.cloud/health` returned 200; `https://manjiao.cloud/` returned 200 with the new asset fingerprint.
- UI changes deployed: creation wizard modern dark shell, compact script engine status cards, dense script asset map, 12-column desktop layout for the script/model route step, darker route controls, and project-workbench dark panel overrides.
- Deployment note: release archive excludes `.git`, `node_modules`, `tmp`, local `dist`, `packages/shared/dist`, `storage`, `outputs`, `backups`, `docs/design-previews`, local agents, and environment files. `packages/shared/dist` must stay excluded because server build containers may own those files as root.

- Deployed source: working-tree release archive `manjiao_release_worktree_20260707_170056.tar` from local `main`, including current uncommitted worktree changes and the required untracked `apps/web/src/pages/StudioPage.tsx`.
- Backup directory: `/opt/manjiao-backups/20260707_170304`.
- Backup contents: `aigc_drama.dump`, `storage.tar.gz`, `compose-ps.txt`, and `source-release.tar`.
- New public asset fingerprint after deploy: `assets/index-Py5gVpl2.js` and `assets/index-Csl3MnGi.css`.
- Verification passed: server-local `http://127.0.0.1:8080/health` returned 200; `https://manjiao.cloud/health` returned 200; `https://www.manjiao.cloud/health` returned 200; `https://manjiao.cloud/` returned 200 with the new asset fingerprint; `https://manjiao.cloud/api/help/articles` returned 5 public articles.
- UI changes deployed: script six-part structure strip, hidden internal prompt cards, larger 12-grid storyboard global preview, aspect-aware media previews, and custom video seek controls.
- TTS change deployed: LongCat-AudioDiT now defaults to cloud/server-side HTTP sidecar; local bridge requires explicit `LONGCAT_AUDIODIT_ALLOW_LOCAL_BRIDGE=true`.

## 2026-07-07 Profile Security And Light Theme Hotfix Deployment Note

- Deployed source: working-tree release archive `manjiao_release_worktree_20260707_152740.tar` from local `main` based on `a1e74f4`, including the required untracked `apps/web/src/pages/StudioPage.tsx`.
- Backup directory: `/opt/manjiao-backups/20260707_152834`.
- New public asset fingerprint after deploy: `assets/index-BHBH7w-q.js` and `assets/index-Cu577bTk.css`.
- Verification passed: `https://manjiao.cloud/` returned 200; `https://manjiao.cloud/health` returned 200; `https://www.manjiao.cloud/health` returned 200; `https://manjiao.cloud/api/help/articles` returned 5 public Chinese help articles.
- Profile checks passed: same-email profile save returned `demo@aifilm.local`; wrong-password email change returned 400.
- UI note: light theme now sets `#root`, `.app-shell`, `.main`, and `.app-shell > .main` to the light app background so short pages do not expose the dark main surface below the content.

## 2026-07-07 Account Credits Help Center Deployment Note

- Deployed source: working-tree release archive `manjiao_release_worktree_20260707_141424.tar` from local `main` based on `a1e74f4`, including the required untracked `apps/web/src/pages/StudioPage.tsx`.
- Backup directory: `/opt/manjiao-backups/20260707_140905`.
- New public asset fingerprint after deploy: `assets/index-DiKqyCO4.js` and `assets/index-mliocxwR.css`.
- Verification passed: `https://manjiao.cloud/` returned 200; `https://manjiao.cloud/health` returned 200; `https://www.manjiao.cloud/health` returned 200; `https://manjiao.cloud/api/help/articles` returned 5 public Chinese help articles.
- Deployment note: public help article route had to be moved before `/api` auth middleware during verification so the Help Center can load before login.

## 2026-07-07 Production Desk V2 Deployment Note

- Deployed source: clean `git archive HEAD` from the local commit containing this note (`feat: redesign project production desks v2`; run `git log -1 --oneline` for the exact amended hash).
- Backup directory: `/opt/manjiao-backups/20260707_104233`
- New public asset fingerprint after deploy: `assets/index-CM1uVcN9.js` and `assets/index-C-kN7Ljy.css`
- Verification passed: `https://manjiao.cloud/` returned 200; `https://manjiao.cloud/health` returned 200; `https://www.manjiao.cloud/health` returned 200.
- GitHub push from this machine failed twice on 2026-07-07 because `github.com:443` timed out. Server deploy was completed by clean `git archive HEAD` upload through SSH alias `manjiao`.

## 2026-07-07 Canvas Workflow Deployment Note

- Deployed source commit: `f3aa387 fix: preserve platform announcement schema` (includes `8dbe0af feat: add canvas workflow prompts`).
- Backup directory: `/opt/manjiao-backups/20260707_113943`.
- Public asset fingerprint after deploy: `assets/index-B77y8r4o.js` and `assets/index-DcEkJGtB.css`.
- Verification passed: `https://manjiao.cloud/` returned 200; `https://manjiao.cloud/health` returned 200; `https://www.manjiao.cloud/health` returned 200.
- Deployment note: initial clean archive exposed a Prisma safety warning because production already had a non-empty `PlatformAnnouncement` table while the committed schema did not include the model. Do not use `--accept-data-loss`; keep the schema compatibility model so Prisma preserves the table.

## 2026-07-07 Deployment Note

- Deployed commit: `7147f70 feat: redesign project workbench v2`
- Backup directory: `/opt/manjiao-backups/20260707_010010`
- New public asset fingerprint after deploy: `assets/index-CpQgUgsz.js` and `assets/index-UCPBo1mJ.css`
- Verification passed: `https://manjiao.cloud/` returned 200; `https://manjiao.cloud/health` returned 200; `https://www.manjiao.cloud/health` returned 200.

Important lesson from this deploy: partial file uploads can leave the server source inconsistent because `/opt/manjiao` is not a Git worktree. Prefer extracting a full clean `git archive HEAD` snapshot unless intentionally hotfixing one isolated file.

## 2026-07-22 Dual-Theme Workbench Release A

- Deployed source: clean `git archive HEAD` from branch `codex/cine4k-light-theme`, archive `tmp/manjiao_workbench_release_20260722.tar`.
- Backup directory: `/opt/manjiao-backups/20260722_143556_dual_theme_workbench`.
- Backup verification: `source.tgz`, `aigc_drama.dump`, `storage.tar.gz`, and `compose-ps.txt` are present and non-empty.
- Retained backups after cleanup: `20260722_143556_dual_theme_workbench`, `20260711_124119`, `20260711_013851_cine4k_light`.
- Public asset fingerprint: `assets/index-DHAZHqGf.js`, `assets/index-D3MIzoOf.css`.
- Health verification: `https://manjiao.cloud/health` 200, `https://www.manjiao.cloud/health` 200, `https://api.manjiao.cloud/health` 200; server-local `http://127.0.0.1:8080/health` 200.
- Local gate: Web 75/75 unit tests, Web typecheck/build, API/shared/root typecheck/build passed. Existing Vite bundle-size warning remains.
- QA residual: Playwright/axe browser execution is blocked in this environment because Chromium download timed out; see `docs/design-qa.md`. Legacy workbench function definitions remain as non-rendered dead code pending a separate safe cleanup; the live route renders only the four new stages.
