#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
test -f /opt/manjiao/deploy/scheduled_backup.sh
for unit in manjiao-backup.service manjiao-backup.timer; do
  target="/etc/systemd/system/$unit"
  test ! -L "$target"
  install -m 0644 "/opt/manjiao/deploy/$unit" "$target"
done
systemd-analyze verify /etc/systemd/system/manjiao-backup.service /etc/systemd/system/manjiao-backup.timer
systemctl daemon-reload
systemctl enable --now manjiao-backup.timer
systemctl list-timers manjiao-backup.timer --no-pager
