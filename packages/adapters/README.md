# packages/adapters

外部事实源适配器（Adapters）边界。

后续可接入：

- GitHub（Repository / Issue / PR / Actions / Milestone）；
- Cloudflare（Deployment / Worker / Runtime / Observability）；
- n8n（Workflow / Execution）；
- 其他 Metrics / Logs / Alerts / Incident 系统；
- Notion 等文档 / 计划来源。

V0.1 只保留模块边界，不要求自动接入完成。

Adapter 必须区分“外部观测事实（Observed Fact）”和“Atlas 定义性模型（Definition）”，不得把运行状态自动写成架构定义。
