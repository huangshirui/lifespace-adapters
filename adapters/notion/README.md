# Notion provider adapter / Notion 数据源适配器

Consumes LifeSpace `apps/core/external-adapter.contract.json` version 1 for record execution plus the private External Connection management contract. It owns no LifeSpace ACL or database. Private Worker Service Binding + independent shared Secret authenticate Core.

## Connection credential ownership / 连接凭据归属

Normal product setup uses a dynamic connection vault. Each `cnx_<32 hex>` connection is mapped to one SQLite-backed Durable Object owned by this private Adapter Worker. The Durable Object validates replacement credentials, lists accessible provider resources, and performs provider execution for that connection. The token therefore does not need to be returned to the outer Worker after setup and never enters LifeSpace Core D1, Console state, Model metadata or ordinary API responses.

Dynamic credential state is encrypted **at rest inside the Durable Object** with AES-256-GCM before it is written to DO storage. The Adapter receives a dedicated `CONNECTION_VAULT_MASTER_KEY` Worker Secret containing exactly 32 random bytes encoded as 64 hexadecimal characters. This key is independent of `EXTERNAL_ADAPTER_SHARED_SECRET` and is never stored in Durable Object state. Stored connection state is a versioned `{version,algorithm,iv,ciphertext}` envelope; plaintext token/read/write exists only transiently in the Durable Object execution memory when validating or calling Notion. Pre-encryption plaintext DO state is supported only as a one-way lazy migration: the first successful read encrypts and replaces the old state before execution continues. A missing, invalid or mismatched master key fails closed.

The vault is an Adapter credential store, not a LifeSpace authorization system. Space ownership, `spaces:manage`, Application × Model Access, Data Grants, Delegation and Runtime authorization remain in Core. One Durable Object serializes/co-locates state and provider pacing for one connection; unrelated connections use different Objects and do not share a concurrency lane.

`NOTION_CONNECTIONS` remains supported only for deployment-managed/bootstrap references such as staging smoke acceptance. It is a Worker Secret JSON map from opaque reference to `{token,read:true,write:boolean,disabled?:boolean}`. New application/Console setup must not ask users or Space managers to know one of these server-side references. Rotation of a dynamic connection is performed through the authenticated management contract at the same `cnx_*`; bootstrap rotation updates the Secret map at its existing reference. Stage/production use separate Workers, Durable Object namespaces, secrets, vault master keys and bindings. Worker has no public workers.dev or preview URL.

The Adapter never exposes a public credential endpoint. Core is the only normal caller of `/internal/v1/external-connections`, authenticated with `EXTERNAL_ADAPTER_SHARED_SECRET`. Supported management operations are create/update/delete and bounded provider resource discovery. Credential plaintext is accepted only on create/rotation and is never echoed in success/error payloads or logs.

Notion API is explicitly pinned to `2025-09-03` data-source semantics. Status option filters also enable the documented `status-group-filters-2026-10-06` beta header so option names cannot silently match a broader status group. Database selection is resolved only when exactly one source exists; otherwise use the concrete data source ID returned by resource discovery. Canonical identity ignores UUID spelling so alternate spellings/connections cannot duplicate registration.

| Notion type | LifeSpace type | Read | Write | Query |
| --- | --- | --- | --- | --- |
| title, url, email, phone_number | string | yes | ceiling | eq/ne/contains/null |
| rich_text | text (plain text projection) | yes | ceiling | eq/ne/contains/null |
| number | number | yes | ceiling | comparisons/null |
| checkbox | boolean | yes | ceiling | eq/ne |
| select, status with bounded known options | enum (option name) | yes | ceiling | eq/ne/null |
| created_time, last_edited_time | instant | yes | no | comparisons |
| date | hidden in V1 | no | no | no |
| multi_select, people, relation, files, formula, rollup, unique_id, other types | hidden | no | no | no |

Date is intentionally hidden: Notion permits a date/instant point or optional-ended range within one property, while the current canonical TemporalRange requires a nonempty half-open range. Inventing an end or discarding one would corrupt meaning. Supporting it needs a separately defined canonical projection; Core must not learn a `notion_date` type. Unsupported types never enter the compatible snapshot. Rich text formatting/annotations are not preserved; consumers explicitly receive plain text.

Property IDs generate stable `f_<hash>` keys; rename changes title, never the key. Empty/oversized enum definitions are hidden until representable. Reads validate property type against the snapshot. Get/update/delete verify page parent data-source membership before access/mutation. Stable records use `rec_external_<dataSourceUUID>_<pageUUID>`; no fake version.

Query pushes at most two levels of AND/OR typed filters, ordered provider property sorting and <=100 row cursor pages. No client filtering/scan. Provider live ordering/null placement is not a Native ordering guarantee. Trash is delete semantics; no permanent provider destruction. Create is one API call; update/delete use a parent-validation GET then PATCH. Read-only connection writes fail closed.

Dynamic connection execution runs inside the connection Durable Object, so pacing/circuit state is connection-scoped across requests handled by that Object. Bootstrap connections retain the previous per-isolate lane. The provider pace is 350ms, pending queue <=50. Provider 429 uses Retry-After, <=3 attempts and <=10s wait; a longer requested delay returns rate-limited rather than retrying early. GET 5xx can retry; writes with timeout/5xx never retry. Five failures open a 30s circuit. Provider limits remain authoritative; this is not an advertised global quota guarantee.

Run `node --test adapters/notion/test/*.test.mjs` and the existing MCP tests. Real provider SLO/staging acceptance needs injected deployment configuration and synthetic Notion resources.

## Deployment profiles / 部署环境

The checked-in `staging` and `production` Wrangler profiles are private packaging templates, with deliberately synthetic Worker names and no public routes. Each profile binds its own `NotionConnectionVault` Durable Object namespace. The owning deployment supplies its environment-local Worker name through `--name`; never copy live account identifiers, Worker names, connections or tokens into this public repository. Select `--env staging` or `--env production` explicitly. Secrets and Durable Object state are environment-isolated.

Deploy an immutable reviewed adapter commit before deploying its Core Service Binding. Inject `EXTERNAL_ADAPTER_SHARED_SECRET`, `CONNECTION_VAULT_MASTER_KEY` and optional bootstrap `NOTION_CONNECTIONS` with `wrangler secret bulk` over stdin in the same selected environment and Worker name. Generate the vault master key independently, for example `openssl rand -hex 32`; do not reuse the shared secret, bootstrap secret or a provider token. Core receives only the independent shared secret; dynamic and bootstrap Notion tokens remain Adapter-owned. Deployment must synchronize matching secrets, reject cross-environment names and verify authenticated connection/discovery through Core. A successful Worker upload alone is not provider acceptance. Shared-secret rotation requires updating the matching Core and Adapter secrets together; vault-master-key rotation is a separate credential-storage migration and must not be performed by simply replacing the secret while encrypted DO state still uses the old key. Do not retry an uncertain provider write.

Official protocol references: [search](https://developers.notion.com/reference/post-search), [retrieve data source](https://developers.notion.com/reference/retrieve-a-data-source), [query](https://developers.notion.com/reference/query-a-data-source), [typed filters and timestamp/status semantics](https://developers.notion.com/reference/filter-data-source-entries), [request limits](https://developers.notion.com/reference/request-limits).