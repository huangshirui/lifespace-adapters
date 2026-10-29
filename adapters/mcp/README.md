# MCP Adapter

This directory owns the concrete MCP（Model Context Protocol，模型上下文协议） adapter for LifeSpace.

Current status: **Canonical Query Projection Core implemented and tested; Calendar/Tasks Virtual Domain projection, general task-scoped discovery and authenticated SDK v2 HTTP handler implemented (CI pending); OAuth bridge and deployable Worker entrypoint not implemented yet**.

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
- `src/domain-projection.mjs` resolves stable logical MCP URL paths, narrows Core-authorized inventory to Calendar or Tasks, and invokes the existing Query Projection without creating new authority;
- `src/general-discovery.mjs` supports task-scoped `find_capabilities` and a bound generic query without ever granting authority;
- `src/mcp-http.mjs` uses official MCP SDK v2 Stateless Streamable HTTP, requiring an injected verified credential/execution context, and contains **no anonymous or production-ready Worker entrypoint**;
- `test/mcp-http.test.mjs` tests real `tools/list`/`tools/call`, task-scoped discovery, denied execution, malformed Origin and stale access;
- `test/domain-projection.test.mjs` covers endpoint isolation, read-only pruning, stale schema rejection and Native/External model-key collisions;
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

The Virtual Domain projection is not a new Model Registry, OAuth scope vocabulary, authorization service, or live MCP HTTP endpoint. The chosen **MCP SDK v2 Stateless Streamable HTTP** transport is a request-bound library, not yet a deployable Worker. The next change must implement and test a trusted OAuth/Identity bridge before enabling network access to live LifeSpace data; do not use an `lsa_*` or service-wide credential as a substitute for User→Agent Delegation.

See [`../../docs/mcp-adapter.md`](../../docs/mcp-adapter.md) before extending implementation.

Do not add a local domain model, permission database, copied Model Registry or direct D1 access here.