#!/usr/bin/env bash
set -euo pipefail
postgres="${1:?CI postgres container required}"
redis="${2:?CI redis container required}"
revision="${3:?image revision required}"
[[ "$revision" =~ ^[a-f0-9]{40}$ ]]
work="$(mktemp -d /tmp/manjiao-ci-full-backup.XXXXXXXX)"
trap 'rm -rf -- "$work"' EXIT
mkdir -p "$work/source" "$work/storage/storage" "$work/backup"
cp package.json pnpm-lock.yaml deploy/Dockerfile "$work/source/"
docker exec "$postgres" pg_dump -U postgres -d audit_api_ci -Fc > "$work/backup/aigc_drama.dump"
docker exec "$redis" sh -ec 'redis-cli --rdb /tmp/full-dr.rdb >/dev/null 2>&1; redis-check-rdb /tmp/full-dr.rdb >/dev/null'
docker cp "$redis:/tmp/full-dr.rdb" "$work/backup/redis.rdb"
docker exec "$redis" rm /tmp/full-dr.rdb
tar -czf "$work/backup/storage.tar.gz" -C "$work/storage" storage
tar -czf "$work/backup/source.tgz" -C "$work/source" .
(cd "$work/backup" && sha256sum aigc_drama.dump redis.rdb storage.tar.gz source.tgz > SHA256SUMS)
touch "$work/backup/COMPLETE"
docker tag manjiao-verify "manjiao-app:$revision"
bash deploy/verify_full_restore.sh "$work/backup" "manjiao-app:$revision"
