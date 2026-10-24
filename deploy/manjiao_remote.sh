#!/usr/bin/env bash
# Deployment-host helper. Persistent state is excluded from source sync.
set -euo pipefail
umask 077
cmd="${1:-}"; RD="${2:-/opt/manjiao}"; BD="${3:-}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
READY_URL="${MANJIAO_READY_URL:-http://127.0.0.1:8080/ready}"
READY_ATTEMPTS="${MANJIAO_READY_ATTEMPTS:-60}"
READY_INTERVAL="${MANJIAO_READY_INTERVAL:-5}"
REDIS_ATTEMPTS="${MANJIAO_REDIS_PERSISTENCE_ATTEMPTS:-60}"
COMPOSE=(docker compose -f "$COMPOSE_FILE")
PREFLIGHT_SCRIPT="$(cd "$(dirname "$0")" && pwd)/release_preflight.py"
WORK=""
cleanup() { if [ -n "$WORK" ]; then rm -rf -- "$WORK"; fi; }
trap cleanup EXIT
check_app_dir() {
  RD="$(realpath -e -- "$RD")"
  if [ "$RD" = / ] || [ "$RD" = /opt ] || [ "$RD" = /home ]; then echo "Unsafe application directory" >&2; exit 2; fi
  test -f "$RD/package.json"; test -f "$RD/$COMPOSE_FILE"
  cd "$RD"
}
private_workdir() { if [ -z "$WORK" ]; then WORK="$(mktemp -d "${TMPDIR:-/tmp}/manjiao-helper.XXXXXXXX")"; fi; }
has_release_image() {
  local revision="${MANJIAO_RELEASE:-}"
  [[ "$revision" =~ ^[a-f0-9]{40}$ ]] || return 1
  local label
  label="$(docker image inspect "manjiao-app:$revision" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' 2>/dev/null)" || return 1
  [ "$label" = "$revision" ]
}
check_space() {
  local flags=()
  if has_release_image; then flags+=(--prebuilt); fi
  python3 "$PREFLIGHT_SCRIPT" --app "$RD" --backups "${MANJIAO_BACKUP_ROOT:-/opt/manjiao-backups}" \
    --repo "${MANJIAO_REPO_DIR:-/opt/git/aigc-short-drama-factory.git}" --phase "$1" "${flags[@]}"
}
ready_once() {
  local body expected_revision="${2:-${MANJIAO_RELEASE:-}}"
  body="$(curl --fail --silent --show-error --connect-timeout 3 --max-time 10 "$1")" || return 1
  printf '%s' "$body" | python3 -c 'import json,sys; v=json.load(sys.stdin); expected=sys.argv[1]; sys.exit(0 if isinstance(v,dict) and v.get("ok") is True and (expected == "legacy" or not expected or v.get("revision") == expected) else 1)' "$expected_revision" 2>/dev/null
}
wait_ready() {
  local allow_legacy="${1:-false}" attempt
  for ((attempt=1; attempt<=READY_ATTEMPTS; attempt++)); do
    if ready_once "$READY_URL"; then echo "READY_OK"; return 0; fi
    if [ "$allow_legacy" = true ] && ready_once "${MANJIAO_LEGACY_READY_URL:-http://127.0.0.1:8080/api/system/health/dependencies}" legacy; then
      echo "LEGACY_DEPENDENCIES_OK (older release has no worker readiness contract)"; return 0
    fi
    if ((attempt < READY_ATTEMPTS)); then sleep "$READY_INTERVAL"; fi
  done
  echo "Readiness did not pass" >&2; return 1
}
redis_aof_ready() {
  local state
  state="$("${COMPOSE[@]}" exec -T redis redis-cli --raw INFO persistence)" || return 1
  printf '%s' "$state" | python3 -c 'import sys; d=dict(line.split(":",1) for line in sys.stdin.read().splitlines() if ":" in line); expected={"loading":"0","aof_enabled":"1","aof_rewrite_in_progress":"0","aof_rewrite_scheduled":"0","aof_last_bgrewrite_status":"ok","aof_last_write_status":"ok"}; sys.exit(0 if all(d.get(k)==v for k,v in expected.items()) else 1)' 2>/dev/null
}
wait_redis_aof() {
  local attempt
  for ((attempt=1; attempt<=REDIS_ATTEMPTS; attempt++)); do
    if redis_aof_ready; then return 0; fi
    if ((attempt < REDIS_ATTEMPTS)); then sleep "$READY_INTERVAL"; fi
  done
  echo "Redis AOF did not finish a healthy rewrite; refusing to replace its container" >&2
  return 1
}
ensure_redis_persistence() {
  local setting value reply
  # Enable AOF on the LIVE instance first. Replacing an RDB-only container first
  # could lose queue writes that have not reached a snapshot. Redis rewrites the
  # current dataset into AOF and buffers concurrent writes before reporting ready.
  for setting in appendfsync maxmemory-policy appendonly; do
    case "$setting" in appendfsync) value=everysec;; maxmemory-policy) value=noeviction;; appendonly) value=yes;; esac
    reply="$("${COMPOSE[@]}" exec -T redis redis-cli --raw CONFIG SET "$setting" "$value")"
    if [ "$reply" != OK ]; then echo "Redis refused persistence setting $setting" >&2; return 1; fi
  done
  wait_redis_aof
  # The existing redis_data volume is preserved. A graceful stop flushes AOF.
  "${COMPOSE[@]}" up -d --no-deps redis
  wait_redis_aof
  echo "REDIS_AOF_READY"
}
sync_source() {
  command -v rsync >/dev/null
  private_workdir; mkdir -p "$WORK/source"
  tar -xzf "$1" -C "$WORK/source"
  test -f "$WORK/source/package.json"; test -f "$WORK/source/$COMPOSE_FILE"
  # Legacy bind-mounted containers created root-owned build output and caches.
  # These are not release source; preserve them, including nested dist/storage.
  rsync -a --no-owner --no-group --checksum --delete --exclude='/.git/' --exclude='/.env' --exclude='/.env.*' \
    --exclude='node_modules/' --exclude='.pnpm-store/' --exclude='dist/' \
    --exclude='/storage/' --exclude='/backups/' \
    --exclude='/outputs/' --exclude='/tmp/' --exclude='*.local.txt' \
    "$WORK/source/" "$RD/"
}
case "$cmd" in
  preflight) check_app_dir; check_space backup;;
  backup)
    check_app_dir; test -n "$BD"; check_space backup; mkdir -p -- "$BD"; BD="$(realpath -e -- "$BD")"
    case "$BD/" in "$RD/"*) echo "Backup must be outside the application directory" >&2; exit 2;; esac
    test ! -e "$BD/COMPLETE"; chmod 700 "$BD"
    "${COMPOSE[@]}" exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BD/aigc_drama.dump.partial"
    test -s "$BD/aigc_drama.dump.partial"
    "${COMPOSE[@]}" exec -T postgres pg_restore --list < "$BD/aigc_drama.dump.partial" > /dev/null
    mv "$BD/aigc_drama.dump.partial" "$BD/aigc_drama.dump"
    "${COMPOSE[@]}" exec -T api sh -lc 'cd /app && tar -czf - storage' > "$BD/storage.tar.gz.partial"
    tar -tzf "$BD/storage.tar.gz.partial" > /dev/null
    mv "$BD/storage.tar.gz.partial" "$BD/storage.tar.gz"
    # Only the root storage directory is persistent media; src/storage is code.
    tar --exclude=node_modules --exclude=.git --exclude=.pnpm-store --exclude=dist --exclude=__pycache__ \
      --exclude='./storage' --exclude='./backups' --exclude='./outputs' --exclude='./tmp' -czf "$BD/source.tgz.partial" -C "$RD" .
    tar -tzf "$BD/source.tgz.partial" > /dev/null
    mv "$BD/source.tgz.partial" "$BD/source.tgz"
    (cd "$BD" && sha256sum aigc_drama.dump storage.tar.gz source.tgz > SHA256SUMS)
    printf 'source-and-data-backup-v1\n' > "$BD/COMPLETE"
    echo "BACKUP_DONE $BD"
    ;;
  extract)
    check_app_dir
    archive="${MANJIAO_RELEASE_ARCHIVE:?A private release archive path is required}"
    test -s "$archive"; sync_source "$archive"; echo "EXTRACTED"
    ;;
  rebuild)
    check_app_dir
    check_space build
    if has_release_image; then
      echo "REUSING_VERIFIED_RELEASE_IMAGE $MANJIAO_RELEASE"
    else
      "${COMPOSE[@]}" build api
    fi
    check_space activate
    ensure_redis_persistence
    # Existing database has no complete migration baseline. Destructive sync fails.
    # Schema sync is a release step and never runs on ordinary container restart.
    "${COMPOSE[@]}" run --rm --no-deps --entrypoint pnpm api --filter @aifilm/api db:push:deploy
    "${COMPOSE[@]}" up -d --no-deps --force-recreate api
    "${COMPOSE[@]}" up -d --no-deps --force-recreate nginx
    wait_ready
    "${COMPOSE[@]}" run --rm --no-deps web
    echo "REBUILD_READY"
    ;;
  ready) wait_ready;;
  health) curl --silent --show-error --connect-timeout 3 --max-time 10 -o /dev/null -w '%{http_code}' "$READY_URL";;
  rollback)
    check_app_dir; test -f "$BD/COMPLETE"
    (cd "$BD" && sha256sum --check --status SHA256SUMS)
    sync_source "$BD/source.tgz"
    if [ -f deploy/Dockerfile ]; then
      if ! docker image inspect "manjiao-app:${MANJIAO_RELEASE:-local}" >/dev/null 2>&1; then
        "${COMPOSE[@]}" build api
      fi
      "${COMPOSE[@]}" up -d --no-deps --force-recreate api
      "${COMPOSE[@]}" up -d --no-deps --force-recreate nginx
      wait_ready
      "${COMPOSE[@]}" run --rm --no-deps web
    else
      # Legacy startup performed destructive schema sync. Never run it on rollback.
      private_workdir
      cat > "$WORK/legacy-rollback.yml" <<'EOF'
services:
  api:
    command: >
      sh -lc "corepack enable && corepack prepare pnpm@11.7.0 --activate &&
      pnpm install --frozen-lockfile && pnpm --filter @aifilm/shared build &&
      pnpm --filter @aifilm/api db:generate && pnpm --filter @aifilm/api build &&
      node apps/api/dist/server.js"
EOF
      COMPOSE+=(-f "$WORK/legacy-rollback.yml")
      "${COMPOSE[@]}" run --rm --no-deps web
      "${COMPOSE[@]}" up -d --no-deps --force-recreate api
      "${COMPOSE[@]}" up -d --no-deps --force-recreate nginx
      wait_ready true
    fi
    echo "SOURCE_ROLLBACK_READY (database and storage were not reverted)"
    ;;
  *) echo "Usage: manjiao_remote.sh {preflight|backup|extract|rebuild|ready|health|rollback} [app_dir] [backup_dir]" >&2; exit 2;;
esac
