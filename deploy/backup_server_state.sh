#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/manjiao}"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/manjiao-backups}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
STAMP="$(date +%Y%m%d_%H%M%S)"
TARGET_DIR="$BACKUP_ROOT/$STAMP"

mkdir -p "$TARGET_DIR"
cd "$APP_DIR"

echo "==> Backup target: $TARGET_DIR"

echo "==> Backing up PostgreSQL database"
docker compose -f "$COMPOSE_FILE" exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$TARGET_DIR/aigc_drama.dump"

echo "==> Backing up storage volume"
docker compose -f "$COMPOSE_FILE" exec -T api sh -lc 'cd /app && tar -czf - storage' > "$TARGET_DIR/storage.tar.gz"

echo "==> Saving container status"
docker compose -f "$COMPOSE_FILE" ps > "$TARGET_DIR/compose-ps.txt"

echo "==> Writing restore notes"
cat > "$TARGET_DIR/RESTORE.md" <<'EOF'
# Restore Notes

Restore database:

```bash
cd /opt/manjiao
docker compose -f docker-compose.prod.yml stop api
cat /opt/manjiao-backups/TIMESTAMP/aigc_drama.dump | docker compose -f docker-compose.prod.yml exec -T postgres sh -lc 'cat > /tmp/aigc_drama.dump'
docker compose -f docker-compose.prod.yml exec -T postgres sh -lc 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" --if-exists && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose -f docker-compose.prod.yml exec -T postgres sh -lc 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists /tmp/aigc_drama.dump'
docker compose -f docker-compose.prod.yml up -d api
```

Restore storage:

```bash
cd /opt/manjiao
cat /opt/manjiao-backups/TIMESTAMP/storage.tar.gz | docker compose -f docker-compose.prod.yml exec -T api sh -lc 'cd /app && tar -xzf -'
docker compose -f docker-compose.prod.yml restart api nginx
```
EOF

echo "==> Backup complete"
du -sh "$TARGET_DIR"
find "$TARGET_DIR" -maxdepth 1 -type f -printf "%f %s bytes\n" | sort
