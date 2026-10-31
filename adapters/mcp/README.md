# MCP Adapter

This directory owns the concrete MCP（Model Context Protocol，模型上下文协议） adapter for LifeSpace.

Current status: **Canonical Query Projection Core tested; read-only Remote MCP Worker deployed as isolated earlier Staging candidate; Worker Previews migration planned/implemented in deployment config but not live-verified**.

The current M0 code proves the protocol-independent path:

```text
GET /api/v1/me/_discovery/inventory
        ↓
select visible model keys
        ↓
GET /api/v1/spaces/{spaceId}/_discovery/models/{modelKey}
        ↓
one Agent-friendly MCP Query Tool per model + execution binding
        ↓
compile simple Agent arguments to LifeSpace Canonical Query
        ↓
POST /api/v1/spaces/{spaceId}/models/{modelKey}/records/query
```

Files:

- `src/progressive-discovery.mjs` loads compact inventory plus only selected semantic details and fails closed when `key/version/schemaHash` drift;
- `src/projection.mjs` projects `query.canonical` into one smaller MCP Tool per selected model and builds Canonical Query POST requests;
- `test/projection.test.mjs` proves Progressive Discovery bounds, Agent-friendly Search/filters/Sort/Pagination, optional `advancedFilter`, range forwarding and Space isolation;
- `test/projection-fail-closed.test.mjs` proves unsupported or stale semantics are rejected.

The default Query Tool surface is:

```text
spaceId
search?
filters[]?        simple typed predicates; AND by default
sort[]?
limit?
cursor?
advancedFilter?  nested Canonical Boolean AST only when needed
```

`filters[]` and `advancedFilter` are mutually exclusive. Both compile into the same LifeSpace-owned Canonical Filter semantics; there is no MCP Standard Query / Capability Query mode.

The adapter must:

- derive visible MCP capabilities from current LifeSpace Runtime Discovery（运行时发现）;
- preserve Space Context（空间上下文）;
- execute only through canonical LifeSpace operations;
- preserve Principal / Actor / Application Context（权限主体 / 执行者 / 应用上下文） semantics;
- fail closed when LifeSpace contract semantics cannot be represented safely;
- never expose Platform Admin（平台管理） control-plane operations through ordinary Agent discovery.

The projection consumes the current LifeSpace Canonical Query semantic descriptor, including Search + Filter intersection semantics, typed filter targets/operators, ordered Sort and cursor Pagination. Legacy query metadata does not generate a second MCP query surface and is not maintained as a compatibility mode.

The new MVP Worker chooses Cloudflare Workers stateless Streamable HTTP transport and delegates OAuth to Cloudflare Access Managed OAuth; this does not change LifeSpace semantics or implement client-specific grant management.

See [`../../docs/mcp-adapter.md`](../../docs/mcp-adapter.md) before extending implementation.

Do not add a local domain model, permission database, copied Model Registry or direct D1 access here.

## Managed OAuth / Remote MCP MVP（开发中）

The first deployment candidate is a read-only, stateless Streamable HTTP MCP Resource Server at \`POST /mcp\`. The OAuth Authorization Server is **Cloudflare Access Managed OAuth**, not this Worker and not a second implementation in LifeSpace Identity.

### Trust and API flow（可信链路）

1. Cloudflare Access guards the custom hostname with **Managed OAuth enabled**, and injects \`Cf-Access-Jwt-Assertion\`. \`workers_dev\` and preview URLs remain disabled.
2. MCP Worker passes the **original assertion**, with its own server-only \`lsa_*\`, to Identity \`POST /internal/v1/access/tokens\`, requesting **only** \`resources:read\`.
3. Identity independently checks issuer, RSA signature, audience registered to that LifeSpace Application, \`usr_*\` mapping and credential scope ceiling. A first-time unlinked principal **fails closed**; never automatically create or merge an account.
4. The short-lived **LifeSpace user JWT** is sent server-to-server to Core inventory, semantic detail and canonical query APIs. The Cloudflare OAuth access token is never passed through to Core.
5. Core provides fresh effective Discovery and **rechecks** current Space / Data Grant / Application Model Access and credential scope at execution time. Only read-only \`lifespace.query.*\` tools are exposed.
6. MCP OAuth Client ID and per-client custom Scope are **not assumed** to be available from Cloudflare Managed OAuth. The MVP therefore uses a single read-only credential ceiling and Access Policy for the entire protected endpoint. No mutation tools, per-client grants or Agent representation are claimed.

### Deployment prerequisites（Staging only）

- Deploy using [\`wrangler.jsonc\`](wrangler.jsonc), setting a private Staging worker name and a private custom hostname. Never deploy an unprotected \`*.workers.dev\` endpoint.
- Configure exact-origin Access **self-hosted application** on that hostname with an allow policy limited to test users, **Managed OAuth** enabled, and the resulting Access audience registered to the intended LifeSpace Application in **Staging Identity**.
- Create an independent, revocable \`lsa_*\` for that Application, whose allowed scopes contain \`resources:read\`. Grant only the desired models **read** access via the existing Core Application Model Access control plane.
- Inject these Worker variables/secrets through the Cloudflare dashboard or deployment secrets, never commit their values:
  - \`LIFESPACE_APPLICATION_CREDENTIAL\` **Secret**, Staging \`lsa_*\`.
  - \`MCP_MODEL_KEYS\` comma-separated allowlist of exact model keys, e.g. \`task,event\` (max 16).
  - \`IDENTITY_BASE_URL\` and \`CORE_BASE_URL\` trusted HTTPS origins, **or** private Service Bindings named \`IDENTITY\` and \`CORE\` (preferred).
  - Optional \`MCP_ALLOWED_ORIGINS\` comma-separated exact origins for browser-based MCP callers. Origin is rejected unless same-origin or explicitly allowlisted.
- All MCP HTTP requests require valid Access proof; the Handler never accepts caller-provided \`userId\`, \`scope\`, \`actorId\` or a raw LifeSpace bearer credential.
- Cloudflare Managed OAuth supplies OAuth Protected Resource Metadata and 401 challenges **before** requests reach this Worker. Do **not** add a second \`/.well-known/oauth-*\` or OAuth token exchange handler here.

### Local verification and Staging acceptance（验收）

\`\`\`bash
node --check adapters/mcp/src/worker.mjs
node --test adapters/mcp/test/*.test.mjs
\`\`\`

MVP smoke acceptance requires **real evidence**: OAuth discovery → browser login → Access login-policy success → Identity mapping to the existing \`usr_*\` → \`initialize\` → \`tools/list\` exposing a permitted query model → \`tools/call\` returning only that user/Space's records. Then test rejected Access principal, wrong audience, unlinked principal, Core grant/model revoke, forbidden writes and token expiry. A passing synthetic CI test does **not** count as live OAuth E2E acceptance.

### MVP limitations（限制）

- No custom per-client OAuth Consent/Scope UI, no reliable Managed OAuth Client identity for LifeSpace policy: fail closed by giving **every** OAuth caller the same minimal read-only upper bound, independent of Core's narrower user authorization.
- No Agent execution delegation, create/update/delete, multi-domain top-K selection, or direct anonymous access. Future extension needs distinct architectural and security review.
- A Cloudflare Access app that authenticates successfully but is not registered to the corresponding LifeSpace Application audience still fails \`/internal/v1/access/tokens\`.
- The server is stateless, supports JSON MCP replies over Streamable HTTP and does not implement server-to-client SSE streams or resumable MCP sessions. MCP clients requiring long-lived GET/SSE need a later compatibility slice.
