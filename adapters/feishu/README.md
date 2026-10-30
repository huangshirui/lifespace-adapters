# Feishu Bitable External Data Adapter / 飞书多维表格外部数据适配器

## Scope / 范围

This **private Cloudflare Worker** consumes LifeSpace External Adapter contract v1 and External Connection Adapter contract v1, just like the Notion provider. It is a provider-facing Adapter, not an independent Model Registry, Space authorization system, or OAuth authorization server. It has no direct access to LifeSpace D1.

Current implementation is **synthetic-tested code only, not deployed or real-provider-verified**. LifeSpace Core must additionally configure an explicit provider-specific Service Binding and EXTERNAL_PROVIDER_ROUTES entry before this provider appears in Console; this repository alone does not deploy it. This Adapter does not require a new business-model Kernel API or migration.

## Credential setup / 凭据连接

The v1 connection uses one **Feishu enterprise custom app** with App ID and App Secret, bound to **one Bitable Base**. Core's existing Console credential input supports one secret field; the Feishu descriptor labels that field:

    App ID | App Secret | Base app_token

Paste the three exact values joined with pipe characters (no spaces), for example (synthetic placeholders only):

    cli_exampleAppId123|exampleAppSecret123456|bascnExampleBase12345

**Never paste real credentials into a GitHub issue/PR, this repository, test output, or chat.** The connector API receives the secret transiently; the per-cnx_* Durable Object validates it through Feishu's client_credentials token exchange and encrypts the entire connection using AES-256-GCM before Durable Object storage. The Worker Secret CONNECTION_VAULT_MASTER_KEY is exactly 64 hexadecimal characters (32 random bytes) and must be distinct from EXTERNAL_ADAPTER_SHARED_SECRET and all LifeSpace/Notion secrets. No plaintext credential, derived access token, or decrypted vault content is written to Core D1 or returned to callers. The DO decrypts only for each request; no plaintext app credential is cached in instance fields.

The provider uses the current Feishu OAuth v3 endpoint POST https://accounts.feishu.cn/oauth/v3/token (client_credentials) to obtain a short-lived tenant access token, then calls https://open.feishu.cn/open-apis/bitable/v1. It does not use the deprecated tenant_access_token/internal endpoint or implement user OAuth. The custom app must have relevant Bitable read/write scopes and must be granted document collaboration permissions on the target Base. A read ceiling cannot be used to write; a write ceiling does not override Feishu document permissions. Rotating credentials on an existing Connection cannot change its Base; create a new Connection instead.

This first implementation intentionally uses the existing single-secret Console field to avoid extending the platform-wide credential form for one provider. A future multi-field descriptor/form is a separate UX improvement, not required for Core contract v1.

## Resource identity / 稳定身份

Resource discovery returns the table list for the configured Base:

    resourceId = <immutable Base app_token>:<table_id>
    sourceFieldId = Feishu field_id
    public Field Key = Core-assigned key reused across schema refresh
    public Record ID = rec_external_<SHA256("feishu:bitable:" + resourceId) first 32 hex>_<record_id>

A changed table title or field name does not remap IDs; deleting and recreating a field with a new field_id never silently inherits the original public Field Key. Another Base or another table cannot share the same public Record ID namespace. Connection rotation/rename does not change resource identity. Provider-local row IDs are checked against the binding's resource namespace before any request, and all row operations address the table-specific Feishu endpoint.

## Supported Canonical fields / 字段语义

| Feishu field type | LifeSpace type | Read | Write | Filter / sort |
| --- | --- | --- | --- | --- |
| 1 (multiline text) | text | yes | ceiling | not exposed in v1 |
| 2 (number) | number | yes | ceiling | not exposed in v1 |
| 3 (single select, <=50 options) | enum | yes | ceiling | not exposed in v1 |
| 4 (multi select, <=50 options) | enum_list | yes | ceiling | not exposed in v1 |
| 7 (checkbox) | boolean | yes | ceiling | not exposed in v1 |
| date, phone, URL, person, attachment, formula, lookup, relation and other fields | — | omitted | no | no |

The non-nullable enum_list empty value is [] and checkbox null is false. Text segments are flattened without rich formatting. Unsupported field types stay absent; no provider-native field JSON is copied to the canonical model. A field rename changes Provider title and codec name at schema refresh but not sourceFieldId/key. Conflicting duplicate names, excessive projected fields and incompatible row values fail closed rather than fabricate semantics.

Canonical metadata classification:
- title and enum option values: provider-native
- sourceFieldId: provider-native identity; public key: Core-owned stable mapping
- nullable, readable, writable, operators, sortable: adapter-derived and bounded by Connection access
- descriptions, number formats, date formatting, provider views and permissions: provider-only / not projected
- required, immutable, numeric constraints, relation target, provider identities: unsupported (never inferred)

## Operations / 操作与限制

- discover: Feishu table fields -> supported canonical snapshot
- connection / listResources: short-lived tenant token -> Base-scoped resource discovery
- get / query: table-scoped GET; query supports only page_size/page_token, no filters/sorts/search; it refuses such inputs rather than do unbounded client filtering
- create / update / delete: single-record Feishu API, no transactions, optimistic versions, actions or relation-target resolution
- upload: not advertised; explicitly unavailable. Attachments remain Provider-owned.
- write timeout, 5xx or uncertain result: EXTERNAL_WRITE_UNKNOWN, never automatically retry
- 403/permission and provider errors: generic bounded External error, no provider response body forwarded
- Live pagination is not a consistent snapshot; eventual schema refresh and Provider-side permissions remain authoritative

Feishu may serialize writes on a Base; concurrent writers through different Connections or external Feishu clients may conflict. The adapter never assumes an atomic cross-provider transaction. Bulk is only the Core per-item non-atomic path, not a Feishu atomic batch.

## Testing / 测试

    node --check adapters/feishu/src/provider.mjs
    node --check adapters/feishu/src/connection-vault.mjs
    node --check adapters/feishu/src/worker.mjs
    node --test adapters/feishu/test/*.test.mjs

Tests use **synthetic** Base/field/row IDs, mock OAuth/Provider responses, and a memory DO storage shim; they do not prove live Feishu quotas, document privileges or rate-limit behavior.

## Deployment boundary / 部署边界

The Wrangler staging/production templates are intentionally private: workers_dev=false, preview_urls=false, no routes. Inject EXTERNAL_ADAPTER_SHARED_SECRET and CONNECTION_VAULT_MASTER_KEY using the environment's secret store; never commit them. Core's provider-specific Service Binding, Core-to-Adapter shared secret and EXTERNAL_PROVIDER_ROUTES are managed by LifeSpace deployment, independently per environment. Deploy a reviewed immutable adapter SHA, then configure Core and perform synthetic staging acceptance before production. Real Feishu credentials are never bundled into Worker configuration.

Official documentation:
- [Tenant access token (OAuth v3)](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/tenant_access_token)
- [Bitable overview](https://open.feishu.cn/document/server-docs/docs/bitable-v1/bitable-overview)
- [List fields](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-field/list)
- [List records](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/list)
- [Create records](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/create)
