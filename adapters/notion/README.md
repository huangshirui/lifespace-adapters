# Notion provider adapter / Notion 数据源适配器

Consumes LifeSpace `apps/core/external-adapter.contract.json` version 1; synthetic verification only, not deployed. It owns no LifeSpace ACL or database. Private Worker Service Binding + independent shared Secret authenticate Core.

Inject `EXTERNAL_ADAPTER_SHARED_SECRET` (>=32 random characters) and `NOTION_CONNECTIONS` through Worker Secrets. The latter is a JSON map from opaque credential reference to `{token,read:true,write:boolean,disabled?:boolean}`. Never commit actual configuration. Rotation updates the same reference; revoke by disabling Core Source and removing/disabling that entry. Stage/production must use separate Workers/Secrets/bindings. Worker has no public workers.dev or preview URL.

Notion API is explicitly pinned to `2025-09-03` data-source semantics. Status option filters also enable the documented `status-group-filters-2026-10-06` beta header so option names cannot silently match a broader status group. Database selection is resolved only when exactly one source exists; otherwise supply the chosen concrete data source ID. Canonical identity ignores UUID spelling so alternate spellings/connections cannot duplicate registration.

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

Per-isolate pacing is 350ms per connection, pending queue <=50. Provider 429 uses Retry-After, <=3 attempts and <=10s wait; a longer requested delay returns rate-limited rather than retrying early. GET 5xx can retry; writes with timeout/5xx never retry. Five failures open a 30s circuit. Multiple isolates still rely on provider 429; this is not advertised as a global quota guarantee.

Run `node --test adapters/notion/test/*.test.mjs` and the existing MCP tests. Real provider SLO/staging acceptance needs injected deployment configuration and synthetic Notion resources.

Official protocol references: [retrieve data source](https://developers.notion.com/reference/retrieve-a-data-source), [query](https://developers.notion.com/reference/query-a-data-source), [typed filters and timestamp/status semantics](https://developers.notion.com/reference/filter-data-source-entries), [request limits](https://developers.notion.com/reference/request-limits).
