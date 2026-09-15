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
| Canonical Query semantics | `docs/canonical-query.md` + generated `query.canonical` semantic detail |
| Verified behavior | LifeSpace automated tests |

Do not copy these into this repository as editable canonical definitions.

## Compatibility baseline（兼容基线）

At repository bootstrap on **2026-09-05**, the observed LifeSpace baseline was Identity Application Contract `0.6.0` and Core Kernel `0.23.0`. Those numbers remain historical evidence only.

The MCP query Projection Core originally aligned to the first `query.canonical` descriptor shipped around Core Kernel `0.36.0`. The current alignment target is the **current Canonical Query descriptor** after the composition correction represented by LifeSpace PR #242:

- Canonical invocation is `POST /api/v1/spaces/{spaceId}/models/{modelKey}/records/query`;
- Search and Filter are parallel candidate-selection facets combined by intersection;
- Sort applies after candidate selection;
- Pagination uses the opaque cursor contract;
- typed filter targets/operators and temporal range operands remain owned by LifeSpace.

The adapter does not infer a Kernel version number for this semantic correction. It consumes the descriptor shape actually published by the compatible LifeSpace deployment and fails closed when required semantics are missing or unsupported.

`modelKey` remains the sole ordinary-model Runtime address and canonical execution paths are `/api/v1/spaces/{spaceId}/models/{modelKey}/records/...`.

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

They are fallback inputs, not the universal MCP `tools/list` source.

All Runtime Discovery responses are evaluated by LifeSpace using current authority state. The adapter must consume this projection rather than enumerate all published models or independently merge `/me/spaces` into an authorization result.

Runtime Discovery is not execution authorization. Revoked Membership, Grant, Delegation or Application access must still be denied by the subsequent canonical LifeSpace call even if a client holds stale discovery state.

## Canonical Query and Time Semantics（统一查询与时间语义）

MCP query projection consumes `query.canonical` rather than reconstructing legacy transport parameters.

Required semantic inputs are:

- `invocation`: the canonical structured POST query operation;
- `composition`: Search + Filter candidate selection by intersection, followed by Sort and cursor Pagination;
- `search`: whether keyword Search exists and its bounds;
- `filter.targets`: fields, semantic kinds, value types, allowed operators, nullability and any current-actor aliases;
- `sort`: fields, directions, maximum criteria, NULL-last behavior and stable tie-breaking;
- `pagination`: bounded limit and opaque cursor behavior.

The protocol projection is intentionally smaller than the Core contract:

```text
MCP Agent input
  search: string
  filters[]: simple typed predicates combined with AND
  sort[]
  limit
  cursor
  advancedFilter: optional nested Canonical Filter AST
        ↓ deterministic lowering
LifeSpace Canonical Query
  search: { text }
  filter: Predicate | AND/OR AST
  sort
  page
```

Rules:

- `filters[]` and `advancedFilter` are mutually exclusive;
- multiple simple filters compile to `{ and: [...] }`;
- `advancedFilter` is reserved for genuinely nested Boolean logic and is not the default Agent schema;
- `local_date_window`, `date` and `instant` range operands are forwarded unchanged; Core alone owns IANA-timezone and DST conversion;
- adapters do not expose Standard Query / Capability Query modes;
- legacy `query.filters`, `query.comparisons`, and `query.capabilityQueries` do not create parallel MCP tools.

This protocol simplification is not a second semantic query language. Every accepted MCP argument deterministically maps to the same Canonical Query contract owned by LifeSpace.

## Ordinary Model Contract Revisions（普通模型契约修订）

Ordinary model CRUD/query/action syntax is intentionally absent from the handwritten Core Kernel OpenAPI. It belongs to immutable generated `mct_*` Model Contract Revisions.

Adapter rules:

- do not hand-author a second generic model API;
- use the active/selected Model Contract Revision as exact schema evidence when concrete request/response syntax is required beyond what progressive semantic detail explicitly publishes;
- do not assume one `mct_*` ID is globally identical across staging/production or independently evolved environments;
- do not use environment-local Registry version numbers as global semantic identity;
- preserve model `key`, `schemaHash` and contract metadata needed to prove compatibility;
- execute ordinary model operations through `/api/v1/spaces/{spaceId}/models/{modelKey}/records/...` rather than maintaining a modelKey-to-route translation table;
- treat historical `route` values only as historical representation, never as current Model identity;
- do not emit or depend on LifeSpace Core's fixed legacy compatibility aliases in new adapter configuration.

## Kernel vs Platform Admin（内核与平台管理）

Core/Identity Platform Admin companion contracts are privileged control-plane surfaces. They are not ordinary Agent-facing capability sources and are excluded from the default adapter surface.

A protocol adapter must never discover or expose platform-admin operations just because it can reach the same Worker host.

## Compatibility policy（兼容策略）

Each implemented adapter slice must declare:

1. minimum/supported Identity Application Contract version if Identity endpoints are consumed directly;
2. required Core semantic/contract features;
3. required Runtime Discovery features;
4. Model Contract features/annotations it can safely project;
5. explicit behavior when an upstream contract is newer or unsupported.

Prefer **fail closed（失败关闭）** for semantics the protocol adapter cannot safely represent. Hiding or narrowing an unsupported operation is safer than emitting a tool whose input/authorization/concurrency semantics are wrong.

The current MCP query adapter has no production compatibility obligation to the earlier recursive-filter Tool schema or legacy Capability Query surface. It cuts directly to the accepted Agent-friendly projection and rejects unsupported descriptor shapes rather than maintaining parallel modes.

## Testing contract assumptions（契约假设测试）

Tests in this repository must prove adapter behavior against explicit upstream contract assumptions.

Acceptable approaches include:

- minimal Synthetic Fixtures（合成夹具） that exercise a documented contract shape;
- generated fixtures pinned to an explicit public LifeSpace contract/revision with provenance;
- integration tests against a dedicated test/staging environment when credentials are injected securely.

The MCP fixtures are synthetic and model the current Progressive Discovery + Canonical Query composition semantics. A fixture is test evidence, not a new canonical contract. If fixture and LifeSpace disagree, LifeSpace wins and the adapter must be updated.