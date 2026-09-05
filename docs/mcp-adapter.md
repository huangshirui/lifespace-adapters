# MCP Adapter（MCP 适配器）

## Goal（目标）

The MCP Adapter projects the current LifeSpace capability surface into MCP without turning MCP into a source of LifeSpace domain or authorization truth.

Its core invariant is:

> **MCP `tools/list` reflects the current LifeSpace-effective capability projection for the authenticated execution context, and MCP `tools/call` executes only through canonical LifeSpace operations.**

## Architecture（架构）

```text
MCP Client
   │
   ├── tools/list
   │      │
   │      ▼
   │  current LifeSpace Runtime Discovery
   │      +
   │  pinned immutable Model Contract evidence
   │      │
   │      ▼
   │  deterministic MCP Tool Projection
   │
   └── tools/call
          │
          ▼
      projected canonical operation binding
          │
          ▼
      LifeSpace canonical operation
          │
          ▼
      current authority + policy + validation recheck
```

No static all-platform tool catalog is maintained in this repository.

## Discovery mapping（发现映射）

Primary source:

```text
GET /api/v1/me/_discovery
```

Space-scoped source when needed:

```text
GET /api/v1/spaces/{spaceId}/_discovery
```

The adapter preserves Space Context（空间上下文）. If two Spaces expose the same model/action, the MCP representation retains an unambiguous target Space instead of silently unioning them into one authority-free operation.

M1 names each projected tool with a deterministic `ls.<spaceId>.<modelKey>.<operation>` namespace after MCP-safe validation. Tool names are protocol representation, not stable LifeSpace domain identifiers. If a name cannot be represented safely under the supported MCP constraints, projection fails closed instead of truncating into a potentially colliding name.

## Model Contract evidence（模型契约证据）

Runtime Discovery decides **what is currently visible**; an immutable `mct_*` Model Contract Revision supplies **the exact HTTP/JSON Schema syntax**.

M1 requires both. Before a model is projected, its discovered `key`, `route` and `schemaHash` must match the selected immutable Model Contract manifest. A mismatch is a compatibility failure, not an invitation to reconstruct syntax from field names.

The ordinary MCP runtime must not hold a privileged Model Admin credential merely to fetch schemas. Model Contract evidence is supplied through an explicit release/deployment input and conveys no execution authority.

## Tool input mapping（工具输入映射）

M1 keeps canonical LifeSpace JSON request bodies intact under one MCP `input` argument instead of rewriting arbitrary generated JSON Schema into a second adapter-owned shape.

This is deliberate because generated contracts may contain `allOf` / `oneOf`, Capability-specific schema composition and `x-lifespace-*` annotations. The adapter materializes local OpenAPI `$ref` references so each MCP input schema is self-contained while preserving those semantics.

Path/query arguments remain ordinary MCP arguments. The target `spaceId` is fixed into the projected internal binding and is not accepted from the tool caller. This prevents a tool discovered for one Space from being redirected to another Space by changing an argument.

For Actions and updates, concurrency evidence remains exactly where the Model Contract defines it. Properties marked `x-lifespace-input-role: concurrency` are preserved rather than being dropped or reclassified as business semantics.

## Execution mapping（执行映射）

M1 implements deterministic construction of the canonical LifeSpace request shape:

- HTTP method comes from the selected Model Contract operation;
- fixed Space path parameters come from the projection binding;
- record/path parameters come from MCP arguments;
- repeatable query arrays remain repeatable and ordered;
- the MCP `input` object becomes the canonical JSON request body unchanged.

M1 stops before network execution. The next layer must send this request through the authoritative LifeSpace API using the real current execution credential and must not add independent authorization logic.

## Authorization boundary（授权边界）

The adapter does not calculate effective permission itself.

LifeSpace discovery and execution remain authoritative for:

- credential scope;
- Application × Model Access;
- Space Membership / Data Grant;
- Agent Delegation;
- Model / Capability restrictions;
- record-level Policy;
- current revocation state.

A stale MCP tool list can therefore contain an operation that later fails after authority changes. This is correct: execution-time authorization is authoritative.

## Credential model（凭据模型）

The MCP Adapter must operate with credentials corresponding to the real current execution context.

It must not:

- use a permanent platform administrator credential as a shortcut for user actions or schema discovery;
- mint user authority locally;
- accept client-supplied Principal/Grant/Scope values as proof;
- log bearer tokens or delegated execution tokens;
- persist reusable user credentials unless an explicit secure credential architecture is separately approved.

For a User represented by an Agent, current LifeSpace Delegation（委托） semantics and Actor attribution must be preserved.

## Platform Admin exclusion（平台管理排除）

Platform Admin / Console control-plane operations are out of scope for the ordinary MCP Adapter.

They must not appear in `tools/list` and must not be callable through generic fallback routing. M1 only projects model operations reachable through a currently discovered model plus its matching Model Contract route.

## Protocol surface（协议表面）

MCP-specific concerns may include:

- server capabilities and lifecycle;
- Streamable HTTP transport;
- tool names/descriptions/input schema;
- protocol-compatible error objects;
- optional resources/prompts only if a real LifeSpace use case requires them.

Do not expose MCP Resources / Prompts simply for completeness.

The protocol implementation target after M1 is the official MCP TypeScript SDK v2 / MCP 2026-07-28 line. M1 intentionally has no SDK dependency so the projection invariant can be tested independently of transport/runtime choices.

## Confirmation and model behavior（确认与模型行为）

MCP descriptions and model instructions are UX/behavior guidance, not authorization or confirmation enforcement.

If a consuming product such as ALOHA requires explicit confirmation for high-impact actions, that confirmation belongs to the trusted owning product/control layer and/or downstream governed operation, not to a prompt sentence inside this adapter.

## Milestones（里程碑）

### M1 — Tool Projection Core（工具投影核心） — implemented on development branch

- current Discovery + pinned `mct_*` evidence -> MCP tool definitions;
- per-Space binding;
- canonical request construction;
- fail-closed compatibility checks;
- synthetic positive/deny/compatibility tests.

### M2 — MCP v2 Transport + LifeSpace Client（MCP v2 传输 + LifeSpace 客户端）

- official MCP TypeScript SDK v2;
- stateless Streamable HTTP entry;
- `tools/list` connected to live Runtime Discovery;
- `tools/call` connected to canonical LifeSpace HTTP execution;
- credential propagation without logging/persistence;
- upstream error -> MCP error mapping.

### M3 — Auth/Deployment Acceptance（认证 / 部署验收）

- select deployment runtime;
- define real MCP client authentication / LifeSpace execution-token acquisition path;
- live tests for two different authority contexts, revocation/stale tool denial and Agent Delegation narrowing;
- public-repository and credential-leak safety pass.

## Acceptance（验收）

Before the MCP Adapter is considered fully implemented, tests must demonstrate at least:

1. different authenticated contexts receive different tool surfaces when LifeSpace discovery differs;
2. Space boundaries are preserved;
3. Agent Delegation narrowing affects visible/callable capabilities through LifeSpace;
4. a tool removed by current authorization cannot execute even if the client has stale discovery data;
5. action semantic input and concurrency evidence remain aligned with the immutable Model Contract;
6. unsupported or mismatched contract metadata fails closed;
7. no platform-admin operation is exposed;
8. credentials and sensitive data are absent from logs/errors/fixtures.
