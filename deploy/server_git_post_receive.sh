#!/usr/bin/env bash
set -euo pipefail
umask 077
REPO_DIR="${MANJIAO_REPO_DIR:-/opt/git/aigc-short-drama-factory.git}"
APP_DIR="${MANJIAO_APP_DIR:-/opt/manjiao}"
BACKUP_ROOT="${MANJIAO_BACKUP_ROOT:-/opt/manjiao-backups}"
LOG_ROOT="${MANJIAO_LOG_ROOT:-/opt/manjiao-deploy-logs}"
WORK=""
cleanup() { if [ -n "$WORK" ]; then rm -rf -- "$WORK"; fi; }
trap cleanup EXIT
for tool in flock mktemp git tar rsync python3 curl docker sha256sum; do command -v "$tool" >/dev/null; done
mkdir -p "$BACKUP_ROOT" "$LOG_ROOT"; chmod 700 "$BACKUP_ROOT" "$LOG_ROOT"
exec 9>"$REPO_DIR/manjiao-deploy.lock"
flock -w "${MANJIAO_DEPLOY_LOCK_TIMEOUT:-900}" 9 || { echo "[deploy] another deployment holds the lock" >&2; exit 1; }
while read -r oldrev newrev refname; do
  case "$refname" in refs/heads/main|refs/heads/deploy-requests/*) ;; *) continue;; esac
  [[ "$newrev" =~ ^0+$ ]] && continue
  current_main="$(git --git-dir="$REPO_DIR" rev-parse refs/heads/main)"
  if [ "$newrev" != "$current_main" ]; then echo "[deploy] request is not current server main; refusing stale deployment" >&2; exit 1; fi
  previous="$(git --git-dir="$REPO_DIR" rev-parse --verify refs/heads/deployed 2>/dev/null || true)"
  if [ "$previous" = "$newrev" ] && [ "$refname" = refs/heads/main ]; then echo "[deploy] commit already deployed"; continue; fi
  cleanup; WORK="$(mktemp -d "${TMPDIR:-/tmp}/manjiao-deploy.XXXXXXXX")"
  stamp="$(date +%Y%m%d_%H%M%S)"
  backup="$BACKUP_ROOT/${stamp}_${newrev:0:12}_$(basename "$WORK")"
  log="$LOG_ROOT/${stamp}_${newrev:0:12}_$(basename "$WORK").log"
  export MANJIAO_RELEASE="$newrev"
  export MANJIAO_RELEASE_ARCHIVE="$WORK/release.tar.gz"
  helper="$WORK/helper.sh"
  git --git-dir="$REPO_DIR" show "$newrev:deploy/manjiao_remote.sh" | tr -d '\r' > "$helper"
  chmod 700 "$helper"
  git --git-dir="$REPO_DIR" archive --format=tar.gz --output="$MANJIAO_RELEASE_ARCHIVE" "$newrev"
  echo "[deploy] $newrev; backup=$backup; log=$log"
  # Backup failure stops before changing application files or containers.
  bash "$helper" backup "$APP_DIR" "$backup" 2>&1 | tee "$log"
  if bash "$helper" extract "$APP_DIR" 2>&1 | tee -a "$log" &&
     bash "$helper" rebuild "$APP_DIR" 2>&1 | tee -a "$log" &&
     bash "$helper" ready "$APP_DIR" 2>&1 | tee -a "$log"; then
    git --git-dir="$REPO_DIR" update-ref refs/heads/deployed "$newrev"
    echo "[deploy] DEPLOY_OK $newrev"
    case "$refname" in refs/heads/deploy-requests/*) git --git-dir="$REPO_DIR" update-ref -d "$refname" "$newrev";; esac
  else
    export MANJIAO_RELEASE="${previous:-legacy}"
    if bash "$helper" rollback "$APP_DIR" "$backup" 2>&1 | tee -a "$log"; then
      echo "[deploy] RELEASE_FAILED; previous source readiness verified; deployed ref unchanged" >&2
    else
      echo "[deploy] RECOVERY_FAILED; manual recovery required; deployed ref unchanged; backup=$backup" >&2
    fi
    # Retry the same main commit through a new deploy-requests ref after repair.
    exit 1
  fi
done
