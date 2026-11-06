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
- `POST /mcp` accepts only opaque `lsp_oat_*` bearer credentials and calls private Identity `POST /oauth/introspect` for **the exact requested Resource**. No browser Access JWT or server-only `lsa_*` is accepted as an MCP user credential.
- `initialize`, `ping` and limited notifications are implemented.
- `tools/list` and `tools/call` deliberately respond **503** until LifeSpace supplies a trusted, Space-bound, revocation-aware Agent execution bridge. The pure MCP query projection is tested but **is not connected to OAuth execution**.

## Deployment boundary / 部署边界

No live environment is configured in source code. A later reviewed staging deployment must set:
- `MCP_RESOURCE_URI`: canonical HTTPS MCP Resource URL with exact `/mcp` path.
- `MCP_OAUTH_ISSUER`: exact LifeSpace Identity OAuth Issuer origin.
- `IDENTITY`: private Service Binding to the **same environment's Identity Worker**.
- `OAUTH_RESOURCE_SERVER_SECRET`: dedicated private Resource Server secret matching the Identity secret, supplied through protected deployment configuration only.

The future Core execution bridge must perform current authorization checks and prevent access outside the specifically authorized Space. Neither this adapter nor an OAuth client can declare User/Agent/Delegation authority by itself.

Only after that bridge, protected Resource Server deployment, exact Identity resource allowlist, approved OAuth client registration and browser/real MCP negative-path tests succeed may Data Tools be enabled.

**Never deploy the retired Managed OAuth Preview or reuse its Worker/Access resources.** This repository has no ordinary CI environment deployment; CI performs synthetic tests and a Wrangler dry-run only.

See [the adapter design](../../docs/mcp-adapter.md) and [canonical LifeSpace contracts](../../docs/lifespace-contract-consumption.md).
