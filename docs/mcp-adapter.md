# MCP Adapter（MCP 适配器）

## Goal（目标）

The MCP Adapter projects the current LifeSpace capability surface into MCP without becoming a source of LifeSpace domain or authorization truth.

> **MCP `tools/list` reflects the current LifeSpace-effective projection, and MCP `tools/call` executes only through canonical LifeSpace operations.**

## Current implementation status（当前实现状态）

The verified implementation slice is a deployment-independent **Canonical Query Projection Core**. It does not yet provide an MCP Server, HTTP transport, OAuth integration or deployment package.

```text
MCP-facing adapter layer
        │
        ├── GET /api/v1/me/_discovery/inventory
        ├── GET /api/v1/spaces/{spaceId}/_discovery/models/{modelKey}
        ├── one deterministic MCP query Tool per selected model
        └── POST /api/v1/spaces/{spaceId}/models/{modelKey}/records/query
```

The adapter consumes the current Canonical Query semantic descriptor, including the composition rule that Search and Filter jointly constrain the candidate set before Sort and cursor Pagination. The code remains independent from a concrete MCP SDK.

## Progressive Discovery mapping（渐进式发现映射）

The adapter loads the compact current-principal inventory, selects relevant model keys, and fetches semantic detail only for those models through the inventory-published path template.

It must:

- preserve readable Space Context from inventory;
- verify semantic detail `(key, version, schemaHash)` against the inventory snapshot and fail closed on drift;
- keep readable Space IDs as distinct execution targets;
- treat semantic detail as semantics, not durable authorization evidence;
- avoid eager relation target lookup or reference resolution.

Full `/api/v1/me/_discovery` and Space-scoped discovery remain compatibility/fallback inputs. Tool ranking/top-K may narrow what is shown but cannot broaden LifeSpace authority.

## Canonical Query Tool projection（统一查询工具投影）

For every selected readable model, the Projection Core emits exactly one `lifespace.query.{modelKey}` Tool. The default Tool schema is intentionally **Agent-friendly rather than a verbatim copy of Core's full recursive Filter AST**.

Default arguments are:

```text
spaceId
search?           keyword string
filters[]?        high-frequency typed predicates, combined with AND
sort[]?           ordered sort criteria
limit?            bounded page size
cursor?           opaque continuation cursor
advancedFilter?   optional nested Canonical Filter AST for complex Boolean logic
```

Rules:

- `search` is emitted only when searchable fields are published;
- every entry in `filters[]` is descriptor-backed and exposes only a published field/operator/value shape;
- multiple `filters[]` entries compile to one Canonical `and` group;
- `filters[]` and `advancedFilter` are mutually exclusive;
- `advancedFilter` exists only for queries that genuinely need nested AND/OR logic;
- local-date-window, date-range and instant-range operands are passed through unchanged;
- `sort[]` preserves caller order and published field/direction restrictions;
- `limit` and `cursor` compile into the Canonical `page` object;
- `spaceId` is restricted to the readable Spaces captured by the projection binding.

This keeps simple Agent calls small while preserving full Canonical Query expressiveness when needed. It does not create a second query language: both the simple surface and `advancedFilter` deterministically lower to the same Core Canonical Query.

Legacy `query.filters`, `query.comparisons`, and `query.capabilityQueries` do not generate parallel MCP tools and are not compatibility requirements for this adapter.

## Execution mapping（执行映射）

A simple Agent call such as:

```json
{
  "spaceId": "spc_example",
  "search": "renew",
  "filters": [
    { "field": "status", "operator": "eq", "value": "open" }
  ],
  "sort": [
    { "field": "createdAt", "direction": "desc" }
  ],
  "limit": 25
}
```

is lowered to:

```text
POST /api/v1/spaces/{spaceId}/models/{modelKey}/records/query
Content-Type: application/json

{
  search: { text: "renew" },
  filter: { field: "status", op: "eq", value: "open" },
  sort: [{ field: "createdAt", direction: "desc" }],
  page: { limit: 25 }
}
```

When several simple filters are supplied, the adapter emits `{ and: [...] }`. When `advancedFilter` is supplied, it validates and forwards that Canonical Boolean expression as `filter` instead.

A cached Tool can still be denied by LifeSpace after authority changes. This is correct: execution-time authorization remains authoritative.

## Authorization and credential boundary（授权与凭据边界）

The adapter does not calculate effective permission. LifeSpace remains authoritative for credential scope, Application × Model Access, Space Membership/Data Grant, Agent Delegation, model/capability restrictions, record Policy and revocation.

The future MCP Server must use credentials for the real execution context. It must not use a permanent platform-admin credential, mint authority locally, accept client-supplied Principal/Grant/Scope as proof, or log/persist reusable bearer credentials without a separately approved secure architecture.

Platform Admin / Console control-plane operations are excluded from ordinary MCP discovery and fallback routing.

## Protocol surface（协议表面）

Projection output is deterministic and MCP-safe:

- deterministic Tool names and ordering;
- object-root JSON Schema 2020-12 `inputSchema`;
- letters, digits, `_`, `-`, and `.` only in Tool names;
- no dependence on a transport session;
- no Standard Query / Capability Query mode exposed to the Agent.

Server lifecycle, actual `tools/list` / `tools/call` handlers, OAuth, cache hints, result envelopes and deployment remain future work.

## Verification（验证）

Synthetic tests prove:

1. Progressive Discovery loads only selected semantic detail and detects identity drift;
2. every model emits one Canonical Query Tool even when legacy capability metadata remains;
3. the default Agent surface uses simple Search / flat typed filters / Sort / limit / cursor;
4. flat filters deterministically lower to Canonical predicates and AND composition;
5. `advancedFilter` preserves nested Boolean capability without becoming the default schema;
6. Calendar/time-range targets require no model-specific source branch;
7. execution produces the canonical POST path and structured body;
8. local-date windows pass through unchanged for Core-owned DST conversion;
9. unknown Space, field, operator, argument, invocation, composition or range shape fails closed;
10. filter depth/node, sort and pagination bounds are rechecked at execution mapping.

The next milestone is a real MCP Server / transport binding around this projection core.