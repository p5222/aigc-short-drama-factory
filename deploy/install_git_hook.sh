#!/usr/bin/env bash
# Install only the reviewed hook; this command does not deploy application code.
set -euo pipefail
umask 077
SOURCE="${1:?Usage: install_git_hook.sh /path/to/reviewed/post-receive}"
REPO_DIR="${MANJIAO_REPO_DIR:-/opt/git/aigc-short-drama-factory.git}"
test -f "$SOURCE"
test -d "$REPO_DIR/hooks"
test "$(git --git-dir="$REPO_DIR" rev-parse --is-bare-repository)" = true
for tool in docker git rsync python3 flock curl tar sha256sum; do command -v "$tool" >/dev/null; done
docker compose version >/dev/null
exec 9>"$REPO_DIR/manjiao-deploy.lock"
flock -w 60 9
TEMP_HOOK="$(mktemp "$REPO_DIR/hooks/.post-receive.XXXXXXXX")"
trap 'if [ -n "$TEMP_HOOK" ]; then rm -f -- "$TEMP_HOOK"; fi' EXIT
tr -d '\r' < "$SOURCE" > "$TEMP_HOOK"
bash -n "$TEMP_HOOK"
chmod 700 "$TEMP_HOOK"
if [ -f "$REPO_DIR/hooks/post-receive" ]; then
  mkdir -p "$REPO_DIR/hooks-backups"
  chmod 700 "$REPO_DIR/hooks-backups"
  cp -p "$REPO_DIR/hooks/post-receive" "$REPO_DIR/hooks-backups/post-receive.$(date +%Y%m%d_%H%M%S).$$"
fi
mv -f -- "$TEMP_HOOK" "$REPO_DIR/hooks/post-receive"
TEMP_HOOK=""
echo "HOOK_INSTALLED (no application deployment performed)"
