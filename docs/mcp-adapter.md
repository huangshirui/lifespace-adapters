## 2026-11-10 · Authorized MCP model Resources / 受控模型资源（Candidate）

The MCP Adapter may expose **one read-only semantic Resource per currently visible model** using the already-authorized Core Generic Operation Projection. `resources/list` derives stable URI `lifespace://spaces/{spaceId}/models/{modelKey}` only from Core-returned, currently enabled operations. `resources/read` accepts only one exact listed URI, exchanges OAuth for the current Core Agent token, and reads `GET /api/v1/spaces/{spaceId}/_discovery/models/{modelKey}` from Core. The adapter never invents Model Definitions, record fields, permissions or independent ACL/registry truth. A Resource URI is **not a capability**, and all stale/foreign/ungranted resources fail closed without querying another Space. Core 401/403/404 become MCP Invalid Params (`-32602`) with a non-revealing error; invalid response shapes and unavailable Core fail closed. Resource listing and reads include per-authorization `ttlMs:0, cacheScope:"private"` for 2026-07-28, while supporting legacy 2025-11-25 responses.

The advertised Resources are **model semantic descriptors, not individual private business records** and not live update subscriptions. No `resources/subscribe` or `subscriptions/listen` is advertised until Core Eventing can provide an authenticated, authorization-checked event feed. Future record URI maps, dynamic Provider records, notification projection and lifecycle require their own Core-owned Resource/Event contract. Legacy `tools/list` and `tools/call` are unchanged.

**Status:** Adapter candidate; only synthetic tests until CI and owner-triggered Staging deployment. Do not claim Production availability.

## 2026-11-10 · Core-backed MCP structured results and safe error mapping / 结构化输出与错误语义

**Adapter-only, no new Domain truth.** On successful Core ordinary-operation or User Delegation Tool execution, MCP includes both the original `content:[{type:"text",text:JSON.stringify(value)}]` and `structuredContent` directly based on Core's validated response. Object results are emitted unchanged; array, scalar and null results are wrapped as `{data: value}` for compatibility with MCP 2025-11-25 (which restricts structuredContent to objects) while also remaining valid for MCP 2026-07-28. This is a protocol projection, not a second Core result DTO. Failed business execution returns `isError:true` with bounded text and **no** structuredContent.

Do **not** add invented model-specific `outputSchema` or claim full typed-output-contract support: Core's current Generic Operation Catalog 0.2 owns `inputSchema` and `requiredScopes`, but does not yet define an `outputSchema` for each operation. If an exact typed `outputSchema` becomes necessary, add the canonical output descriptor to the Core-owned operation contract with schema/version tests first, then let the MCP Adapter project it without deriving it from runtime samples.

The Adapter maps Core status 404 → `CORE_NOT_FOUND`, 409 → `RECORD_VERSION_CONFLICT`, 429 → `CORE_RATE_LIMITED`, 401/403 → `CORE_PERMISSION_DENIED`, and 5xx/upstream transport failures → `CORE_UNAVAILABLE`. Existing validation mapping for canonical operation input is preserved. Core private error bodies and sensitive identifiers are never copied into MCP errors; 404 can intentionally conceal authorization and therefore conveys no stronger existence claim. An Agent does not get additional Authority from any error mapping.

**Release status:** candidate branch only until CI merges. Real Staging deployment and client read/get/deleted-record test still required; no Production claim.

## 2026-11-09 · MCP URL Elicitation / MRTR for third-party Account Delegation / 授权后继续

For the MCP **2026-07-28** stateless transport, when a client explicitly declares `_meta["io.modelcontextprotocol/clientCapabilities"].elicitation.url`, the existing `lifespace.request_user_delegation` tool may emit the standard `resultType: "input_required"` `InputRequiredResult`. It contains an `inputRequests.lifespace_account_approval` URL-mode `elicitation/create` to the trusted HTTPS LifeSpace Account approval page, and an opaque, short-lived HMAC-authenticated `requestState`. The client can let the user complete the out-of-band approval and **retry the same tool call** with `requestState` and `inputResponses`. The Adapter re-introspects the exact resource OAuth token, checks the signed state against the authorization/user/client/application/space/agent/resource and original operation/reason, then reads the current Core-owned approval status. Only Core `approved` with a current valid `dlg_*` is returned; a client `action:"accept"` alone never approves anything. This is only permission to proceed to `lifespace.execute_user_delegation`, whose existing runtime check and one-use/timed/until-revoked semantics do not change. No arbitrary client callback URL, automatic browser redirect into ChatGPT, or long-held HTTP stream is created.

The browser does not directly wake a ChatGPT conversation. **Automatic continuation is client-controlled**: clients implementing URL Elicitation and MRTR may resume the tool call; clients that decline/cancel or do not implement the capability use the existing approval link, `lifespace.user_delegation_status`, and `lifespace.execute_user_delegation` tools. This is independent of MCP OAuth Scope upgrades: URL Elicitation authorizes a LifeSpace **User→Agent Delegation**, never replaces initial MCP Client→Server OAuth. The shared Account session/CSRF, Core authority binding and Change audit remain authoritative. Requests with missing/tampered/expired `requestState`, altered intent or different OAuth actor/client fail closed. Clients must not be misled into assuming that clicking the URL is proof the user approved.

The MCP **2025-11-25** tool path remains a compatible approval-link workflow; the 2026 stateless MRTR payload must not be sent to a 2025 or form-only client. 2025 URL completion notifications are optional and not fabricated without an authenticated client-specific delivery channel. A test passing synthetic MRTR is not evidence that any specific ChatGPT/Claude/Codex UI actually implements auto-resume; verify per-client behavior after an owner-reviewed Staging Adapter deployment.

## 2026-11-09 · Protocol-neutral OAuth Scope-aware Tool discovery (Core 0.2 Candidate)

Core's generic Operation Projection now separates **discoverable** current Agent capabilities from **executable** current token permissions. A read-only OAuth token may discover an operation requiring `resources:write` only when Core independently verifies that the same Agent, Application, Space Grant and currently enabled Server configuration permit it. No Agent Grant means no Tool, even if a client requests the broadest OAuth Scope. Core emits `requiredScopes`; this Adapter must consume the exact field, fail closed for missing/invalid field, and never duplicate model/Person/External/Action access interpretation. Read-authorized Action scopes come from Core, not a blanket assumption that all Actions are writes.

A client attempting a visible write with a read-only token receives **HTTP 403** with `WWW-Authenticate: Bearer error="insufficient_scope", scope="resources:read resources:write", resource_metadata="..."`, plus `_meta["mcp/www_authenticate"]` in the MCP result for tool-level linking clients. The HTTP challenge is the **portable MCP/OAuth path**, while tool metadata is a supplementary compatibility hint. The client, not LifeSpace, chooses whether to request Scope upgrade; Identity/Account never silently expand existing read-only authorization, and the unchanged Core canonical executor always rechecks actual token Scope and all Data Grants. No production behavior is asserted.

**Rollout:** deploy paired Core/Identity Staging release first, then the new private Adapter; the old Adapter tolerates the added contract field, whereas the new Adapter requires it. Refresh the MCP client's cached `tools/list` separately from OAuth; verify revoked/expired token, read-only direct write rejection, write Scope consent, write action, Person and External permissions, cross-Space/Server rejection, and Account Delegation independently. Work mode or any supported MCP client can be used for acceptance, not as the contract owner.

## 2026-11-09 · OAuth Scope hints and write step-up / 授权范围提示与升级

Core's enabled MCP Server configuration defines the possible OAuth Scope ceiling, while the external OAuth client independently chooses which scopes it actually requests. Identity's default for an omitted OAuth `scope` parameter is deliberately read-only; Account consent never secretly expands a read-only token into a write token. Clients or plans that support only read/fetch cannot be made write-capable by changing a LifeSpace Grant or by skipping the OAuth boundary.

The MCP Adapter now projects `securitySchemes` (and compatibility `_meta.securitySchemes`) for every currently authorized Core operation: Query/Get require `resources:read`; Create/Update/Delete/Actions require `resources:read resources:write`. Delegation tools advertise their baseline read scope because their operation is dynamic; when an approved-Delegation request/execution actually needs write and the client carries only read, the Adapter emits the MCP `mcp/www_authenticate` `insufficient_scope` challenge for an explicitly user-approved OAuth upgrade, **only if Core's Server configuration offers write**. This is not a write authorization itself; Identity, Core, Model Access, Grants, User approval and policy must all authorize execution.

Read-only clients keep querying; write-capable clients can request a scope upgrade. A client that freezes a previously scanned tool catalog must refresh its own tool definitions independently of refreshing an OAuth token. / 只读客户端仍可查询；支持写入的客户端必须明确重新申请写 Scope；旧工具快照需由客户端刷新，并不会随着 OAuth 重连自动同步。

## 2026-11-09 · Account-selected third-party Delegation lifetimes (pending Core #505)

The new Account second-stage approval UI is an **independent human authority decision**, not a parameter the MCP Agent can supply. With [LifeSpace Core/Account PR #505](https://github.com/huangshirui/LifeSpace/pull/505), an approved exact `modelKey + operation` Delegation may be once (default, 30 minutes), bounded repeated use (1h / 24h / 7d), or indefinite until the User revokes it. Core alone applies the lifetime, current OAuth/Space/Model/Policy and revocation. The Adapter reuses the same `request_user_delegation` → `user_delegation_status` → `execute_user_delegation` transport, with no new lifetime fields exposed to or accepted from the third-party client. One-use External Provider writes still consume the one attempt before Provider I/O. The Account `/delegations` page provides user-owned revocation.

**State:** paired documentation semantics only; Core #505 and this Adapter companion must pass CI, be merged, and receive staging deployment/real E2E before any claim of third-party availability. Older one-use-only notes below are historical.

# MCP Adapter（MCP 协议适配器）
## 2026-11-09 · Person third-party Account-link Delegation / Person 网页授权（待 CI 验收）

The public Person directory appears as `modelKey:person`, with the same public `lifespace.request_user_delegation`, `lifespace.user_delegation_status`, `lifespace.execute_user_delegation` flow as Native, bounded by the currently enabled MCP Server `person_directory` operation subset and independent Core Person Grant. The Adapter only handles the explicitly documented Kernel Person route transport: `query` maps to `GET /people?q=&limit=&cursor=`; `get/create/update/delete` map to the corresponding `/people[/per_*]` routes. It does not issue a broader Space Delegation, validate Person/linked-User business rules, or determine which Person operations are authorized.

Core owns the signed represented User/Agent, Account-approved narrow `model:person_directory` Delegation, live user grant and single-use Person Change. A Person `per_*` is a business Record reference, not a `rec_*` Native record or a LifeSpace User identity.

General Core supports single-use, time-bounded recurring, and long-lived revocable Delegations, but the untrusted third-party Account confirmation flow **currently offers one use only**. n8n-as-framework does not imply a trusted application; existing ALOHA/verified WeCom trusted confirmation UX is unchanged.

**Status:** paired candidate source only; no deployment and no real third-party browser E2E proven.

## 2026-11-08 · Core unified operation catalog / Core 统一操作投影（Candidate）

LifeSpace Core is the only owner of Model/Record/Operation semantics, including current configuration and effective authority. A third-party Agent must see the **same generic model tool family** whether Core internally resolves Native Runtime, Kernel Person Directory or a Space-bound External Provider. The MCP Adapter must not branch on `origin: external`, `person_directory`, `per_*`, Provider keys, database tables, credentials or dynamic/static storage.

- `GET /api/v1/spaces/{spaceId}/_discovery/operations`: returns only the current OAuth Agent-authorized Core operation descriptors, including opaque `operationRef`, normal `modelKey`, `operation`, `inputSchema` and human-readable title/description. No storage class or Provider details.
- `POST /api/v1/spaces/{spaceId}/_operations/{operationRef}/invoke`: sends generic `{arguments}` using the signed, short-lived Core execution JWT; Core resolves the operation, checks current configuration and authority again, then runs its established Kernel/Runtime/Provider authorization/validation/Change implementation.
- Adapter deterministically projects `lifespace.<operation>.<modelKey>` and `lifespace.action.<modelKey>.<actionKey>` regardless of internal execution kind; no Person-specific or External-specific Adapter modules. `operationRef` is never a bearer credential or delegated permission.
- External capabilities, Person linked-user restrictions, immutable Native `mct_*`, and provider schema evolution are **Core-internal**. Input schema is supplied by Core and may evolve; no version schema is fabricated for External.
- Third-party Account web confirmation and original in-app/trusted-WeCom Delegation confirmation remain distinct UX, with the same Core authoritative arq_*/dlg_* facts.

**Status:** paired [LifeSpace PR #501](https://github.com/huangshirui/LifeSpace/pull/501) and [Adapters PR #39](https://github.com/huangshirui/lifespace-adapters/pull/39) are DRAFT, not deployed or real OAuth E2E accepted. Previous Native-only staging acceptance belongs to the prior release and cannot be cited as this generic operation layer's acceptance.


## 2026-11-08 · Third-party Agent Delegation confirmation (under acceptance)

The OAuth MCP Resource Server has three additional **opt-in-gated** tools:
- `lifespace.request_user_delegation` — requests one exact current Native Model operation on behalf of the OAuth consenting User; receives a LifeSpace Account URL for the User to open and explicitly approve/deny. No authority is returned on creation.
- `lifespace.user_delegation_status` — polls the current pending/approved/denied/expired `arq_*` state; returns a `dlg_*` selector only after Account approval.
- `lifespace.execute_user_delegation` — requires that precise approved `dlg_*`, exact model operation and canonical Core payload; Resource Server asks Identity for a short-lived represented User/Agent JWT and passes the ID as an explicit Core selector. The adapter **does not** treat the URL or Delegation ID as bearer auth.

The web approval step is owned by LifeSpace Account and authenticated independently of the third-party Agent; existing in-app/self-built Agent confirmation and trusted WeCom Router chat confirmation are unchanged. OAuth consent read/write and `allow_user_authorization` are not equivalent to Delegation. The authoritative Principal/Actor/Delegation checks, successful-change atomic single-use consumption and audit all remain in Core.

The new URL/Approval/Execution path is **not production-deployed or real Staging E2E accepted**; the adapter candidate must be deployed only after its paired reviewed LifeSpace Core/Identity/Account candidate, with precise Scope and private Service Bindings. See private platform release record. Historical Staging-only sections below describe development evolution, not current environment-specific authority.


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

## Production-governed OAuth Scope discovery / 正式 OAuth 权限申请

The selected **current enabled Core MCP Server** owns the Resource-level
capability ceiling. Core reads its currently configured operations and privately
overwrites the adapter-bound `x-lifespace-mcp-scope-ceiling` header. This
advisory metadata drives RFC 9728 `scopes_supported` and the initial
`WWW-Authenticate` Scope. The private Adapter defaults to **read only**
when the header is missing/invalid; it does not infer scopes from Staging versus
Production. The public client cannot create Authority by supplying this header.

At `/oauth/authorize` and human confirmation, Identity independently
revalidates the exact currently enabled Core MCP Resource's allowed scopes.
The Client's actual requested Scope is an upper bound (never expanded);
Identity mints no write execution authority without both the active consent
and live OAuth Access Token. Core always intersects authorized credentials,
Application × Model Access, Agent Data Grant, exact Server operation, Policy
and optimistic concurrency, in **every environment**.

This enables the same code to be production-ready without deploying any
public Production OAuth MCP service binding or silently broadening the
existing read-only authorizations. Production provisioning and live E2E need
separate owner-reviewed release gates. Current draft now implements Native Query, Get and Create/Update/Delete with
exact Core per-Server operation gating; Actions, Person Directory and External
Model tool coverage still require separate implementation
before the full configured Server surface is considered production complete.
User Delegation remains an independent, explicitly consented `arq_*` →
`dlg_*` flow and is not provided by broad OAuth Scope.

## Staging Native write candidate / Staging 原生模型写入候选

This development slice adds `lifespace.create.<model>`, `lifespace.update.<model>`
and `lifespace.delete.<model>` **only when** `ENVIRONMENT=staging`, OAuth consent
contains both read and write, Core advertises current read/write access, and Core
returns `detail.mutations` with exact `mct_*`/Model version/hash evidence. Existing
read-only clients and Production keep Query only. Core must be deployed with the
new bounded Native write bridge first; then deploy this reviewed Adapter through
the existing owner-only Staging release workflow. No runtime is deployed by CI.

Tool arguments are `spaceId`, `data` (canonical Create/Update/Delete JSON Schema),
and `recordId` for update/delete. `data.version` is mandatory for update/delete;
Core remains the sole semantic validator and enforces Policy, current Grants,
current OAuth scope, exact selected Space/Server operation, version and audit.
The Adapter copies a closed local `$defs` subset from Core's immutable contract,
never handwrites domain fields, infers authority or accepts identity overrides.
Schema/version/hash mismatch and unresolved refs fail closed. On each tool call,
Core projection is reloaded so cached tools cannot retain revoked authority.

Core 400/422 becomes `INVALID_MUTATION_ARGUMENTS`, 409 becomes
`RECORD_VERSION_CONFLICT`, 401/403 becomes `CORE_PERMISSION_DENIED`; raw Core
error details are not forwarded. Successful Delete 204 yields `{deleted:true}`.
No External write, batch mutation, Action, admin surface or implicit User Delegation
is added. `allow_user_authorization` is eligibility, **not** delegated authority.
Real Staging CRUD/rollback/revocation acceptance must follow deployment; local tests
alone do not establish that the live write chain is available.


## Targeted operation discovery (candidate)

Core Generic Operation Projection 0.3.0 adds optional exact modelKey and operation filters to the existing current-authority catalog. The Adapter parses its own deterministic MCP tool names into these transport selectors, never derives opaque Core operationRef values or decides authority. tools/list and resources/list retain complete live discovery; tools/call requests only the exact operation and resources/read only the named model, then the existing canonical operation/semantic endpoint. Delegation status/request/execution uses its existing independently checked Core routes without an unrelated direct-Agent catalog. No cross-request authority or tool cache. A previous Core that ignores filters may return the complete catalog; the Adapter still selects the exact requested binding. Deploy compatible Core first to realize the performance improvement. This is protocol transport optimization, not a new LifeSpace business capability; Core's same generic read contract is sufficient with compatible filtering. Tests use synthetic data only; deployed latency remains unverified.
