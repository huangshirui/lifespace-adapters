# Notion provider adapter / Notion 数据源适配器

Consumes LifeSpace `apps/core/external-adapter.contract.json` version 1 for record execution plus the private External Connection management contract. It owns no LifeSpace ACL or database. Private Worker Service Binding + independent shared Secret authenticate Core.

## Connection credential ownership / 连接凭据归属

All provider execution uses a dynamic connection vault. Each `cnx_<32 hex>` connection is mapped to one SQLite-backed Durable Object owned by this private Adapter Worker. The Durable Object validates replacement credentials, lists accessible provider resources, and performs provider execution for that connection. The token therefore does not need to be returned from the Durable Object to the outer Worker after setup and never enters LifeSpace Core D1, Console state, Model metadata or ordinary API responses.

Dynamic credential state is encrypted **at rest inside the Durable Object** with AES-256-GCM before it is written to DO storage. The Adapter receives a dedicated `CONNECTION_VAULT_MASTER_KEY` Worker Secret containing exactly 32 random bytes encoded as 64 hexadecimal characters. This key is independent of `EXTERNAL_ADAPTER_SHARED_SECRET` and is never stored in Durable Object state. Stored connection state is a versioned `{version,algorithm,iv,ciphertext}` envelope. During connection create/rotation, provider credential plaintext necessarily exists transiently in the trusted BFF/Core/Adapter request path before the Connection DO validates and encrypts it; it is never persisted by those layers. After setup, runtime/resource-discovery requests carry only `cnx_*`: the Connection DO reads and decrypts its envelope for that one operation and calls Notion directly. The decrypted connection is **not cached in a Durable Object instance field across requests**, so a warm DO does not retain provider-token plaintext in JS object state between operations. Pre-encryption plaintext DO state is supported only as a one-way lazy migration: the first successful read encrypts and replaces the old state before execution continues. A missing, invalid or mismatched master key fails closed.

The vault is an Adapter credential store, not a LifeSpace authorization system. Space ownership, `spaces:manage`, Application × Model Access, Data Grants, Delegation and Runtime authorization remain in Core. One Durable Object serializes/co-locates state and provider pacing for one connection; unrelated connections use different Objects and do not share a concurrency lane.

The Adapter accepts only Core-generated `cnx_*` credential references. Deployment-managed static credential maps such as the retired `NOTION_CONNECTIONS` path are not supported. Staging acceptance supplies its synthetic provider token to the public LifeSpace Connection API as test input; the Adapter receives and persists that token only through the normal authenticated dynamic-connection management flow. Staging and production use separate Workers, Durable Object namespaces, secrets, vault master keys and bindings. Worker has no public workers.dev or preview URL.

The Adapter never exposes a public credential endpoint. Core is the only normal caller of `/internal/v1/external-connections`, authenticated with `EXTERNAL_ADAPTER_SHARED_SECRET`. Supported management operations are create/update/delete and bounded provider resource discovery. Credential plaintext is accepted only on create/rotation and is never echoed in success/error payloads or logs.

Notion API is explicitly pinned to `2025-09-03` data-source semantics. Status option filters also enable the documented `status-group-filters-2026-10-06` beta header so option names cannot silently match a broader status group. Database selection is resolved only when exactly one source exists; otherwise use the concrete data source ID returned by resource discovery. Canonical identity ignores UUID spelling so alternate spellings/connections cannot duplicate registration.

## Canonical field projection / Canonical 字段投影

The Adapter does not define a second field language. It projects the Provider schema into LifeSpace Canonical Field Types when a stable deterministic **semantic** projection exists. Provider UI/presentation metadata may be discarded; unsupported Provider fields remain absent instead of leaking Notion-native objects into Core.

Provider `property.id` is emitted as `sourceFieldId` and remains the durable Adapter/reconciliation identity. Adapter codecs are keyed by `sourceFieldId`. Core assigns and persists the public Native-style readable Field Key after discovery; Notion rename updates title/description but does not change the public key. The old public `f_<hash>` contract is retired.

| Notion type | LifeSpace type | Read | Write | Query / Sort | Notes |
| --- | --- | --- | --- | --- | --- |
| title, url, email, phone_number | string | yes | ceiling | eq/ne/contains/null; provider sort | title/rich values are flattened to canonical text/string semantics |
| rich_text | text | yes | ceiling | eq/ne/contains/null; provider sort | formatting/annotations are not retained |
| number | number | yes | ceiling | comparisons/null; provider sort | |
| checkbox | boolean | yes | ceiling | eq/ne; provider sort | |
| select, status with bounded known options | enum | yes | ceiling | eq/ne/null; provider sort | option name is canonical value |
| multi_select with bounded known options | enum_list | yes | ceiling | contains/null; provider sort when advertised | unique option-name array |
| created_time, last_edited_time | instant | yes | no | comparisons; provider sort | read-only |
| unique_id | string | yes | no | eq/ne/contains/null; provider sort when advertised | read-only |
| date | date | yes | ceiling | comparisons/null; provider sort | Start Date projection |
| files | file_ref_list | yes | no | none | Provider-hosted references only; bytes remain in Notion |
| relation | — | no | no | no | Notion-internal relation, intentionally omitted |
| people | — | no | no | no | Notion workspace identity, intentionally omitted |
| created_by, last_edited_by | — | no | no | no | Notion workspace identity, intentionally omitted |
| verification, place | — | no | no | no | intentionally omitted |
| formula | — | no | no | no | V1 omits it because result type has no stable schema-level contract |
| rollup | — | no | no | no | V1 omitted; array rollups are explicitly unsupported |
| other unsupported types | — | no | no | no | absent from compatible snapshot |

### Date = Start Date

Notion `date` is intentionally projected to one LifeSpace `date`: the calendar date of Provider `start`.

```text
empty                                           -> null
2026-10-17                                      -> 2026-10-17
2026-10-17T14:30:00+08:00                       -> 2026-10-17
2026-10-17 -> 2026-10-20                        -> 2026-10-17
2026-10-17T14:30 -> 2026-10-20T18:00            -> 2026-10-17
```

The Adapter takes the `YYYY-MM-DD` prefix from the Provider `start`; it does not convert the instant to UTC first. Read, filter and sort therefore share the same Start Date semantics. A LifeSpace write sets Notion `start = YYYY-MM-DD` with no `end` or time.

### Files

`files` projects read-only to `file_ref_list`:

```json
[
  {
    "name": "report.pdf",
    "url": "https://...",
    "expiresAt": "2026-10-17T12:30:00Z"
  }
]
```

For Notion-hosted files, the current signed URL and expiry are returned. For external files, the original URL is returned without fabricated expiry. File bytes are never copied into LifeSpace/R2 and signed URLs are not treated as durable file identity.

### Metadata

- `property.name -> title`
- `property.description -> description` when provided
- `property.id -> sourceFieldId`
- select/status/multi_select options -> canonical `values`
- `nullable`, `readOnly`, writable/filter/sort capability may be Adapter-derived from explicit Notion semantics
- color, number format, formula expression, rollup config and other Provider-only implementation/UI metadata do not enter Canonical `FieldDefinition`

Unsupported Provider field types never enter the compatible snapshot. For supported projections, missing/unavailable Provider values are returned according to the canonical nullable/list semantics rather than turning one weak-schema value into a whole-record contract failure. Reads still validate the Provider property family against the snapshot so an actual schema change is not silently coerced.

Get/update/delete verify page parent data-source membership before access/mutation. Stable records use `rec_external_<dataSourceUUID>_<pageUUID>`; no fake Native version.

Query pushes at most two levels of AND/OR typed filters, ordered Provider property sorting and <=100 row cursor pages. No client filtering/scan. Provider live ordering/null placement/tie behavior is not a Native ordering guarantee. Trash is delete semantics; no permanent Provider destruction. Create is one API call; update/delete use a parent-validation GET then PATCH. Read-only connection writes fail closed.

Dynamic connection execution runs inside the connection Durable Object, so pacing/circuit state is connection-scoped across requests handled by that Object. The provider pace is 350ms, pending queue <=50. Provider 429 uses Retry-After, <=3 attempts and <=10s wait; a longer requested delay returns rate-limited rather than retrying early. GET 5xx can retry; writes with timeout/5xx never retry. Five failures open a 30s circuit. Provider limits remain authoritative; this is not an advertised global quota guarantee.

Run `node --test adapters/notion/test/*.test.mjs` and the existing MCP tests. Real provider SLO/staging acceptance needs injected deployment configuration and synthetic Notion resources.

## Deployment profiles / 部署环境

The checked-in `staging` and `production` Wrangler profiles are private packaging templates, with deliberately synthetic Worker names and no public routes. Each profile binds its own `NotionConnectionVault` Durable Object namespace. The owning deployment supplies its environment-local Worker name through `--name`; never copy live account identifiers, Worker names, connections or tokens into this public repository. Select `--env staging` or `--env production` explicitly. Secrets and Durable Object state are environment-isolated.

Deploy an immutable reviewed adapter commit before deploying its Core Service Binding. Inject only `EXTERNAL_ADAPTER_SHARED_SECRET` and `CONNECTION_VAULT_MASTER_KEY` with `wrangler secret bulk` over stdin in the same selected environment and Worker name. Generate the vault master key independently, for example `openssl rand -hex 32`; do not reuse the shared secret, platform bootstrap secret, staging smoke token or a provider token. Core receives only the independent shared secret. Provider tokens enter the Adapter only through the authenticated dynamic Connection create/rotation contract and are encrypted into their per-Connection Durable Object vault. Deployment must synchronize matching transport secrets, reject cross-environment names and verify authenticated connection/discovery through Core. A successful Worker upload alone is not provider acceptance. Shared-secret rotation requires updating the matching Core and Adapter secrets together; vault-master-key rotation is a separate credential-storage migration and must not be performed by simply replacing the secret while encrypted DO state still uses the old key. Do not retry an uncertain provider write.

Official protocol references: [search](https://developers.notion.com/reference/post-search), [retrieve data source](https://developers.notion.com/reference/retrieve-a-data-source), [query](https://developers.notion.com/reference/query-a-data-source), [typed filters and timestamp/status semantics](https://developers.notion.com/reference/filter-data-source-entries), [request limits](https://developers.notion.com/reference/request-limits).
