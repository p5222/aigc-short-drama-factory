#!/usr/bin/env bash
# Restore a complete backup + exact application image into an internal Docker network.
# No production mounts, host ports, merchant secrets or supplier credentials.
set -euo pipefail
umask 077
backup="$(realpath -e -- "${1:?complete backup directory required}")"
image="${2:?exact application image required}"
[[ "$image" =~ ^manjiao-app:[a-f0-9]{40}$ ]] || { echo "Exact revision image required" >&2; exit 2; }
test -f "$backup/COMPLETE"
for file in aigc_drama.dump storage.tar.gz source.tgz redis.rdb SHA256SUMS; do test -s "$backup/$file"; test ! -L "$backup/$file"; done
(cd "$backup" && sha256sum --check --status SHA256SUMS)
test "$(docker image inspect "$image" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" = "${image#*:}"
available="$(df -Pm /tmp | awk 'NR==2 {print $4}')"
test "$available" -ge 1400 || { echo "Restore requires at least 1400 MiB free" >&2; exit 2; }
work="$(mktemp -d /tmp/manjiao-full-dr.XXXXXXXX)"
prefix="manjiao-dr-$(date +%s)-$$"
network="$prefix-net"
started="$(date +%s)"
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then docker logs --tail 30 "$prefix-api" >&2 2>/dev/null || true; fi
  for service in nginx api web redis postgres; do docker rm -fv "$prefix-$service" >/dev/null 2>&1 || true; done
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf -- "$work"
}
trap cleanup EXIT
# Inspect paths before extracting, including symlinks/hardlinks.
python3 - "$backup" "$work" <<'PY'
import pathlib, sys, tarfile
backup, work = map(pathlib.Path, sys.argv[1:])
for name in ("source.tgz", "storage.tar.gz"):
    with tarfile.open(backup/name) as archive:
        for entry in archive.getmembers():
            path = pathlib.PurePosixPath(entry.name)
            if path.is_absolute() or ".." in path.parts or entry.isdev():
                raise SystemExit("Unsafe archive member")
            if entry.issym() or entry.islnk():
                link = pathlib.PurePosixPath(entry.linkname)
                if link.is_absolute() or ".." in link.parts: raise SystemExit("Unsafe archive link")
                if name == "storage.tar.gz": raise SystemExit("Media archive links are not supported")
        if name == "storage.tar.gz": archive.extractall(work)
PY
mkdir -p "$work/redis" "$work/web"
cp "$backup/redis.rdb" "$work/redis/dump.rdb"
chmod 755 "$work" "$work/redis" "$work/web"
docker network create --internal "$network" >/dev/null
test "$(docker network inspect "$network" --format '{{.Internal}}')" = true
docker run -d --name "$prefix-postgres" --network "$network" --network-alias postgres \
  --memory=768m --cpus=0.75 --tmpfs /var/lib/postgresql/data:rw,size=512m \
  --mount "type=bind,src=$backup/aigc_drama.dump,dst=/backup.dump,readonly" \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
ready=false
for ((i=0;i<40;i++)); do
  if docker exec "$prefix-postgres" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
test "$ready" = true
docker exec "$prefix-postgres" createdb -U postgres audit_api_full_dr
docker exec "$prefix-postgres" pg_restore -U postgres -d audit_api_full_dr --exit-on-error \
  --single-transaction --no-owner --no-privileges /backup.dump
docker run -d --name "$prefix-redis" --network "$network" --network-alias redis \
  --memory=128m --cpus=0.25 -v "$work/redis:/data" redis:7-alpine \
  redis-server --appendonly no --appendfsync everysec --maxmemory-policy noeviction >/dev/null
for ((i=0;i<30;i++)); do if docker exec "$prefix-redis" redis-cli ping >/dev/null 2>&1; then break; fi; sleep 1; done
redis_keys="$(docker exec "$prefix-redis" redis-check-rdb /data/dump.rdb | python3 -c 'import re,sys;s=sys.stdin.read();a=re.search(r"(\d+) already expired",s);print(int(re.search(r"(\d+) keys read",s).group(1))-(int(a.group(1)) if a else 0))')"
restored_keys="$(docker exec "$prefix-redis" redis-cli --raw INFO keyspace | python3 -c 'import re,sys;print(sum(map(int,re.findall(r"keys=(\d+)",sys.stdin.read()))))')"
test "$redis_keys" = "$restored_keys"
# Load the RDB first, then migrate the live restored dataset to AOF.
test "$(docker exec "$prefix-redis" redis-cli --raw CONFIG SET appendonly yes)" = OK
# Pause restored production jobs before any worker exists. DB remains the source of truth
# for recovering undelivered text tasks; no supplier calls can leave the internal network.
docker run --rm -i --network "$network" --workdir /app/apps/api \
  -e DATABASE_URL=postgresql://postgres@postgres:5432/audit_api_full_dr \
  -e REDIS_URL=redis://redis:6379 "$image" node --input-type=module - <<'JS'
import { createRequire } from "node:module";
const require = createRequire("/app/apps/api/package.json");
const { Queue } = require("bullmq");
const queue = new Queue("generation", { connection: { host: "redis" } });
await queue.pause(); await queue.close();
JS
docker run --name "$prefix-web" --network none -v "$work/web:/publish" "$image" \
  sh -ec 'cp -a apps/web/dist/. /publish/' >/dev/null
docker run -d --name "$prefix-api" --network "$network" --network-alias api --memory=512m --cpus=1 \
  -v "$work/storage:/app/storage" -e NODE_ENV=production -e AIFILM_LOAD_ENV_FILES=false \
  -e DATABASE_URL=postgresql://postgres@postgres:5432/audit_api_full_dr -e REDIS_URL=redis://redis:6379 \
  -e OBJECT_STORAGE_LOCAL_DIR=/app/storage -e APP_REVISION="${image#*:}" \
  -e SEED_DEFAULT_USERS=false -e SEED_DEMO_USER=false -e SEED_DEMO_DATA=false \
  -e SEED_SYNC_EDITABLE_CONFIG=false -e WECHAT_PAY_ENABLED=false -e TRUST_PROXY=1 \
  -e API_RATE_LIMIT_MAX=100000 -e API_ACCESS_LOG=false "$image" >/dev/null
docker run -d --name "$prefix-nginx" --network "$network" --memory=64m --cpus=0.25 \
  -v "$(cd "$(dirname "$0")" && pwd)/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$work/web:/usr/share/nginx/html:ro" nginx:1.27-alpine >/dev/null
# Run verification and bounded HTTP load against the restored stack, from inside it.
docker exec -i -w /app/apps/api -e DR_BASE_URL="http://$prefix-nginx" -e DR_REDIS_KEYS="$redis_keys" -e DR_REVISION="${image#*:}" \
  "$prefix-api" node --input-type=module - < "$(dirname "$0")/verify_full_restore.mjs"
docker stats --no-stream "$prefix-api" "$prefix-postgres" "$prefix-redis" "$prefix-nginx"
echo "FULL_RESTORE_OK seconds=$(( $(date +%s)-started )) (isolated stack; no external payment/provider traffic)"
