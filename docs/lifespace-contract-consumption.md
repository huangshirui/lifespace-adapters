# LifeSpace Contract Consumption（LifeSpace 契约消费规则）

## Purpose（目的）

LifeSpace Adapters consumes LifeSpace contracts; it does not redefine them.

This document records how adapter code binds to canonical LifeSpace contract sources and how compatibility is handled without creating a second source of truth.

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

## Current compatibility observation（当前兼容基线）

At MCP Adapter M1 start on **2026-09-05**, the current LifeSpace contract strategy documents:

- Identity Application Contract: `0.6.0`;
- Core Kernel Contract: `0.24.0`;
- cross-Space Runtime Discovery introduced in Core Kernel `0.18.0`;
- Action semantic input / concurrency separation introduced in `0.20.0`;
- canonical field title / ordered repeatable sort metadata introduced in `0.22.0`;
- relation-target lookup introduced in `0.23.0`;
- authorized `spaceName` Runtime Context Projection introduced in `0.24.0`.

These are observed integration facts, not permission to silently follow every future contract. Each adapter release must declare and test the upstream features it depends on.

## Runtime Discovery（运行时发现）

Current effective capability projection comes from LifeSpace Core:

```text
GET /api/v1/me/_discovery
  -> all currently reachable source Spaces that have at least one effective model capability

GET /api/v1/spaces/{spaceId}/_discovery
  -> effective model/query/action metadata for one known Space
```

Both are evaluated by LifeSpace using current authority state. The adapter consumes this projection rather than enumerating every published model or independently merging `/me/spaces` into an authorization result.

The cross-Space response preserves Space boundaries. The adapter must keep the target Space unambiguous in every projected protocol capability.

Runtime Discovery is not execution authorization. Revoked Membership, Grant, Delegation or Application access must still be denied by the subsequent canonical LifeSpace call even when a client holds stale discovery state.

## Ordinary Model Contract Revisions（普通模型契约修订）

Ordinary model CRUD/query/action syntax is intentionally absent from the handwritten Core Kernel OpenAPI. It belongs to immutable generated `mct_*` Model Contract Revisions.

Adapter rules:

- do not hand-author a second generic model API;
- use the active/selected Model Contract Revision as exact schema evidence when concrete request/response syntax is required;
- do not assume one `mct_*` ID is globally identical across staging/production or independently evolved environments;
- do not use environment-local Registry version numbers as global semantic identity;
- preserve model `key`, `route`, `schemaHash` and contract metadata needed to prove compatibility.

### Contract evidence acquisition（契约证据获取）

MCP Adapter M1 deliberately separates **runtime authority** from **immutable contract evidence**.

Current LifeSpace reads of the active/full Model Contract live on the service-only Model Admin surface. The ordinary MCP adapter must therefore **not** acquire a permanent `models:manage` / platform-admin credential merely to learn schemas.

For the deployable adapter, immutable Model Contract evidence must instead be supplied through a deliberate build/release/deployment input, for example a reproducible LifeSpace contract artifact or selected `mct_*` snapshot. Runtime Discovery and execution use the real caller/delegated execution credential; the pinned contract artifact is schema evidence only and conveys no authority.

Before exposing a discovered model, the adapter compares at least its `key`, `route` and `schemaHash` with the pinned immutable evidence. A mismatch fails closed. This prevents a stale adapter build from guessing around a newly changed model contract.

## Kernel vs Platform Admin（内核与平台管理）

Core/Identity Platform Admin companion contracts are privileged control-plane surfaces. They are not ordinary Agent-facing capability sources and are excluded from the default adapter surface.

A protocol adapter must never discover or expose platform-admin operations just because such endpoints exist in an upstream contract artifact or on the same Worker host.

## Compatibility policy（兼容策略）

Each adapter release should declare:

1. minimum/supported Identity Application Contract version if Identity endpoints are consumed directly;
2. minimum/supported Core Kernel Contract version;
3. required Runtime Discovery features;
4. Model Contract features/annotations it can safely project;
5. explicit behavior when an upstream contract is newer or unsupported.

Prefer **fail closed（失败关闭）** for semantics the protocol adapter cannot safely represent. Hiding an unsupported operation is safer than emitting a tool whose input/authorization/concurrency semantics are wrong.

Do not silently guess around unknown contract fields or strip security-relevant metadata.

## Testing contract assumptions（契约假设测试）

Tests in this repository prove adapter behavior against explicit upstream contract assumptions using Synthetic Fixtures（合成夹具） only.

M1 tests cover:

- different current Discovery access producing different MCP tool surfaces;
- preservation of Space boundaries;
- removal of stale capabilities from a fresh projection;
- exact Model Contract schema materialization including complex JSON Schema composition and concurrency annotations;
- fail-closed contract mismatch/missing-reference behavior;
- Platform Admin exclusion;
- deterministic request construction for path/query/body semantics.

A fixture is test evidence, not a new canonical contract. If a fixture and LifeSpace disagree, LifeSpace wins and the adapter must be updated.
