# LifeSpace MCP Adapter / MCP 协议适配器

## Current status / 当前状态

**LifeSpace Identity OAuth Resource Server candidate — implemented and covered by synthetic tests, not deployed.**

The obsolete Cloudflare Access Managed OAuth Preview architecture has been retired. There is **no legacy authentication compatibility mode, Preview deployment generator, or published Managed OAuth Worker** in this adapter.

The new integration boundary is:

```text
MCP Client
  ├─ Identity OAuth Authorization Server: registration, PKCE, tokens, revocation
  ├─ LifeSpace Account: Application / Space / Agent consent
  └─ MCP Protected Resource Server (this adapter)
       ├─ private, exact-resource Identity token introspection
       └─ short-lived read-only Agent Direct execution → Core (current Grants checked)
```

**Do not confuse OAuth token acceptance with Core data authorization.**
An `lsp_oat_*` OAuth token identifies a currently authorized Client/Application/Space/Agent combination. It does not itself become a Core JWT, a User Principal, or a Delegation. The selected execution mode may permit asking for future User Delegation, but cannot create one.

## Files / 文件说明

- `src/identity-oauth-worker.mjs`: independent MCP OAuth Protected Resource Server with RFC 9728 discovery, exact-resource Bearer introspection, Core Agent Direct read-only query bridge, and modern stateless/legacy MCP protocol handlers.
- `test/identity-oauth-worker.test.mjs`: synthetic positive and deny-path tests for the new Resource Server.
- `wrangler.identity-oauth.jsonc`: **synthetic local/CI dry-run**; no live hostname, Worker name, secret or binding.
- `src/progressive-discovery.mjs`: Core-owned dynamic inventory and selected-model semantic loading, with drift protection.
- `src/projection.mjs`: pure canonical query-to-MCP Tool schema projection and bounded LifeSpace query request builder.
- `test/projection.test.mjs`, `test/projection-fail-closed.test.mjs`, `test/external-discovery.test.mjs`: independent projection/contract validation.

## Currently implemented MCP surface

- `GET /.well-known/oauth-protected-resource` and the Resource-path-specific well-known endpoint return the fixed Identity OAuth Issuer and exact Resource identifier.
- `POST /mcp/{mcp_*}` (one exact Core-issued Server ID) accepts only opaque `lsp_oat_*` bearer credentials and calls private Identity `POST /oauth/introspect` for **the exact requested Resource**. No browser Access JWT or server-only `lsa_*` is accepted as an MCP user credential.
- Legacy `2025-11-25` `initialize`, `ping` and limited notifications remain implemented; modern `2026-07-28` `server/discover`, `tools/list`/`tools/call`, request headers and stateless response metadata are supported and synthetically tested.
- `tools/list` and `tools/call` consume only the **Identity-issued read-only Agent Direct Core token** and project current Core-discovered models in the single Space selected by Consent. Execution is still revalidated by Core. They return **503** if the matching LifeSpace Identity/Core bridge, signatures, bindings or current-scoped discovery are unavailable. Synthetic tests pass, but this code is **not deployed**.

## Deployment boundary / 部署边界

No live environment is configured in source code. A later reviewed staging deployment must set:
- **Canonical multi-Server mode:** `MCP_RESOURCE_ORIGIN` set to the exact Core origin supplied by the LifeSpace deployment (use `https://core.example.test` in synthetic fixtures). It must be a **single exact origin**, without a path, query, wildcard or credentials. The Resource is constructed from each incoming `/mcp/{mcp_*}` path; one private Adapter serves many Core-managed Servers. Do not set `MCP_RESOURCE_URI` in this mode.
- **Isolated test-only single-resource mode:** `MCP_RESOURCE_URI` accepts a fixed canonical `/mcp/{mcp_*}` URL when `MCP_RESOURCE_ORIGIN` is absent; this does **not** implement dynamic Server provisioning.
- `MCP_OAUTH_ISSUER`: exact LifeSpace Identity OAuth Issuer origin.
- `IDENTITY`: private Service Binding to the **same environment's Identity Worker**.
- `OAUTH_RESOURCE_SERVER_SECRET`: dedicated private Resource Server secret matching the Identity secret, supplied through protected deployment configuration only.
- `CORE`: private Service Binding to the **same environment's Core Worker**; no direct public Core origin or OAuth bearer forwarding.

The adapter sends the original public OAuth bearer only to **Identity** for introspection and token exchange. The new Core bearer is Agent Direct with `principal=agent`, `actor=agent`, `resources:read`, selected `spaceId`, `applicationId`, authorization and resource identifiers; User Delegation is not implied. Core independently checks every call with Identity and reevaluates current model/Data Grant authority.

The implemented Core execution bridge performs current authorization checks and prevents access outside the specifically authorized Space. Neither this adapter nor an OAuth client can declare User/Agent/Delegation authority by itself.

Only after LifeSpace PRs #480 → #485 and Adapters PRs #29 → #30 are separately staged with protected Resource/secret bindings, Core dynamic per-Server authorization, approved OAuth clients, real Core Query and revocation/cross-Space negative tests may Data Tools be called **live-ready**.

**Never deploy the retired Managed OAuth Preview or reuse its Worker/Access resources.** This repository has no ordinary CI environment deployment; CI performs synthetic tests and a Wrangler dry-run only.

See [the adapter design](../../docs/mcp-adapter.md) and [canonical LifeSpace contracts](../../docs/lifespace-contract-consumption.md).


**Public ingress ownership:** the `core[-staging].aisr.online` Core Worker is the public endpoint. It checks the current `mcp_*` enabled state and forwards both `POST /mcp/{serverId}` and its RFC 9728 metadata path over a **private** `MCP_ADAPTER` Service Binding. This Adapter Worker must not have workers.dev/preview/public routes. Identity additionally checks the exact resource against live Core Server state before OAuth authorize/approval, and Core rechecks selected operations per query. A syntactically correct resource path alone is never authority.


### MCP multi-model discovery call budget

The Identity OAuth execution bridge projects current read-only Query tools from one Space. For up to **32 selected models**, the Adapter uses one scoped Core inventory request plus **one batch semantic-detail request** `POST /api/v1/spaces/{spaceId}/_discovery/models/batch`; Core enforces each model's current Grant/Application/Server Tool Policy, and the Adapter still validates the matching model version/schemaHash before projecting tools. If the authorized Server exposes more than the configured runtime limit or the semantics response exceeds its safety cap, projection fails closed rather than omitting models silently. No external or Person Directory tools are included in this first Query-only slice.

 
### MCP protocol-era compatibility (2026-07-28 and legacy)

The same OAuth Resource endpoint now accepts modern stateless `2026-07-28` requests and legacy `2025-11-25` handshake-era requests:

- Modern: each request includes `MCP-Protocol-Version`, `Mcp-Method` (plus `Mcp-Name` for `tools/call`), and matching `params._meta` protocol version/client capabilities. The Adapter exposes `server/discover`, per-response `resultType: complete` and private `tools/list` results. Header/body mismatch returns `-32020`; unsupported versions return `-32022`. Modern `initialize` and `ping` are unsupported.
- Legacy: `initialize`, `ping` and `notifications/initialized` remain supported for existing 2025-era clients.
- Both eras use the **same** exact-resource OAuth token validation, selected-Space Agent Direct read-only Core bridge, live per-model query authority and 32-model batched semantics.

Client registration remains a separate OAuth Authorization Server concern. The 2026-07-28 MCP specification prefers HTTPS Client ID Metadata Documents (CIMD); unrestricted DCR is not required and must not be enabled merely to claim protocol compatibility. Before declaring broad third-party-client readiness, validate safe CIMD/pre-registration and actual clients in Staging.

Reference: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
