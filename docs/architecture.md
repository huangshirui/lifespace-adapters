# Architecture（架构）

## 1. Positioning（定位）

LifeSpace Adapters is an **Adapter（适配器）** layer, not a platform/domain layer.

Its responsibility is to translate canonical LifeSpace contracts into external protocol surfaces while preserving LifeSpace-owned semantics and authorization boundaries.

```text
Protocol Client / Agent
        │
        ▼
LifeSpace Adapter
        │
        ▼
LifeSpace canonical contracts
        │
        ▼
LifeSpace Core / Identity / Generic Runtime
```

The adapter can change protocol shape. It cannot change what the data means, who is authorized, or what a valid mutation is.

## 2. Ownership boundary（所有权边界）

| Concern | Owner |
| --- | --- |
| Global Identity（全局身份） | LifeSpace |
| Space / Membership / Data Grant（空间 / 成员 / 数据授权） | LifeSpace |
| Principal / Actor / Application Context（权限主体 / 执行者 / 应用上下文） | LifeSpace |
| Agent Delegation（Agent 委托） | LifeSpace |
| Model Definition / Registry / domain semantics（模型定义 / 注册表 / 领域语义） | LifeSpace |
| Effective capability pruning（有效能力裁剪） | LifeSpace Runtime Discovery |
| Time Semantics / Calendar semantics | LifeSpace |
| Mutation validation / Policy / concurrency（变更校验 / 策略 / 并发） | LifeSpace |
| Protocol session / transport | LifeSpace Adapters |
| LifeSpace -> protocol schema projection | LifeSpace Adapters |
| Protocol-specific naming / compatibility / error mapping | LifeSpace Adapters |

## 3. Runtime Discovery（运行时发现）

For dynamic protocol clients, the default architecture is **Progressive Runtime Discovery（渐进式运行时发现）**:

```text
GET /api/v1/me/_discovery/inventory
        │
        ├── current visible Spaces / access edges
        └── compact model identity/capability summaries
                │
                ▼
      select relevant model keys
                │
                ▼
GET /api/v1/spaces/{spaceId}/_discovery/models/{modelKey}
        │
        └── full static semantic detail only when needed
```

The cross-Space inventory remains a Core capability. Adapters must not re-create its authority semantics by fetching `/me/spaces` and independently merging every Space.

One readable Space can be used to fetch the static semantic body for a selected model. The adapter verifies `(key, version, schemaHash)` against inventory, while preserving every readable Space as a distinct execution target.

Full `/api/v1/me/_discovery` and `/api/v1/spaces/{spaceId}/_discovery` remain compatibility/fallback surfaces rather than the universal dynamic-client input.

The adapter consumes already-pruned discovery state. It must not recompute:

```text
credential scope
∩ Application × Model Access
∩ Space membership / Data Grant
∩ Agent Delegation when applicable
∩ published model/capability restrictions
```

That intersection belongs to LifeSpace Core.

Discovery remains a **capability preview（能力预览）**, not proof that a later call is authorized. Every execution goes through the canonical LifeSpace operation, where current authority, Policy（策略）, semantic validation and optimistic concurrency are rechecked.

## 4. Contract layers（契约层）

Adapters may consume three LifeSpace contract families:

1. Identity Application Contract（身份应用契约） for authentication/identity flows that a specific adapter actually needs;
2. Core Kernel Contract（核心内核契约） for Runtime Discovery and other explicitly supported Kernel operations;
3. immutable Model Contract Revision（不可变模型契约修订） for ordinary model CRUD/query/action syntax.

Platform Admin Contract（平台管理契约） is excluded from ordinary protocol discovery and ordinary Agent tool exposure.

The adapter repository does not maintain a copied canonical OpenAPI/JSON Schema set. Any cache/fixture used for testing must be clearly non-authoritative and tied to an explicit upstream contract version/revision.

For MCP M0, synthetic fixtures model Core Kernel `0.35.0` progressive semantic detail, including explicit Generic Query comparisons, envelope timestamps, local-date windows and grouped capability queries.

## 5. Protocol projection rules（协议投影规则）

A protocol adapter may:

- rename or group operations to fit protocol constraints;
- translate JSON Schema into a protocol-supported input schema subset;
- map protocol transport/session behavior to HTTP/API calls;
- normalize upstream errors into protocol-compatible errors while preserving machine-relevant cause;
- omit unsupported capabilities when it cannot represent them safely;
- perform deterministic ranking/top-K selection for context economy after LifeSpace has supplied the visible inventory.

A protocol adapter must not:

- create new authority from protocol metadata;
- convert hidden/unavailable operations into visible tools;
- weaken required semantic input or concurrency evidence;
- infer permissions from tool visibility alone;
- bypass canonical LifeSpace APIs or call storage directly;
- expose privileged platform-control operations through ordinary Agent discovery;
- reconstruct LifeSpace query parameter names, timezone conversion rules or cross-field semantics from naming conventions.

When upstream metadata describes a semantic capability but omits a composition rule needed by the target protocol, the adapter narrows or omits the protocol surface rather than guessing.

## 6. MCP M0 projection boundary（MCP M0 投影边界）

The first implementation slice deliberately separates **projection semantics** from **server runtime/transport**.

Implemented now:

```text
Progressive inventory/detail loader
        +
deterministic MCP query Tool schema projection
        +
canonical modelKey query request builder
```

Not implemented yet:

```text
MCP HTTP/server lifecycle
OAuth / credential acquisition
remote deployment runtime
actual tools/list + tools/call transport handlers
mutation/action projection
```

This split keeps the first code review focused on whether LifeSpace semantics are projected correctly before transport choices add more moving parts.

## 7. Principal / Actor / Application Context（主体 / 执行者 / 应用上下文）

The adapter must preserve these operation roles when they differ:

```text
principal          = whose authority is exercised
actor              = who/what executes or initiates
applicationContext = through which application context the operation occurs
```

For delegated Agent execution, the Adapter does not create the delegation and does not replace it with a broad service credential. It consumes a trusted execution context/credential that LifeSpace recognizes and lets LifeSpace perform current delegation checks.

## 8. Repository shape（仓库结构）

```text
adapters/
  mcp/
shared/
docs/
```

- `adapters/mcp/`: MCP-specific mapping, server/transport code, tests and packaging.
- `shared/`: only reusable adapter concerns, such as a typed LifeSpace client or deterministic projection helpers, once real reuse is proven.
- `docs/`: stable architecture and compatibility documentation.

There is intentionally no `domain/` package, platform migration layer or duplicated Registry.

## 9. Adjacent repositories（相邻仓库）

`lifespace-n8n-nodes` remains a separate Platform Integration（平台集成） repository. n8n node UX and credential integration have a different lifecycle from protocol adapters and should not be moved here simply for consolidation.

Applications such as ALOHA and HomeMew consume LifeSpace/adapter capabilities under their own Application Context and do not become submodules of this repository.
