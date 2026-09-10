# MCP Adapter（MCP 适配器）

## Goal（目标）

The MCP Adapter projects the current LifeSpace capability surface into MCP without turning MCP into a source of LifeSpace domain or authorization truth.

Its invariant is:

> **MCP `tools/list` reflects the current LifeSpace-effective capability projection for the authenticated execution context, and MCP `tools/call` executes only through canonical LifeSpace operations.**

## Current implementation status（当前实现状态）

The first verified implementation slice is a **deployment-independent query Projection Core**. It does not yet provide an MCP Server, HTTP transport, OAuth integration or deployment package.

The implemented flow is:

```text
MCP-facing adapter layer
        │
        ├── compact Progressive Discovery inventory
        │       GET /api/v1/me/_discovery/inventory
        │
        ├── selected model semantic detail
        │       GET /api/v1/spaces/{spaceId}/_discovery/models/{modelKey}
        │
        ├── deterministic MCP Tool inputSchema + binding
        │
        └── canonical LifeSpace query request
                GET /api/v1/spaces/{spaceId}/models/{modelKey}/records
```

The M0 projection target is LifeSpace Core Kernel `0.35.0` and the MCP `2026-07-28` Tool schema model. The code intentionally remains independent from a concrete MCP SDK so transport/runtime selection can happen later without changing the projection semantics.

## Progressive Discovery mapping（渐进式发现映射）

Primary coarse source:

```text
GET /api/v1/me/_discovery/inventory
```

The adapter or owning product selects the models relevant to the current tool surface. For each selected visible model it fetches one static semantic detail body through the inventory-provided `semanticDetailPathTemplate`.

The adapter must:

- preserve Space Context（空间上下文） from inventory;
- fetch semantic detail only for selected models rather than all visible models;
- verify semantic detail `(key, version, schemaHash)` against the inventory snapshot and fail closed on drift;
- keep readable Space IDs as distinct execution targets;
- treat static semantic detail as semantics, not positive authorization evidence;
- avoid relation target lookup/reference resolution until a projected input actually requires it.

Full `/api/v1/me/_discovery` and `/api/v1/spaces/{spaceId}/_discovery` remain compatibility/fallback inputs, not the default MCP discovery path.

Tool selection/ranking/top-K remains Adapter / owning-product context-economy behavior. It may narrow what is shown, but it must not broaden LifeSpace authority.

## Query Tool projection（查询工具投影）

For each selected readable model, the M0 Projection Core emits one Generic Query Tool. Its `inputSchema` is object-root JSON Schema 2020-12 and contains only metadata-backed arguments:

- required `spaceId`, constrained to readable Spaces from inventory;
- `q` when `query.search` exists;
- exact/non-comparable filters from `query.filters`;
- only `transport: "explicit"` comparison arguments from `query.comparisons`;
- envelope `createdAt` / `updatedAt` comparisons when published by LifeSpace;
- datetime local-date-window arguments using the exact published parameter names;
- generic sort and pagination metadata from semantic detail.

The adapter does not reconstruct `field.gte`, `field.lt` or any other REST parameter name. The published parameter is the transport.

Legacy `field`, `fieldFrom` and `fieldTo` comparison aliases remain LifeSpace compatibility syntax and are not emitted into the new MCP Tool surface.

For datetime local-date windows, the three published parameters are modeled with all-or-none JSON Schema dependency. The adapter forwards local dates and IANA timezone; **LifeSpace Core alone converts the local-date window into DST-safe instant boundaries**.

## Capability Query projection（能力查询投影）

Each safely representable entry from `query.capabilityQueries` becomes a separate MCP Tool. `calendar.window` is the first current example.

The Tool projects:

- the capability query's own published parameters and requiredness;
- its standalone semantic sort values;
- shared pagination;
- the same readable `spaceId` set.

The current LifeSpace `capabilityQueries` metadata does not yet declare which generic filters/search facets may be composed with a capability query. Runtime Calendar happens to support some combinations such as `q/status/attendee`, while other generic parameters are invalid on that path. Therefore M0 deliberately **does not guess composability**: the capability Tool is narrowed to its explicitly declared capability parameters, ordering and pagination until LifeSpace publishes a reusable composition contract.

## Execution mapping（执行映射）

For ordinary model queries, `modelKey` is the sole LifeSpace Runtime address:

```text
/api/v1/spaces/{spaceId}/models/{modelKey}/records
```

The Projection Core returns an internal execution binding next to each MCP Tool. The request builder:

- accepts only arguments that were actually projected;
- accepts only Space IDs present in that projected binding;
- preserves repeated generic sort order;
- forwards the exact LifeSpace parameter names;
- performs no permission calculation and no timezone/DST conversion;
- always builds the canonical modelKey-addressed GET request.

A cached/stale Tool can therefore build a request that LifeSpace later denies after authority changes. This is correct: execution-time LifeSpace authorization remains authoritative.

## Authorization boundary（授权边界）

The adapter does not calculate effective permission itself.

LifeSpace discovery and execution remain authoritative for:

- credential scope;
- Application × Model Access;
- Space Membership / Data Grant;
- Agent Delegation;
- Model / Capability restrictions;
- record-level Policy;
- current revocation state.

A stale MCP tool list can contain an operation that later fails after authority changes. Tool visibility is a preview, not durable authority.

## Credential model（凭据模型）

The future MCP Server must operate with credentials corresponding to the real current execution context.

It must not:

- use a permanent platform administrator credential as a shortcut for user actions;
- mint user authority locally;
- accept client-supplied Principal/Grant/Scope values as proof;
- log bearer tokens or delegated execution tokens;
- persist reusable user credentials unless an explicit secure credential architecture is separately approved.

For a User represented by an Agent, current LifeSpace Delegation（委托） semantics and Actor attribution must be preserved.

The M0 Projection Core does not own or persist credentials.

## Platform Admin exclusion（平台管理排除）

Platform Admin / Console control-plane operations are out of scope for the ordinary MCP Adapter.

They must not appear in `tools/list` and must not be callable through generic fallback routing.

## Protocol surface（协议表面）

The current projection output is designed to be consumed by an MCP `2026-07-28` server implementation:

- deterministic Tool names/order;
- object-root JSON Schema 2020-12 `inputSchema`;
- protocol-safe names using letters, digits, `_`, `-` and `.`;
- no reliance on a transport session.

Server-specific concerns such as request routing headers, `tools/list` cache hints, actual `tools/call` result envelopes, HTTP lifecycle, OAuth and optional MCP extensions remain future work and must not be claimed as implemented by M0.

## Confirmation and model behavior（确认与模型行为）

MCP descriptions and model instructions are UX/behavior guidance, not authorization or confirmation enforcement.

If a consuming product such as ALOHA requires explicit confirmation for high-impact actions, that confirmation belongs to the trusted owning product/control layer and/or downstream governed operation, not to a prompt sentence inside this adapter.

## M0 verification（M0 验证）

Synthetic tests prove at least:

1. compact inventory is fetched once and only selected model details are loaded;
2. semantic-detail identity drift fails closed;
3. Space boundaries remain explicit and deterministic;
4. Generic Query Tools expose explicit comparison transport, envelope timestamps and local-date-window semantics from upstream metadata;
5. `calendar.window` becomes a separate generated capability Tool without Task/Event-specific source-code branches;
6. unknown capability metadata and unprojected arguments fail closed;
7. request construction preserves exact published parameter names and repeated sort ordering;
8. local-date-window values are forwarded unchanged rather than converted to UTC by the Adapter.

The next milestone is a real MCP Server / transport binding around this verified projection core. Before that server is considered implemented, broader end-to-end acceptance still needs to cover authenticated contexts, Delegation narrowing, execution-time revocation, mutation/action concurrency and credential handling.
