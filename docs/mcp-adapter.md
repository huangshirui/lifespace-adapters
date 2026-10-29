# MCP Adapter（MCP 适配器）

## Goal（目标）

The MCP Adapter projects the current LifeSpace capability surface into MCP without becoming a source of LifeSpace domain or authorization truth.

> **MCP `tools/list` reflects the current LifeSpace-effective projection, and MCP `tools/call` executes only through canonical LifeSpace operations.**

## Current implementation status（当前实现状态）

The verified initial implementation is a **Canonical Query Projection Core**. Subsequent read-only work adds virtual domain projection, general capability discovery and an SDK v2 Stateless Streamable HTTP handler requiring a caller-bound authorizer. **Interactive OAuth, the trusted LifeSpace execution context bridge, a deployable Worker entrypoint and staging are still not implemented.**

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

## Hybrid Virtual MCP Domains（混合式逻辑 MCP 领域）

**Design: approved; pure V1 domain query projection implemented, HTTP/OAuth still pending.**

One eventual public MCP Worker may expose a general `/mcp` endpoint and dedicated `/mcp/calendar`, `/mcp/tasks` endpoints. These paths name logical protocol surfaces, not separate LifeSpace applications, Space identities, D1 databases or grants. The first code slice implements `resolveMcpEndpoint`, `selectDomainInventory` and `projectDomainQuerySurface`; it deliberately does **not** claim to implement the HTTP handler, OAuth, or a usable ChatGPT plugin.

- **Domain Profiles belong to this MCP adapter**, as protocol-specific display narrowing. The V1 profiles are `calendar` (matches an already-declared `calendar` capability) and `tasks` (matches the published `task` model key). Additional domains are candidates, not registered working endpoints.
- **Domain classification is not authorization.** Every candidate must already be in the current authenticated `/api/v1/me/_discovery/inventory`, with a readable Space edge. `tools/call` must still revalidate authority with LifeSpace Core. There are no `calendar:read`/`tasks:read` LifeSpace permission scopes; continue using existing `resources:read/write/manage` as applicable.
- **Route identity is stable.** Domain selection is by exact path (`/mcp/calendar`, `/mcp/tasks`), not arbitrary query parameters or caller-asserted domain headers. A future Worker must reject unknown paths and verify OAuth Token resource/audience for the exact protected resource; multiple routes may share an authorization server.
- **Queries only in V1.** Read permission and `query.canonical` are required. Writes, actions, Kernel Person Directory, control plane and unmanaged model operations are not projected. General `/mcp` is reserved for an eventual minimal capability-search/query entry point, **not** a wildcard that emits all models.
- **Progressive narrowing only.** First filter the already-authorization-pruned coarse inventory; fetch semantic details only for selected models, retaining the existing key/version/schemaHash drift checks, then call the existing `projectSelectedModelsToMcp` implementation. No parallel field semantics, time conversion or permission evaluator is introduced.
- **External models are Space-specific.** An External `modelKey` can have different schema hashes in two Spaces; the existing projection gives it a Space-qualified tool. If Native and External inventories reuse one selected model key, this V1 selection explicitly fails closed instead of mixing their execution edges. A future fine-grained identifier-based loader may remove that compatibility limit after explicit contract tests.
- **Clients and cache.** MCP servers do not observe the user's current chat question at `tools/list`; available domain tools can depend on URL and authenticated inventory, not the last tool invocation. Clients may cache metadata. For unsupported clients, the general endpoint will eventually use a small, stable discovery surface, never a claimed implicit `tools/list` mutation.

The current implementation is protocol/transport independent. Next milestone: authenticated MCP SDK v2 Stateless Streamable HTTP with OAuth approval and end-to-end deny/revocation tests before any public Worker deployment.

## Protocol surface（协议表面）

Projection output is deterministic and MCP-safe:

- deterministic Tool names and ordering;
- object-root JSON Schema 2020-12 `inputSchema`;
- letters, digits, `_`, `-`, and `.` only in Tool names;
- no dependence on a transport session;
- no Standard Query / Capability Query mode exposed to the Agent.

The read-only SDK v2 HTTP handler now implements `tools/list` and `tools/call` for authenticated injected contexts, exposes only two general task-scoped tools at `/mcp`, and uses direct Calendar/Tasks query tools on domain endpoints. The handler returns `401` when authorization is absent, rejects cross-Origin requests, denies unknown paths, requires LifeSpace success envelopes, and marks caller-specific responses `Cache-Control: private, no-store`. OAuth validation, deployment, durable credentials, client-identity mapping, resource metadata and end-to-end live contract checks remain future work.

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