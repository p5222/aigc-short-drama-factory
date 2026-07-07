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
