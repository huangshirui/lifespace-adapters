# MCP Adapter

This directory owns the concrete MCP（Model Context Protocol，模型上下文协议） adapter for LifeSpace.

Current status: **Canonical Query Projection Core implemented and tested; MCP Server / transport / deployment runtime not implemented yet**.

The current M0 code proves the protocol-independent path:

```text
GET /api/v1/me/_discovery/inventory
        ↓
select visible model keys
        ↓
GET /api/v1/spaces/{spaceId}/_discovery/models/{modelKey}
        ↓
one MCP Canonical Query Tool per model + execution binding
        ↓
POST /api/v1/spaces/{spaceId}/models/{modelKey}/records/query
```

Files:

- `src/progressive-discovery.mjs` loads compact inventory plus only selected semantic details and fails closed when `key/version/schemaHash` drift;
- `src/projection.mjs` projects `query.canonical` into one MCP Tool per selected model and builds Canonical Query POST requests;
- `test/projection.test.mjs` proves Progressive Discovery bounds, descriptor-backed Search/Filter/Sort/Pagination, range forwarding and Space isolation;
- `test/projection-fail-closed.test.mjs` proves unsupported or stale semantics are rejected.

The adapter must:

- derive visible MCP capabilities from current LifeSpace Runtime Discovery（运行时发现）;
- preserve Space Context（空间上下文）;
- execute only through canonical LifeSpace operations;
- preserve Principal / Actor / Application Context（权限主体 / 执行者 / 应用上下文） semantics;
- fail closed when LifeSpace contract semantics cannot be represented safely;
- never expose Platform Admin（平台管理） control-plane operations through ordinary Agent discovery.

The M0 projection targets LifeSpace Core Kernel `0.36.0` Canonical Typed Query and the MCP `2026-07-28` Tool schema model. Legacy `query.filters`, `query.comparisons`, and `query.capabilityQueries` may remain in compatibility Discovery, but they do not generate a second MCP query surface.

It deliberately does **not** choose an MCP SDK, HTTP transport, OAuth profile or deployment runtime.

See [`../../docs/mcp-adapter.md`](../../docs/mcp-adapter.md) before extending implementation.

Do not add a local domain model, permission database, copied Model Registry or direct D1 access here.
