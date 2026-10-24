#!/usr/bin/env bash
# Restore a complete backup into an isolated, temporary PostgreSQL instance.
# No production database connection, host port, or persistent data volume is used.
set -euo pipefail
umask 077
backup="$(realpath -e -- "${1:?Usage: verify_backup_restore.sh /path/to/complete-backup}")"
test -f "$backup/COMPLETE"
for file in aigc_drama.dump storage.tar.gz source.tgz SHA256SUMS; do
  test -s "$backup/$file"
  test ! -L "$backup/$file"
done
(cd "$backup" && sha256sum --check --status SHA256SUMS)
tar -tzf "$backup/storage.tar.gz" >/dev/null
tar -tzf "$backup/source.tgz" >/dev/null
name="manjiao-restore-check-$(date +%s)-$$"
started="$(date +%s)"
cleanup() { docker rm -fv "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$name" --network none --memory=768m --cpus=1 \
  --tmpfs /var/lib/postgresql/data:rw,size=512m \
  --mount "type=bind,src=$backup/aigc_drama.dump,dst=/backup.dump,readonly" \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
ready=false
for ((i=0; i<30; i++)); do
  if docker exec "$name" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
test "$ready" = true
docker exec "$name" createdb -U postgres restore_check
docker exec "$name" pg_restore -U postgres -d restore_check --exit-on-error \
  --single-transaction --no-owner --no-privileges /backup.dump
docker exec -i "$name" psql -U postgres -d restore_check -X -v ON_ERROR_STOP=1 -At <<'SQL'
SELECT json_build_object(
  'tables', (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'),
  'users', (SELECT count(*) FROM "User"),
  'projects', (SELECT count(*) FROM "Project"),
  'tasks', (SELECT count(*) FROM "GenerationTask"),
  'creditTransactions', (SELECT count(*) FROM "CreditTransaction"),
  'orders', (SELECT count(*) FROM "RechargeOrder")
);
SQL
echo "RESTORE_CHECK_OK seconds=$(( $(date +%s) - started )) (temporary database restored; archives verified; production untouched)"
