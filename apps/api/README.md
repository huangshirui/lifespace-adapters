# apps/api

AISR Atlas API / 控制面后端（Control Plane Backend）。

V0.1 计划职责：

- Workspace / Unit Graph 的持久化入口；
- Draft / Published Revision / Diff / Change Log；
- Layout 与 Revision 绑定；
- Runtime State / Work State；
- 对 Web 与 MCP / Tool 提供统一领域能力；
- 强制执行 `packages/domain` 中的领域规则与不变量（Invariants）。

当前部署方向：Cloudflare Worker。正式存储模型在 V0.1 Schema 确定后再落地。
