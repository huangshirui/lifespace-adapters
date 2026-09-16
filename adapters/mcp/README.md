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
one Agent-friendly MCP Query Tool per model + execution binding
        ↓
compile simple Agent arguments to LifeSpace Canonical Query
        ↓
POST /api/v1/spaces/{spaceId}/models/{modelKey}/records/query
```

Files:

- `src/progressive-discovery.mjs` loads compact inventory plus only selected semantic details and fails closed when `key/version/schemaHash` drift;
- `src/projection.mjs` projects `query.canonical` into one smaller MCP Tool per selected model and builds Canonical Query POST requests;
- `test/projection.test.mjs` proves Progressive Discovery bounds, Agent-friendly Search/filters/Sort/Pagination, optional `advancedFilter`, range forwarding and Space isolation;
- `test/projection-fail-closed.test.mjs` proves unsupported or stale semantics are rejected.

The default Query Tool surface is:

```text
spaceId
search?
filters[]?        simple typed predicates; AND by default
sort[]?
limit?
cursor?
advancedFilter?  nested Canonical Boolean AST only when needed
```

`filters[]` and `advancedFilter` are mutually exclusive. Both compile into the same LifeSpace-owned Canonical Filter semantics; there is no MCP Standard Query / Capability Query mode.

The adapter must:

- derive visible MCP capabilities from current LifeSpace Runtime Discovery（运行时发现）;
- preserve Space Context（空间上下文）;
- execute only through canonical LifeSpace operations;
- preserve Principal / Actor / Application Context（权限主体 / 执行者 / 应用上下文） semantics;
- fail closed when LifeSpace contract semantics cannot be represented safely;
- never expose Platform Admin（平台管理） control-plane operations through ordinary Agent discovery.

The projection consumes the current LifeSpace Canonical Query semantic descriptor, including Search + Filter intersection semantics, typed filter targets/operators, ordered Sort and cursor Pagination. Legacy query metadata does not generate a second MCP query surface and is not maintained as a compatibility mode.

It deliberately does **not** choose an MCP SDK, HTTP transport, OAuth profile or deployment runtime.

See [`../../docs/mcp-adapter.md`](../../docs/mcp-adapter.md) before extending implementation.

Do not add a local domain model, permission database, copied Model Registry or direct D1 access here.