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
       └─ [pending] trusted Space-scoped Agent execution bridge → Core
```

**Do not confuse OAuth token acceptance with Core data authorization.**
An `lsp_oat_*` OAuth token identifies a currently authorized Client/Application/Space/Agent combination. It does not itself become a Core JWT, a User Principal, or a Delegation. The selected execution mode may permit asking for future User Delegation, but cannot create one.

## Files / 文件说明

- `src/identity-oauth-worker.mjs`: independently packaged MCP OAuth Protected Resource Server, with RFC 9728 discovery, Bearer challenge, Identity introspection, scope/resource checks and limited MCP handshake.
- `test/identity-oauth-worker.test.mjs`: synthetic positive and deny-path tests for the new Resource Server.
- `wrangler.identity-oauth.jsonc`: **synthetic local/CI dry-run**; no live hostname, Worker name, secret or binding.
- `src/progressive-discovery.mjs`: Core-owned dynamic inventory and selected-model semantic loading, with drift protection.
- `src/projection.mjs`: pure canonical query-to-MCP Tool schema projection and bounded LifeSpace query request builder.
- `test/projection.test.mjs`, `test/projection-fail-closed.test.mjs`, `test/external-discovery.test.mjs`: independent projection/contract validation.

## Currently implemented MCP surface

- `GET /.well-known/oauth-protected-resource` and the Resource-path-specific well-known endpoint return the fixed Identity OAuth Issuer and exact Resource identifier.
- `POST /mcp/{mcp_*}` (one exact Core-issued Server ID) accepts only opaque `lsp_oat_*` bearer credentials and calls private Identity `POST /oauth/introspect` for **the exact requested Resource**. No browser Access JWT or server-only `lsa_*` is accepted as an MCP user credential.
- `initialize`, `ping` and limited notifications are implemented.
- `tools/list` and `tools/call` consume only the **Identity-issued read-only Agent Direct Core token** and project current Core-discovered models in the single Space selected by Consent. Execution is still revalidated by Core. They return **503** if the matching LifeSpace Identity/Core bridge, signatures, bindings or current-scoped discovery are unavailable. Synthetic tests pass, but this code is **not deployed**.

## Deployment boundary / 部署边界

No live environment is configured in source code. A later reviewed staging deployment must set:
- **Canonical multi-Server mode:** `MCP_RESOURCE_ORIGIN=https://core-staging.aisr.online` (Staging) or `https://core.aisr.online` (Production). It must be a **single exact origin**, without a path, query, wildcard or credentials. The Resource is constructed from each incoming `/mcp/{mcp_*}` path; one private Adapter serves many Core-managed Servers. Do not set `MCP_RESOURCE_URI` in this mode.
- **Isolated test-only single-resource mode:** `MCP_RESOURCE_URI` accepts a fixed canonical `/mcp/{mcp_*}` URL when `MCP_RESOURCE_ORIGIN` is absent; this does **not** implement dynamic Server provisioning.
- `MCP_OAUTH_ISSUER`: exact LifeSpace Identity OAuth Issuer origin.
- `IDENTITY`: private Service Binding to the **same environment's Identity Worker**.
- `OAUTH_RESOURCE_SERVER_SECRET`: dedicated private Resource Server secret matching the Identity secret, supplied through protected deployment configuration only.
- `CORE`: private Service Binding to the **same environment's Core Worker**; no direct public Core origin or OAuth bearer forwarding.

The adapter sends the original public OAuth bearer only to **Identity** for introspection and token exchange. The new Core bearer is Agent Direct with `principal=agent`, `actor=agent`, `resources:read`, selected `spaceId`, `applicationId`, authorization and resource identifiers; User Delegation is not implied. Core independently checks every call with Identity and reevaluates current model/Data Grant authority.

The future Core execution bridge must perform current authorization checks and prevent access outside the specifically authorized Space. Neither this adapter nor an OAuth client can declare User/Agent/Delegation authority by itself.

Only after LifeSpace PR #480 and this Adapters PR pass their own tests and are separately staged with protected Resource/secret bindings, exact Identity allowlist, approved OAuth clients, real Core Query and revocation/cross-Space negative tests may Data Tools be called **live-ready**.

**Never deploy the retired Managed OAuth Preview or reuse its Worker/Access resources.** This repository has no ordinary CI environment deployment; CI performs synthetic tests and a Wrangler dry-run only.

See [the adapter design](../../docs/mcp-adapter.md) and [canonical LifeSpace contracts](../../docs/lifespace-contract-consumption.md).


**Public ingress ownership:** the `core[-staging].aisr.online` Core Worker is the public endpoint. It checks the current `mcp_*` enabled state and forwards both `POST /mcp/{serverId}` and its RFC 9728 metadata path over a **private** `MCP_ADAPTER` Service Binding. This Adapter Worker must not have workers.dev/preview/public routes. Identity additionally checks the exact resource against live Core Server state before OAuth authorize/approval, and Core rechecks selected operations per query. A syntactically correct resource path alone is never authority.
