# 支付、会员、账单与整站恢复

## 已实现的交易规则

- 微信普通商户 Native 支付。商户配置只保存在服务器 `.env.production`；参考 `.env.production.example` 的 `WECHAT_PAY_*`。
- 原始回调报文 RSA-SHA256 验签、可信公钥 ID 校验、5 分钟时间窗、AES-256-GCM 解密。核对 appid、mchid、订单、人民币金额分、交易类型和支付时间。
- 持久化购买请求 ID、固定价格及权益快照、跨订单支付流水保护。支付、积分流水与会员权益在同一 PostgreSQL 事务提交；重复通知不重复入账。
- 主动查单每 15 秒扫描待确认订单；同一订单至少间隔 10 秒查询。查询确认成功才入账；过期订单先向微信关单。
- 月卡按次购买，不自动扣款。同档续费顺延一个自然月；月末按下月最后一天截断。每次付款立即发放该次积分，充值积分永久有效。有效会员期间限制跨档购买。
- 会员折扣在任务首次冻结时保存。冻结原价上限，成功后按折扣结算、向上取整到整数积分，释放差额；失败释放冻结。同一项目累计消费记录实际扣费。上线前已冻结的任务保持原有价格。
- 优先级用于平台的创作文本队列，不承诺上游图片、视频供应商的处理速度。自动代扣需另外签约，当前接口始终返回 `autoRenew: false`。

官方规范：
[Native 下单](https://pay.weixin.qq.com/doc/v3/merchant/4012791877.md)、
[支付回调](https://pay.weixin.qq.com/doc/v3/merchant/4012791882.md)、
[公钥验签](https://pay.weixin.qq.com/doc/v3/merchant/4013053249)、
[主动查单](https://pay.weixin.qq.com/doc/v3/merchant/4013070356.md)。

## 真实现金验收

先完成微信商户号与 appid 绑定、公钥/商户私钥/APIv3 密钥配置及公网 HTTPS 回调地址。用专用验收账号购买一笔积分和一笔月卡，再验收同档续费；核对微信交易号、订单分金额、到账积分、会员期限和账单。

回调重放、金额不一致、错误公钥、重复点击、网络超时恢复、查单补账和同档续期均须检查。测试密钥、接口夹具和数据库事务测试不能代替真实支付。退款目前需要商户平台人工处理及平台权益核对，自动退款/自动代扣不属于已开放能力。

## 供应商样片和账单

沿用 `real-provider-acceptance.md` 的两镜头、10 秒样片方案。文档里的 466 平台积分不是供应商人民币预算。运行真实付费生成前，需要专用验收账号、人民币费用上限、指定供应商/模型，以及可获取的真实账单。

用 `tools/commerce/export-billing-snapshot.mjs` 在 API 容器内对指定时间段生成只读快照；快照不包含用户输入或供应商密钥。再把实际账单规范为：

```json
{
  "payments": [
    { "channel": "wechat", "tradeNo": "真实交易号", "orderId": "真实订单号", "amountMinor": 3990, "currency": "CNY", "status": "succeeded" }
  ],
  "providers": [
    { "providerId": "与快照相同的渠道标识", "requestId": "真实供应商请求号", "amountMinor": 100, "currency": "CNY" }
  ]
}
```

以上仅为格式说明，不是交易记录。执行 `node tools/commerce/reconcile-bills.mjs SNAPSHOT REAL_BILLS RESULT`。工具按实际交易号/请求号核对，不把积分换算为现金、不假设汇率，也不把后台 `vendorCostCny` 当作账单。重复身份会被拒绝；缺少账单、孤立费用、金额不一致和缺少上游请求号会明确列为待核对。历史任务和部分渠道未保留可匹配的上游请求号，不能直接宣称已经完成供应商成本对账。

## 备份与恢复

`backup_server_state.sh` 取得部署锁，备份 PostgreSQL 自定义格式、媒体、源码/环境和通过校验的 Redis RDB，写入 SHA256SUMS 后才创建 COMPLETE。备份包含密钥配置，必须私有保存。在线数据库、媒体和 Redis 快照按顺序取得，不是跨系统同一事务；恢复后先暂停生产任务并核对 DB 持久化请求，再恢复派发。

`verify_full_restore.sh BACKUP_DIR manjiao-app:EXACT_REVISION`：

1. 校验完整性、归档路径、镜像版本和磁盘余量。
2. 在无外网、无宿主端口、无生产挂载的内部网络恢复 PostgreSQL、媒体、Redis、API、前端和 Nginx。
3. PostgreSQL 等待正式 TCP 服务；Redis 先加载 RDB，再对已加载数据启用 AOF，核对键数量。
4. 暂停恢复出的生产队列，不注入商户或供应商凭证；检查真实依赖就绪、前端资源哈希及媒体鉴权/Range 字节。
5. 仅在隔离 API 提高 IP 限流阈值，按 10/20/30 RPS 各测试 15 秒；失败比例不超过 1%，P95 小于 1 秒，无丢弃。
6. 对独立 Redis 队列运行 200 个夹具任务，验证 20 次首次失败重试和会员优先级；核对财务总额与生产任务数保持不变。

2026-10-24 使用版本 `d069367c8ab2e55146b1652d740b352a58b19e7c` 的完整备份演练通过：55 秒；11 个 Redis 键；5 个原始媒体文件；900 次请求无失败/丢弃，P95 为 10/8/8 ms。队列 200 次唯一完成，20 个重试夹具，无最终失败。该结果只覆盖指定资源限制下的读请求和本地队列，不是付费模型生成吞吐或生产峰值承诺。

## 例行备份与外部条件

部署后运行 `sudo bash /opt/manjiao/deploy/install_backup_timer.sh`，安装专属 systemd 每日备份定时器，北京时间 03:30 开始并随机延迟最多 15 分钟。使用 `systemctl list-timers manjiao-backup.timer`、`systemctl status manjiao-backup.service`、`journalctl -u manjiao-backup.service` 检查结果。

脚本不删除历史备份；磁盘余量不足时拒绝继续。现有服务器磁盘容量有限，持续商用需要独立对象存储/异地空间及自动上传、完整性核验、保留策略和失败告警。已复制到本地的备份证明了一次异机副本，不能代替持续异地备份服务。完整应用镜像还应在独立存储保留，避免依赖 7 天有效期的 GitHub CI 产物。
