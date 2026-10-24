#!/usr/bin/env bash
# Invoked by the server timer; intentionally never deletes an existing backup.
set -euo pipefail
umask 077
APP_DIR="${APP_DIR:-/opt/manjiao}"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/manjiao-backups}"
revision="$(docker inspect manjiao-api-1 --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
[[ "$revision" =~ ^[a-f0-9]{40}$ ]]
export MANJIAO_RELEASE="$revision" APP_DIR BACKUP_ROOT
exec bash "$APP_DIR/deploy/backup_server_state.sh"
