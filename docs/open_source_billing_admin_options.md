# 开源计费、模型网关与后台模板选型

## 结论

本项目当前采用自研轻量计费模型：

- `model_providers`：供应商和模型能力。
- `model_prices`：模型计费单位与积分单价。
- `credit_accounts`：用户积分账户。
- `credit_transactions`：冻结、消费、退款、充值流水。
- `generation_tasks`：每次生成任务绑定 provider、model、estimatedCredits、finalCredits。

这套结构适合 MVP 和作品集，也方便后续接入开源计费系统或模型网关。

## 计费模型可以直接借鉴的开源项目

### Flexprice

适合阶段：商业化后，需要更完整的 usage-based billing、credits、top-up、invoice、entitlement。

可借鉴能力：

- usage metering
- credits / top-ups
- pricing plans
- feature access
- invoice / billing reports

不建议现在直接整套接入，原因是它的基础设施较重，涉及 API、worker、Kafka、ClickHouse、Temporal 等。当前项目先用 Prisma 落地核心计费表，更利于快速演示和开发。

### LiteLLM

适合阶段：接入大量文本模型后，需要统一网关、虚拟 key、预算、成本统计、fallback、日志。

可借鉴能力：

- OpenAI-compatible proxy
- 100+ LLM provider gateway
- cost tracking
- per project/user spend management
- retry/fallback/load balancing
- admin dashboard

建议路线：第一版继续用本项目 provider adapter；当模型供应商超过 3-5 个时，把 LiteLLM 放到 API 和真实模型之间作为模型网关。

## 后台管理模板可以直接用的开源项目

### Ant Design Pro

适合 React 后台。MIT license，企业后台组件、布局、列表、表单、权限都比较完整。

如果要替换当前自写后台，优先考虑它；但当前项目已经是轻量 React + Vite，为了保持前后台视觉一致，建议先继续自研后台模块，后续再逐步引入 Ant Design Pro 的表格、表单和权限结构。

### Vue Vben Admin

适合 Vue3 技术栈，视觉成熟，后台模块丰富。若项目未来改成 Vue 或单独做运营后台，可以参考。

### react-admin

适合数据管理后台，CRUD 能力强。如果后续后台主要是用户、项目、流水、模型价格、模板这些数据表管理，可以作为单独 admin app 接入。

## 本项目当前采用的实现方式

1. 后台管理页展示供应商列表、模型列表、模板列表和模型计费表。
2. 创作向导支持文本模型路由选择，并能测试模型连通性。
3. 生成任务写入真实 provider/model。
4. 文本生成采用冻结积分 -> 成功扣费 / 失败退款。
5. 图片生成先检查余额，再调用模型，再按实际新增资产数扣费。
6. 重复生成不会重复创建资产，也不会重复扣费。

## 后续商业化排期

1. 后台增加模型价格编辑表单。
2. 增加充值订单表和支付回调。
3. 增加 LiteLLM 网关选项。
4. 增加 Flexprice 适配层，将 `credit_transactions` 同步为 usage event。
5. 增加后台权限：运营、管理员、财务、普通创作者。
6. 增加用户级预算、项目级预算、供应商成本报表。

