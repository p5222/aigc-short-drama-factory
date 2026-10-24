#!/usr/bin/env bash
set -euo pipefail
container="${1:?CI PostgreSQL container required}"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
mkdir "$work/source" "$work/storage" "$work/backup"
printf 'restore-fixture\n' > "$work/source/release.txt"
printf 'media-fixture\n' > "$work/storage/media.txt"
docker exec "$container" pg_dump -U postgres -d audit_api_ci -Fc > "$work/backup/aigc_drama.dump"
tar -czf "$work/backup/source.tgz" -C "$work/source" .
tar -czf "$work/backup/storage.tar.gz" -C "$work/storage" .
(cd "$work/backup" && sha256sum aigc_drama.dump source.tgz storage.tar.gz > SHA256SUMS)
touch "$work/backup/COMPLETE"
bash "$(dirname "$0")/verify_backup_restore.sh" "$work/backup"
# A corrupted backup must fail before even creating an isolated database.
printf 'corrupt' >> "$work/backup/aigc_drama.dump"
if bash "$(dirname "$0")/verify_backup_restore.sh" "$work/backup"; then
  echo "Corrupt backup was accepted" >&2
  exit 1
fi
echo "RESTORE_FAILURE_GUARD_OK"
