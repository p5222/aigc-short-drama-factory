#!/usr/bin/env bash
set -euo pipefail
umask 077
APP_DIR="${APP_DIR:-/opt/manjiao}"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/manjiao-backups}"
REPO_DIR="${MANJIAO_REPO_DIR:-/opt/git/aigc-short-drama-factory.git}"
exec 9>"$REPO_DIR/manjiao-deploy.lock"
flock -w 900 9
mkdir -p "$BACKUP_ROOT"
TARGET_DIR="$(mktemp -d "$BACKUP_ROOT/$(date +%Y%m%d_%H%M%S)_manual.XXXXXXXX")"
bash "$(dirname "$0")/manjiao_remote.sh" backup "$APP_DIR" "$TARGET_DIR"
cat > "$TARGET_DIR/RESTORE.md" <<'EOF'
# Restore notes

This backup contains a validated PostgreSQL custom dump, media, source and Redis
RDB snapshots. SHA256SUMS and COMPLETE must be present. Verify checksums before
recovery. Keep the backup private because the source archive includes server
environment configuration. This is not proof of a completed restore drill.

Run verify_full_restore.sh BACKUP_DIR manjiao-app:EXACT_REVISION for an isolated
API/web/database/media/queue recovery drill. That drill blocks external networking,
pauses recovered production jobs and measures bounded read-only HTTP capacity.
The online snapshots are sequential, not a single distributed transaction. Reconcile
DB-backed dispatch and paid provider tasks before resuming workers after real recovery.

Code rollback uses manjiao_remote.sh rollback APP_DIR BACKUP_DIR. It never restores
or downgrades the database. Application readiness must pass after the rollback.

Restore the database into an isolated empty database first and verify project,
task and credit records. A production database restore replaces newer writes:
stop API/worker writes, preserve the current database, and obtain an explicit
recovery decision before using pg_restore. Restore matching storage separately.
Do not run an old Compose command that automatically executes schema changes.
EOF
echo "BACKUP_COMPLETE $TARGET_DIR"
