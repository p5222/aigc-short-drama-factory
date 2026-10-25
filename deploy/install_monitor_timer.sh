#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
test -f /opt/manjiao/deploy/site_monitor.mjs
test -f /opt/manjiao/deploy/scheduled_monitor.sh
for unit in manjiao-monitor.service manjiao-monitor.timer; do
  target="/etc/systemd/system/$unit"
  test ! -L "$target"
  install -m 0644 "/opt/manjiao/deploy/$unit" "$target"
done
systemd-analyze verify /etc/systemd/system/manjiao-monitor.service /etc/systemd/system/manjiao-monitor.timer
systemctl daemon-reload
systemctl enable --now manjiao-monitor.timer
systemctl start manjiao-monitor.service
systemctl list-timers manjiao-monitor.timer --no-pager
