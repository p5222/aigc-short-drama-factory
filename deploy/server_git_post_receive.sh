#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/opt/git/aigc-short-drama-factory.git"
APP_DIR="/opt/manjiao"
BACKUP_ROOT="/opt/manjiao-backups"
HELPER="$APP_DIR/deploy/manjiao_remote.sh"

while read -r oldrev newrev refname; do
  [ "$refname" = "refs/heads/main" ] || continue
  stamp="$(date +%Y%m%d_%H%M%S)"
  backup="$BACKUP_ROOT/${stamp}_git_${newrev:0:8}"
  log="/tmp/manjiao_git_deploy_${newrev:0:8}.log"

  echo "[deploy] backup -> $backup"
  bash "$HELPER" backup "$APP_DIR" "$backup" | tee "$log"
  git --git-dir="$REPO_DIR" archive --format=tar --output=/tmp/manjiao_release_HEAD.tar "$newrev"
  bash "$HELPER" extract "$APP_DIR" | tee -a "$log"

  if ! bash "$APP_DIR/deploy/manjiao_remote.sh" rebuild "$APP_DIR" | tee -a "$log"; then
    bash "$APP_DIR/deploy/manjiao_remote.sh" rollback "$APP_DIR" "$backup" | tee -a "$log"
    echo "[deploy] rebuild failed; rolled back" >&2
    exit 1
  fi

  healthy=false
  for _ in $(seq 1 30); do
    sleep 5
    if [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/health || true)" = "200" ]; then
      healthy=true
      break
    fi
  done
  if [ "$healthy" != true ]; then
    bash "$APP_DIR/deploy/manjiao_remote.sh" rollback "$APP_DIR" "$backup" | tee -a "$log"
    echo "[deploy] health check failed; rolled back" >&2
    exit 1
  fi
  echo "[deploy] OK ${newrev:0:8}, backup=$backup"
done
