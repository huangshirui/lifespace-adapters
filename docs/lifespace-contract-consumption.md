# LifeSpace Contract Consumption（LifeSpace 契约消费规则）

## Purpose（目的）

LifeSpace Adapters consumes LifeSpace contracts; it does not redefine them.

This document records how adapter code must bind to canonical LifeSpace contract sources and how compatibility is handled without creating a second source of truth.

## Canonical sources（权威来源）

The owning repository is [`huangshirui/LifeSpace`](https://github.com/huangshirui/LifeSpace).

| Contract / semantics | Canonical source |
| --- | --- |
| Identity application/user/service surface | `apps/identity/openapi.yaml` |
| Core Kernel surface | `apps/core/openapi.yaml` |
| Contract ownership/versioning rules | `docs/contracts.md` |
| Authority / Grants / current permission semantics | `docs/permissions.md` and related auth docs |
| Agent execution / Delegation semantics | `docs/agent-ready.md` |
| Ordinary model schema/action syntax | immutable generated `mct_*` Model Contract Revision |
| Model Definition / Policy / Capability semantics | `docs/model-definition-spec.md` + published Registry/contract evidence |
| Verified behavior | LifeSpace automated tests |

Do not copy these into this repository as editable canonical definitions.

## Compatibility baseline（兼容基线）

At repository bootstrap on **2026-09-05**, the observed LifeSpace baseline was Identity Application Contract `0.6.0` and Core Kernel `0.23.0`. Those numbers remain historical evidence only.

The current MCP query Projection Core alignment target is **Core Kernel `0.35.0`**. Relevant evolution includes:

- `0.33.0`: canonical structural `timeRanges` in progressive semantic detail;
- `0.34.0`: explicit Generic Query comparison semantics, envelope `createdAt` / `updatedAt`, and datetime local-date windows;
- `0.35.0`: grouped capability queries, beginning with preferred `calendar.window` viewing-window semantics.

`modelKey` is the sole ordinary-model Runtime address and canonical execution paths are `/api/v1/spaces/{spaceId}/models/{modelKey}/records/...`.

This repository does not silently follow every future Kernel revision. A future incompatible representation must be intentionally reviewed and covered by adapter tests before it becomes a declared compatibility target.

## Progressive Runtime Discovery（渐进式运行时发现）

For MCP and other context-sensitive protocol surfaces, the default coarse discovery source is:

```text
GET /api/v1/me/_discovery/inventory
```

The inventory preserves current Space/access edges while keeping model semantics compact. Once the adapter selects a model for the current tool surface, fetch only that model's static semantic detail through the inventory-published path template, currently:

```text
GET /api/v1/spaces/{spaceId}/_discovery/models/{modelKey}
```

The adapter must verify the selected detail's `(key, version, schemaHash)` against the inventory entry and fail closed on drift. One visible Space is sufficient to fetch the static detail; all readable Spaces from inventory remain distinct execution targets.

Full discovery surfaces remain available:

```text
GET /api/v1/me/_discovery
GET /api/v1/spaces/{spaceId}/_discovery
```

They are compatibility/fallback inputs, not the universal MCP `tools/list` source.

All Runtime Discovery responses are evaluated by LifeSpace using current authority state. The adapter must consume this projection rather than enumerate all published models or independently merge `/me/spaces` into an authorization result.

Runtime Discovery is not execution authorization. Revoked Membership, Grant, Delegation or Application access must still be denied by the subsequent canonical LifeSpace call even if a client holds stale discovery state.

A caller that already has an authorized `spaceId + modelKey` does not need Discovery merely to translate a model into another Runtime address. Discovery remains for capability projection and semantic selection, not route lookup.

## Generic Query and Time Semantics（通用查询与时间语义）

For Core Kernel `0.35.0`, MCP query projection consumes the semantic detail rather than reconstructing query names:

- `query.filters` supplies exact/non-comparable filter transport;
- `query.comparisons` supplies comparison field/source/value type plus concrete operator parameter names;
- only `transport: "explicit"` comparison parameters are emitted into new MCP Tool schemas; legacy `field`, `fieldFrom`, and `fieldTo` remain LifeSpace compatibility syntax rather than a new protocol surface;
- envelope `createdAt` / `updatedAt` are projected from `query.comparisons`, not invented locally;
- datetime `localDateWindow` parameters are passed through unchanged. The adapter does not convert local dates to UTC or implement DST rules;
- `query.capabilityQueries` becomes separate capability-query Tools when the semantics can be represented safely;
- generic and capability sort values come from semantic detail rather than field-name inference.

A capability query currently does not declare which generic filters/search facets are safely composable with it. Until LifeSpace publishes that metadata, the MCP projection must **fail closed by narrowing the capability Tool** to its declared capability parameters, semantic ordering and shared pagination; it must not guess that every generic filter can be mixed with the capability query.

## Ordinary Model Contract Revisions（普通模型契约修订）

Ordinary model CRUD/query/action syntax is intentionally absent from the handwritten Core Kernel OpenAPI. It belongs to immutable generated `mct_*` Model Contract Revisions.

Adapter rules:

- do not hand-author a second generic model API;
- use the active/selected Model Contract Revision as exact schema evidence when concrete request/response syntax is required beyond what progressive semantic detail explicitly publishes;
- do not assume one `mct_*` ID is globally identical across staging/production or independently evolved environments;
- do not use environment-local Registry version numbers as global semantic identity;
- preserve model `key`, `schemaHash` and contract metadata needed to prove compatibility;
- execute ordinary model operations through `/api/v1/spaces/{spaceId}/models/{modelKey}/records/...` rather than maintaining a modelKey-to-route translation table;
- treat any pre-#200 `route` found in historical immutable evidence only as historical representation, never as current Model identity;
- do not emit or depend on LifeSpace Core's fixed legacy compatibility aliases in new adapter configuration.

## Kernel vs Platform Admin（内核与平台管理）

Core/Identity Platform Admin companion contracts are privileged control-plane surfaces. They are not ordinary Agent-facing capability sources and are excluded from the default adapter surface.

A protocol adapter must never discover or expose platform-admin operations just because it can reach the same Worker host.

## Compatibility policy（兼容策略）

Each implemented adapter slice must declare:

1. minimum/supported Identity Application Contract version if Identity endpoints are consumed directly;
2. minimum/supported Core Kernel Contract version;
3. required Runtime Discovery features;
4. Model Contract features/annotations it can safely project;
5. explicit behavior when an upstream contract is newer or unsupported.

Prefer **fail closed（失败关闭）** for semantics the protocol adapter cannot safely represent. Hiding or narrowing an unsupported operation is safer than emitting a tool whose input/authorization/concurrency semantics are wrong.

Do not silently guess around unknown contract fields or strip security-relevant metadata.

## Testing contract assumptions（契约假设测试）

Tests in this repository must prove adapter behavior against explicit upstream contract assumptions.

Acceptable approaches include:

- minimal Synthetic Fixtures（合成夹具） that exercise a documented contract shape;
- generated fixtures pinned to an explicit public LifeSpace contract version/revision with provenance;
- integration tests against a dedicated test/staging environment when credentials are injected securely.

The MCP M0 fixtures are synthetic and model Core Kernel `0.35.0` progressive inventory/detail semantics. A fixture is test evidence, not a new canonical contract. If fixture and LifeSpace disagree, LifeSpace wins and the adapter must be updated.
