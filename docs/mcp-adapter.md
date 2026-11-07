# MCP Adapter（MCP 协议适配器）

## Source of truth / 事实来源

LifeSpace owns global Identity, OAuth authorization, Space, Membership, Data Grant, Agent/Delegation, Application × Model Access, Model Policy, and current effective authority. This repository only adapts **verified LifeSpace contracts** into MCP transport and tool schemas.

> `tools/list` may expose only the live Core-provided authorized capability projection; `tools/call` must execute through authoritative Core operations with renewed authorization. A cached Tool or valid OAuth token is **not** runtime authority.

## Current implementation / 当前实现

Two complementary, independently tested components exist:

1. **Identity OAuth Protected Resource Server candidate:** `adapters/mcp/src/identity-oauth-worker.mjs`, with RFC 9728 metadata, exact-resource OAuth bearer introspection and minimum MCP transport handshake. **Candidate** `tools/list` and `tools/call` now use an Identity-issued direct Agent read-only Core token. No live data tools are deployed; there is no deployment trigger.
2. **Canonical Query Projection Core:** `src/progressive-discovery.mjs` and `src/projection.mjs`. Pure transforms tested against synthetic, LifeSpace-compatible Progressive Runtime Discovery and Canonical Query descriptors. They are not yet connected to an OAuth-authenticated Core execution bridge.

The Cloudflare Managed OAuth Preview experiment and its Worker runtime/deployment configuration are **retired**. There is no Legacy Preview fallback and no independent Access JWT exchange in this Resource Server.

## OAuth and Agent execution boundary / OAuth 与 Agent 执行边界

```text
External MCP Client
  → LifeSpace Identity OAuth Authorization Server (PKCE S256)
  → Account Consent (Application → Space → Agent → execution mode)
  → MCP Resource Server: lsp_oat_* and exact Resource
      → private Identity /oauth/introspect (current token status)
      → Identity /oauth/execution-tokens: signed <=60-second Agent Direct Core JWT
      → Core rechecks via /introspection/v1/oauth-executions every request
      → Core current Discovery / canonical query with real actor attribution
```

The public OAuth bearer must never be forwarded as a LifeSpace Core JWT. The Client-selected User ID is the **authorization owner**, not the executor. An OAuth claim that the Client may request User Delegation is not a Delegation grant. Core/Identity must establish the actual Agent Principal, Actor, Application, Space and, if user-represented, an explicit authorized Delegation. The MCP adapter cannot fabricate these.

**Candidate fail-closed status:** `initialize` and `ping` require current OAuth introspection. `tools/list` and `tools/call` are implemented using a private same-environment Identity/Core bridge, signed read-only Agent Direct token, single selected Space and fresh Core permission checks. They return 503 when bindings/bridge/projection are missing or inconsistent; unauthorized OAuth/Space/model operations are denied. This is **synthetically tested but not deployed**.

The new Resource Server requires (in separately protected deployment configuration, never this public repository):
- canonical multi-Server `MCP_RESOURCE_ORIGIN` (an exact trusted Core HTTPS origin, no trailing path); the private Adapter derives the current `/mcp/{mcp_*}` Resource from the forwarded request; or fixed `MCP_RESOURCE_URI` only for an isolated single-resource synthetic test;
- exact `MCP_OAUTH_ISSUER`;
- private `IDENTITY` Service Binding to same-environment LifeSpace Identity;
- private `OAUTH_RESOURCE_SERVER_SECRET` shared only with same-environment Identity for introspection and read-only execution exchange;
- private `CORE` Service Binding to same-environment Core, which revalidates authorization with Identity on every execution request.

Neither core read/write access nor a server-level Client Scope is inferred from those settings.

## Progressive Runtime Discovery / 渐进式发现

Core owns the current visibility and permission intersection. The adapter uses:

```text
GET /api/v1/me/_discovery/inventory
  → visible (Space, model) entries
  → select compatible current models
GET /api/v1/spaces/{spaceId}/_discovery/models/{modelKey}
  → verify model identity, version and schemaHash
  → project query.canonical
```

A stale inventory or model detail may only narrow, never broaden, what is exposed. Visibility is checked again at query time through Core.

## Canonical Query mapping / 统一查询

For each published, readable model, the pure projection emits one `lifespace.query.{modelKey}` tool (or one per independently scoped External binding). Default MCP input:

```text
spaceId
search?
filters[]?       flat typed AND filters
sort[]?
limit?
cursor?
advancedFilter?  optional nested Boolean expression
```

`search` and `filter` constrain the candidate set by intersection before Sort and cursor Pagination. `filters[]` and `advancedFilter` cannot be supplied together. Typed dates/ranges are forwarded for Core-owned time and DST semantics. Only descriptor-published fields/operators/sort/pagination and a readable Space are allowed.

The projected invocation uses:

```text
POST /api/v1/spaces/{spaceId}/models/{modelKey}/records/query
```

Record Policies, current Grants, Delegation state, semantic validation and concurrency remain Core responsibilities. This layer never caches private records or recomputes authority.

## Core query errors / Core 查询错误映射

For a `tools/call` to the authorized Canonical Query endpoint, Core HTTP 400 or 422
maps to an MCP tool `isError` result with the stable, sanitized
`INVALID_QUERY_ARGUMENTS` code. This indicates invalid filter/cursor/query
parameters, **not** a Core outage. The Adapter never forwards raw Core error
bodies, since upstream details may contain private data.

Core HTTP 401/403 remains `CORE_PERMISSION_DENIED`; network failures, 5xx,
and other unclassified Core response statuses remain `CORE_UNAVAILABLE`.
Failures while obtaining Core discovery are not client query validation errors:
they still fail closed with HTTP 503. Core retains semantic validation and
authorization ownership; this only changes protocol-specific error mapping.

## Prohibited surfaces / 禁止暴露

Ordinary MCP tools must not expose Core/Identity Platform Admin endpoints, direct D1 queries, provider secrets, unscoped service credentials or cross-Space data. A different Console administrative MCP profile would require a separate design, credential and policy approval.

## Required verification / 必要验收

Synthetic tests cover OAuth bearer/resource/scope rejection; current-state private introspection; expired/revoked tokens; wrong client/application/Space/Agent; no Core access when the bridge is absent; model-key/schema drift; typed query projection; invalid fields and Space isolation.

Still required before enabling **live** data tools: merge and staging deployment of LifeSpace's current-state Agent Direct execution bridge, exact OAuth Resource allowlisting, dedicated private service bindings/secrets, protected MCP Staging deployment, authorized OAuth Client registration, real Core discovery/query and revocation/cross-Space/delegation negative tests. **A passing CI or OAuth metadata document is not evidence of working MCP data access.**

For current operator and implementation boundaries, see [MCP README](../adapters/mcp/README.md).


## Server-specific OAuth Resource path / 按 MCP Server 的资源路径

The canonical Resource identifier is an exact HTTPS URL ending in
`/mcp/{serverId}` where `serverId` is the Core-issued `mcp_*` 32-hex ID.
The RFC 9728 Resource metadata document is available at
`/.well-known/oauth-protected-resource/mcp/{serverId}` on that same origin.
Requests for other Server IDs, a token for another Resource, or the retired
unscoped `/mcp` Resource fail closed. The OAuth Resource Server's one-resource
packaging does **not** create Core MCP Server governance by itself: LifeSpace
Core must still check the current enabled Server's selected model operations,
Agent/Space/Data Grants and Model Policy on every request (Issue #482).
This is a candidate, not a deployed multi-Server runtime; the public Adapter
repository contains only synthetic hostnames and no live infrastructure secrets.


## Modern MCP and legacy compatibility

The MCP Resource transport supports both `2026-07-28` stateless per-request metadata and `2025-11-25` legacy handshake. Modern `server/discover`, `MCP-Protocol-Version`/`Mcp-Method`/`Mcp-Name` validation, HeaderMismatch and UnsupportedProtocolVersion errors are tested using synthetic requests. Neither protocol version changes LifeSpace Principal/Actor/Delegation: current read-only Agent Direct authority continues to be verified by Core. Protocol interoperability in live ChatGPT/Claude clients and Identity client registration are still pending Staging acceptance. 
