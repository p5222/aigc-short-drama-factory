# 漫角 Studio

漫剧与短剧创作平台，覆盖“故事输入 → 策划 → 编剧 → 分镜 → 角色资产 → 图片 → 图生视频 → 配音字幕 → 导出 → 作品审核公开展示”。

全流程产品与迭代设计见 [全视角评审方案](./docs/product/project-iteration-20261026.html)，实现与验收状态见 [实施矩阵](./docs/operations/project-review-implementation-20261026.md)。已发布基线见 [前后台重构发布记录](./outputs/ui-redesign-release-20261025.md)。历史文档中的“当前”仅代表记录日期；UI、数据库机制、公开部署、供应商质量和真实支付分别验收。

- `apps/web`：用户端与后台管理 SPA，页面结构参考 U 漫剧工作台，但使用独立命名和自有视觉。
- `apps/api`：Express TypeScript API，已接 PostgreSQL、Redis + BullMQ、积分流水、模型供应商、模型计费表和真实文本生成。
- `packages/shared`：前后端共享业务类型。
- `docker-compose.yml`：本地 PostgreSQL、Redis 与对象存储开发配置；`deploy/`：生产镜像、备份、恢复和运行监测。

## 快速启动

跨电脑开发、GitHub 分支协作和腾讯云发布请先阅读 [GitHub 与跨设备发布指南](./docs/operations/github-and-multi-device-deployment.md)。生产发布入口：`pnpm deploy:server`。

需要图形操作时，使用 [Git Workbench 便携工作台](./tools/git-workbench/README.md)：支持在 Windows、macOS、Linux 克隆、拉取、建分支、审查文件、提交和推送。复制整个工具文件夹即可在其他电脑使用。

```bash
pnpm install
pnpm --filter @aifilm/api db:generate
pnpm dev
```

`pnpm dev` 会先构建共享包，避免全新检出时找不到 `@aifilm/shared`。API 仍需按环境示例配置并启动 PostgreSQL、Redis。检查命令：`pnpm typecheck`、`pnpm test`、`pnpm build`。界面回归：`pnpm --filter @aifilm/web test:e2e`（先安装 Playwright Chromium，或通过 `PLAYWRIGHT_EXECUTABLE_PATH` 指定本机 Chrome）。

Windows 一键启动前端、后台 API 和数据库：

```bat
start_admin_server.bat
```

默认地址：

- Web: `http://localhost:5173`
- API: `http://localhost:4000/health`
- 后台管理：`http://localhost:5173/admin`
- 本地演示账号按种子配置创建；不要在生产启用默认测试账号或默认密码。生产初始化参考环境示例与部署手册。

## 当前能力

- 内容创作五阶段、空白新建与主动恢复草稿、四阶段制作台、当前集时间线、真实 MP4 / 配音 / 字幕导出。
- 前后台桌面、手机、深浅主题适配；工作台全量待办、任务排障摘要与帮助工单入口。
- PostgreSQL 持久积分账户与流水；报价确认、任务冻结、成功结算、失败解冻及请求重放保护。解冻不代表现金退款。
- 真实文本、图片、视频、配音供应商按数据库渠道和模型配置调用；生产缺配置时明确失败，不用模拟结果代替真实生成。渠道测试仅管理员可用。
- 素材输入快照、历史版本、下游失效、导出范围和作品审核来源校验。部分剧集成片不提前标记整部作品完成。
- 后台用户筛选/分页、注册/登录时间、积分调整、账号回收与恢复；公告排期、工单回复、作品审核、模型路由/价格、质量中心、审计记录。
- 微信 Native 支付、验签回调与主动查单代码；月卡按次购买、同档续期、积分永久有效、会员折扣与文本队列优先级。配置并完成真实验收前保持关闭；不自动续扣。
- 持久队列、发布容量保护、同版本镜像、自动回滚、每日完整备份、隔离恢复和有界运行监测。

## 设计文档

- [支付、会员、账单与整站恢复](./docs/operations/commerce-and-full-recovery.md)
- [运行监测与备份新鲜度](./docs/operations/runtime-monitor.md)
- [完整 PRD](./aigc_short_drama_saas_prd.md)
- [U 漫式递进复刻设计](./u_manga_progressive_clone_design.md)
- [Toonflow 开源能力复用策略](./docs/toonflow_reuse_strategy.md)
- [功能模块设计记录](./docs/feature_module_design_record.md)
- [开源计费、模型网关与后台模板选型](./docs/open_source_billing_admin_options.md)
- [开发状态记录](./docs/development_status.md)
- [VPS 测试部署与迁移指南](./docs/vps_deployment_guide.md)

## 验收与开放边界

`pnpm test` 执行单元与传输测试；依赖真实数据库的测试在未指定隔离测试环境时可能跳过，应以 CI 的 PostgreSQL/Redis 全量测试为准。`pnpm --filter @aifilm/web test:e2e` 执行全部桌面/手机 UI 套件，使用隔离接口夹具；它不证明真实供应商输出质量或付款到账。CI 还执行生产镜像、真实媒体编码、备份恢复和队列验证。

商业开放仍需商户配置、专用样片账号和人民币预算、真实供应商与支付账单、持续异地备份及外部告警接收渠道。自动现金退款与自动代扣未开放；单 API 进程限流在多副本扩容前需要共享存储。有限读压测不代表付费生成或生产峰值容量。
