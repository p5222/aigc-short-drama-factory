# AI 短剧工厂

专业 AIGC 漫剧/短剧创作 SaaS 原型，目标是打通“故事输入 -> 策划 -> 编剧 -> 分镜 -> 角色资产 -> 图片 -> 图生视频 -> 配音字幕 -> 导出”的闭环。

当前代码已包含用户创作、项目生产和运营后台；早期开发记录中的能力描述可能落后于实现。最新模块流程、迭代内容与商用缺口见 [2026-10-23 迭代说明](./docs/commercial-iteration-20261023.md)。UI 回归通过不代表真实支付、供应商和生产部署已验收。

- `apps/web`：用户端与后台管理 SPA，页面结构参考 U 漫剧工作台，但使用独立命名和自有视觉。
- `apps/api`：Express TypeScript API，已接 PostgreSQL、Redis + BullMQ、积分流水、模型供应商、模型计费表和真实文本生成。
- `packages/shared`：前后端共享业务类型。
- `docker-compose.yml`：预留 PostgreSQL、Redis、MinIO，本地演示和后续升级使用。

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
- 演示账号：`demo@aifilm.local` / `demo123456`
- 演示手机号：`13900000002` / `demo123456`
- 后台管理员：`admin@aifilm.local` / `admin123456`

## 当前能力

- U 漫式左侧导航、顶部搜索、工作台、创作向导、剧本、任务、积分、帮助中心。
- 后台管理页面：总览、用户、供应商、模板、任务、积分。
- 创作向导可估算集数和积分，并创建演示项目与任务。
- 创作向导支持文本模型路由选择，并可测试 DeepSeek/OpenAI-compatible 连通性。
- 后台管理展示并可编辑用户积分、兑换码、会员权益、充值包、供应商、模型列表、提示词模板和模型计费表。
- 任务中心展示 pending/running/succeeded/failed 等状态。
- 积分账户、套餐、冻结、扣费、退款和流水已落 PostgreSQL。
- 充值积分永久有效；兑换码用于体验额度；会员为每月额度、权益折扣和优先队列，不做无限量。
- 默认主推 DeepSeek / 豆包 / Qwen 低成本闭环，高质量模式保留 `gpt-5.5` 与 `gpt-image-2`。
- 角色一致性、分镜质量规则、供应商能力、角色资产和分镜资产关联已进入生成主链路。
- 图片/视频生成是可插拔接口，默认 mock，开启通义万相配置后可切真实图片模型。

## 设计文档

- [完整 PRD](./aigc_short_drama_saas_prd.md)
- [U 漫式递进复刻设计](./u_manga_progressive_clone_design.md)
- [Toonflow 开源能力复用策略](./docs/toonflow_reuse_strategy.md)
- [功能模块设计记录](./docs/feature_module_design_record.md)
- [开源计费、模型网关与后台模板选型](./docs/open_source_billing_admin_options.md)
- [开发状态记录](./docs/development_status.md)
- [VPS 测试部署与迁移指南](./docs/vps_deployment_guide.md)

## 开发路线

1. 接入真实支付或后台充值订单表。
2. 增加会员订阅发放任务和权益折扣结算。
3. 接入更多国内图片 API，实现真实文生图和 image2 稳定 fallback。
4. 增加 ComfyUI Provider，高级模式支持本地/云 GPU。
5. 增加真实图生视频 Provider。
6. 增加 FFmpeg 导出、TTS 和字幕。
7. 后续可接 LiteLLM 模型网关或 Flexprice usage billing。
