#!/usr/bin/env bash
set -euo pipefail
umask 077
APP_DIR="${APP_DIR:-/opt/manjiao}"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/manjiao-backups}"
STATE_DIR="${MONITOR_STATE_DIR:-/var/lib/manjiao-monitor}"
mkdir -p "$STATE_DIR"
temporary="$(mktemp "$STATE_DIR/.result.XXXXXXXX")"
trap 'rm -f "$temporary"' EXIT
revision="$(docker inspect manjiao-api-1 --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
[[ "$revision" =~ ^[a-f0-9]{40}$ ]]
latest=0
while IFS= read -r -d '' complete; do
  directory="$(dirname "$complete")"
  [[ -f "$directory/SHA256SUMS" && ! -L "$directory/SHA256SUMS" && ! -L "$complete" ]] || continue
  seconds="$(stat -c %Y "$complete")"
  (( seconds <= latest )) || latest="$seconds"
done < <(find "$BACKUP_ROOT" -mindepth 2 -maxdepth 2 -type f -name COMPLETE -print0)
status=0
docker exec -i \
  -e MONITOR_URL="${MONITOR_URL:-https://manjiao.cloud/ready}" \
  -e MONITOR_REVISION="$revision" \
  -e MONITOR_TIMEOUT_MS=5000 \
  -e MONITOR_BACKUP_CHECK=true \
  -e MONITOR_BACKUP_LATEST_MS="$((latest * 1000))" \
  -e MONITOR_BACKUP_MAX_AGE_HOURS="${MONITOR_BACKUP_MAX_AGE_HOURS:-30}" \
  manjiao-api-1 node --input-type=module - < "$APP_DIR/deploy/site_monitor.mjs" > "$temporary" || status=$?
if [[ -s "$temporary" ]]; then
  mv "$temporary" "$STATE_DIR/latest.json"
  cat "$STATE_DIR/latest.json"
else
  printf '{"ok":false,"reason":"monitor_execution_failed"}\n' > "$temporary"
  mv "$temporary" "$STATE_DIR/latest.json"
  cat "$STATE_DIR/latest.json"
  status=1
fi
exit "$status"
