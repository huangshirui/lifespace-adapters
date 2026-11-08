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
- `OAUTH_RESOURCE_SERVER_SECRET`: dedicated Resource Server secret matching the Identity secret. The first **private Adapter Staging** deployment leaves this unset and fails closed. The owner-only **LifeSpace paired-secret Staging workflow** generates a random value and installs it directly on both exact Staging Workers; never duplicate it into GitHub Environment secrets.
- `CORE`: private Service Binding to the **same environment's Core Worker**; no direct public Core origin or OAuth bearer forwarding.

The adapter sends the original public OAuth bearer only to **Identity** for introspection and token exchange. The new Core bearer is Agent Direct with `principal=agent`, `actor=agent`, `resources:read`, selected `spaceId`, `applicationId`, authorization and resource identifiers; User Delegation is not implied. Core independently checks every call with Identity and reevaluates current model/Data Grant authority.

The implemented Core execution bridge performs current authorization checks and prevents access outside the specifically authorized Space. Neither this adapter nor an OAuth client can declare User/Agent/Delegation authority by itself.

Only after LifeSpace PRs #480 → #485 and Adapters PRs #29 → #30 are separately staged with protected Resource/secret bindings, Core dynamic per-Server authorization, approved OAuth clients, real Core Query and revocation/cross-Space negative tests may Data Tools be called **live-ready**.

**Never deploy the retired Managed OAuth Preview or reuse its Worker/Access resources.** This repository has no automatic environment deployment. The owner-only reviewed-main manual Staging workflow deploys a private Worker without secrets; an independent LifeSpace owner-only workflow converges its Resource Server secret with Identity Staging. CI performs synthetic tests and both synthetic/private Wrangler dry-runs.

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

## Dedicated Staging OAuth revocation smoke test / 独立测试授权撤销

`scripts/verify-staging-oauth-revocation.mjs` is an **operator-run, destructive test for a disposable Staging OAuth authorization**, not a production test, public registration bypass, or ChatGPT connector disconnection workflow.

- Prerequisite: authorize a separate synthetic Staging OAuth Client/Agent/Space with at least one readable model Tool using the approved Account PKCE Consent process. Keep the existing ChatGPT connector out of this test.
- Provide an access token in a local access-token file; for **authorization** revocation, provide its matching refresh token in a separate local refresh-token file. Keep files access-restricted, off GitHub/CI artifacts/chat/logs, and delete after the test. Never supply tokens in command-line arguments or GitHub Action inputs.
- Set `MCP_STAGING_RESOURCE_URI` to the exact `https://*-staging.<domain>/mcp/mcp_<32-hex>` HTTPS Resource; set `MCP_STAGING_OAUTH_ISSUER` to the matching Staging OAuth issuer origin; set `MCP_STAGING_CLIENT_ID` to the registered client ID. The script verifies the Resource metadata advertises the selected issuer.
- Set `MCP_STAGING_REVOKE_MODE=authorization` to revoke the parent OAuth Authorization **using its refresh token**, or `access-token` to revoke only one access token. `MCP_STAGING_REVOKE_CONFIRM=REVOKE_DEDICATED_STAGING_OAUTH` is mandatory. Set `MCP_STAGING_ACCESS_TOKEN_FILE` and, for authorization mode, `MCP_STAGING_REFRESH_TOKEN_FILE` to the local file paths.
- Run `node adapters/mcp/scripts/verify-staging-oauth-revocation.mjs` from the repository root. It checks: matching resource metadata → baseline `tools/list` HTTP 200 with at least one tool → `/oauth/revoke` HTTP 200 → **same cached bearer** `tools/list` HTTP 401. Only status codes, tool count and mode are reported; no raw token, Core body or business data is logged.
- A passing smoke run proves immediate denial of the old token, not full user-facing Account authorization management. That remains LifeSpace #481. The read-only MCP Adapter does not provide write tools: staged governed mutation work is tracked in LifeSpace #493.

All documentation examples must remain synthetic; no live resource URL, token file, test identity or user records belong in this public repository.

### Browser PKCE end-to-end without copying tokens / 浏览器交互式授权验收

For a complete **real Staging** OAuth test without manually exporting any token, use `scripts/verify-staging-oauth-pkce.mjs` locally with Node.js 22+:

1. Ensure the Staging Authorization Server advertises guarded DCR, and the active Staging MCP Server has an authorized **synthetic Agent + one readable test Model**. The test never requests write access.
2. Set `MCP_STAGING_RESOURCE_URI` to your exact enabled HTTPS `/mcp/mcp_*` Resource, `MCP_STAGING_OAUTH_ISSUER` to the corresponding Staging issuer origin, and `MCP_STAGING_REVOKE_CONFIRM=REVOKE_DEDICATED_STAGING_OAUTH`. Do not place these environment-specific values in the public repository.
3. Run `node adapters/mcp/scripts/verify-staging-oauth-pkce.mjs`. It starts an **ephemeral 127.0.0.1-only** OAuth callback listener and DCR-registers one disposable public PKCE Client with that exact loopback URI. Open the authorization URL shown in your terminal, sign in to the existing Cloudflare Access-backed Account Consent screen and select the **test** Application/Space/Agent. The browser returns only an Authorization Code to local loopback; the script verifies state, issuer and PKCE and never prints credentials.
4. It performs MCP `tools/list`, revokes the disposable Authorization through its Refresh Token, confirms the **same Access Token** immediately receives HTTP 401 and the revoked Refresh Token receives HTTP 400 on replay. Only success flags, counts and HTTP statuses are printed.
5. The temporary DCR Client registration remains in Staging after testing; review/disable it later through the normal Console client governance. OAuth Authorization is revoked; your existing ChatGPT connection and its tokens are untouched. No D1 mutation, production endpoint, user-record write or elevated User Delegation is used.

If DCR is not enabled, the script **stops before registration**. If Consent is denied or expires, no OAuth token is issued; the pending request expires. A local browser is required; this is not a noninteractive GitHub Actions job. The test confirms read-only OAuth consent and revocation, **not** functioning MCP record mutation (LifeSpace #493).

## Staging Native write candidate / Staging 原生写入候选

Development-only Agent Direct CRUD is gated by Staging + explicit read/write
OAuth consent + Core's exact current model contract and authority preview.
Production remains read-only; User Delegation is not implicitly enabled.
Contract, argument and deployment details: [MCP adapter](../../docs/mcp-adapter.md).
