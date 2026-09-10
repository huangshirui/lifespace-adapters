# MCP Adapter

This directory owns the concrete MCP（Model Context Protocol，模型上下文协议） adapter for LifeSpace.

Current status: **query Projection Core implemented and tested; MCP Server / transport / deployment runtime not implemented yet**.

The current M0 code proves the protocol-independent path:

```text
GET /api/v1/me/_discovery/inventory
        ↓
select visible model keys
        ↓
GET /api/v1/spaces/{spaceId}/_discovery/models/{modelKey}
        ↓
MCP Tool inputSchema + execution binding
        ↓
canonical LifeSpace model query request
```

Files:

- `src/progressive-discovery.mjs` loads compact inventory plus only the selected model semantic details and fails closed when `key/version/schemaHash` drift;
- `src/projection.mjs` deterministically projects Generic Query and capability-query metadata into MCP Tool schemas and builds canonical LifeSpace query requests;
- `test/projection.test.mjs` uses synthetic fixtures to prove Progressive Discovery request bounds, Time Semantics projection, Space isolation and fail-closed behavior.

The adapter must:

- derive visible MCP capabilities from current LifeSpace Runtime Discovery（运行时发现）;
- preserve Space Context（空间上下文）;
- execute only through canonical LifeSpace operations;
- preserve Principal / Actor / Application Context（权限主体 / 执行者 / 应用上下文） semantics;
- fail closed when LifeSpace contract semantics cannot be represented safely;
- never expose Platform Admin（平台管理） control-plane operations through ordinary Agent discovery.

The M0 projection targets LifeSpace Core Kernel `0.35.0` Time Semantics and the MCP `2026-07-28` Tool schema model. It deliberately does **not** choose an MCP SDK, HTTP transport, OAuth profile or deployment runtime.

See [`../../docs/mcp-adapter.md`](../../docs/mcp-adapter.md) before extending implementation.

Do not add a local domain model, permission database, copied Model Registry or direct D1 access here.
