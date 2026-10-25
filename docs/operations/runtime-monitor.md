# 运行监测

`node deploy/site_monitor.mjs` 只读检查公开 `/ready`，默认 4 秒超时；任一依赖不就绪、错误 JSON、503、网络错误或目标版本不符时退出码为 1。输出仅含检查时间、结论和 revision，不输出返回的任意正文或访问凭据。

可用 `MONITOR_URL` 指定 HTTPS 地址或本机 HTTP；`MONITOR_REVISION` 指定 40 位目标提交；`MONITOR_TIMEOUT_MS` 必须为 1–30000。命令不请求生成或付款。

腾讯云部署后运行 `sudo bash /opt/manjiao/deploy/install_monitor_timer.sh`。专属 systemd timer 每 5 分钟检查一次（最多随机延迟 20 秒）。它核对应用镜像 revision 与公网 readiness，并查找同时具备 COMPLETE 和 SHA256SUMS 的最新备份。默认备份新鲜度 30 小时，适配每日 03:30、最多延迟 15 分钟的备份定时器；可通过 service drop-in 的 `MONITOR_BACKUP_MAX_AGE_HOURS` 修改。

```bash
systemctl list-timers manjiao-monitor.timer --no-pager
systemctl status manjiao-monitor.service --no-pager
journalctl -u manjiao-monitor.service -n 30 --no-pager
sudo cat /var/lib/manjiao-monitor/latest.json
```

`latest.json` 为最近一次完成检查的结论，journal 保留定时服务结果。备份检查只验证完成标记、校验清单存在与年龄，完整性仍需 SHA256 校验和隔离恢复演练。检测失败时先区分服务不可达、数据库/Redis/worker/catalog 未就绪、版本不同、备份缺失或过期，再按发布和恢复手册处理。

本工具不删除备份、不重启服务、不修复账务、不向外部发送消息。持续异地备份和外部告警接收渠道需要另行配置；本机失败日志不是外部告警送达证据。
