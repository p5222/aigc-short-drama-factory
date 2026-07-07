# Manjiao Frontend V1 Baseline

Updated: 2026-07-07

This file records the current deployed Manjiao frontend as the V1 rollback baseline.

## Baseline Identity

- Baseline name: `manjiao-frontend-v1.0`
- Git tag: `manjiao-frontend-v1.0`
- Application code commit: `7147f70a296e29c07436c254d81bcafd8d6f6245`
- Commit title: `feat: redesign project workbench v2`
- Production URL at time of snapshot: `https://manjiao.cloud/`
- Production asset fingerprint after deploy: `assets/index-CpQgUgsz.js`, `assets/index-UCPBo1mJ.css`
- Server backup before deploy: `/opt/manjiao-backups/20260707_010010`
- Visual evidence: `docs/version-snapshots/manjiao-frontend-v1-script-scene-workbench.png`

## What V1 Contains

- Project workbench V2 shell with a dark production-console visual style.
- Script and scene planning cockpit:
  - Scene list and status filters.
  - Script summary, scene fields, dialogue, production tags.
  - Character and scene candidates.
  - Preflight generation checks and risk prompts.
- Character, storyboard, image, and video tabs remain available in the production flow.
- Public production health checks passed after deployment.

## Known V1 UI Problems

- The script-scene workbench layout has uneven column heights and visually empty right-side space.
- Several small controls and status blocks feel scattered instead of belonging to one clear grid.
- The scene breakdown view is too text-heavy and does not provide enough visual preview density.
- The page mixes script parsing, production gating, and downstream design decisions in one screen.
- The script breakdown logic labels generic scenes too often and needs stronger parsing around location, time, action beat, characters, dialogue, and shot intent.

## Rollback Rule

If a future frontend iteration is visually or functionally worse than this V1 baseline, roll back application code to `manjiao-frontend-v1.0`.

Recommended rollback path from local machine:

```powershell
git archive --format=tar --output=tmp\manjiao_frontend_v1_rollback.tar manjiao-frontend-v1.0
scp tmp\manjiao_frontend_v1_rollback.tar manjiao:/tmp/manjiao_frontend_v1_rollback.tar
```

Then on the server:

```bash
tar -xf /tmp/manjiao_frontend_v1_rollback.tar -C /opt/manjiao
cd /opt/manjiao
docker compose -f docker-compose.prod.yml up web
docker compose -f docker-compose.prod.yml restart nginx
curl -fsS http://127.0.0.1:8080/health
```

Verify from local machine:

```powershell
Invoke-WebRequest https://manjiao.cloud/health -UseBasicParsing
(Invoke-WebRequest https://manjiao.cloud/ -UseBasicParsing).Content
```
