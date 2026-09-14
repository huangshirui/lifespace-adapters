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

The projection target is LifeSpace Core Kernel `0.36.0` and the MCP `2026-07-28` Tool schema model. The code remains independent from a concrete MCP SDK.

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

For every selected readable model, the Projection Core emits exactly one `lifespace.query.{modelKey}` Tool. It consumes only the published `query.canonical` descriptor for current query semantics:

- `search` is emitted only when searchable fields are published;
- recursive `filter` supports descriptor-backed AND/OR predicates, typed operators and range operands;
- `sort` preserves ordered field/direction criteria, NULL-last semantics and the stable record-ID tie-breaker;
- `page` carries the bounded limit and opaque cursor;
- `spaceId` is required and restricted to the readable Spaces captured by the binding.

Range operands are forwarded unchanged:

- `local_date_window` carries `startDate`, `endDateExclusive` and IANA `timezone`;
- `date` and `instant` carry half-open `start` / `endExclusive` bounds.

LifeSpace Core alone owns field-type validation, local-date/DST conversion and temporal overlap semantics. The adapter rechecks the projected field/operator/bounds before transport but does not reinterpret them.

Legacy `query.filters`, `query.comparisons`, and `query.capabilityQueries` may remain in Discovery for old clients. They are not consumed by this projection and no separate Generic/Capability MCP query tools are emitted.

## Execution mapping（执行映射）

The execution binding accepts only arguments actually projected for that model and Space, then produces:

```text
POST /api/v1/spaces/{spaceId}/models/{modelKey}/records/query
Content-Type: application/json

{ search?, filter?, sort?, page? }
```

The request builder validates top-level properties, search bounds, nested-filter depth/node bounds, field/operator membership, canonical range shapes, ordered sort criteria, page bounds and readable Space membership. It returns no legacy query string.

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
- no dependence on a transport session.

Server lifecycle, actual `tools/list` / `tools/call` handlers, OAuth, cache hints, result envelopes and deployment remain future work.

## Verification（验证）

Synthetic tests prove:

1. Progressive Discovery loads only selected semantic detail and detects identity drift;
2. every model emits one Canonical Query Tool even when legacy capability metadata remains;
3. Search, Filter, Sort and Pagination derive from `query.canonical`;
4. Calendar/time-range targets require no model-specific source branch;
5. execution produces the canonical POST path and structured body;
6. local-date windows pass through unchanged for Core-owned DST conversion;
7. unknown Space, field, operator, argument, invocation, pipeline or range shape fails closed;
8. filter depth/node and pagination bounds are rechecked at execution mapping.

The next milestone is a real MCP Server / transport binding around this projection core.
