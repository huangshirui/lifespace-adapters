# MCP Adapter（MCP 适配器）

## Goal（目标）

The MCP Adapter projects the current LifeSpace capability surface into MCP without turning MCP into a source of LifeSpace domain or authorization truth.

Its first invariant is:

> **MCP `tools/list` reflects the current LifeSpace-effective capability projection for the authenticated execution context, and MCP `tools/call` executes only through canonical LifeSpace operations.**

## Initial scope（首期范围）

The first implementation should prove the smallest useful loop:

```text
MCP Client
   │
   ├── tools/list
   │      │
   │      ▼
   │  LifeSpace Runtime Discovery
   │
   └── tools/call
          │
          ▼
      canonical LifeSpace operation
          │
          ▼
      authoritative recheck + execution
```

No static all-platform tool catalog should be maintained in this repository.

## Discovery mapping（发现映射）

Primary source:

```text
GET /api/v1/me/_discovery
```

Space-scoped source when needed:

```text
GET /api/v1/spaces/{spaceId}/_discovery
```

The adapter must preserve Space Context（空间上下文）. If two Spaces expose the same model/action, the resulting MCP representation must still retain an unambiguous target Space rather than silently unioning them into one authority-free operation.

Exact MCP tool naming and grouping will be chosen during implementation and covered by deterministic tests. Tool names are protocol representation, not stable LifeSpace domain identifiers.

## Execution mapping（执行映射）

For ordinary models, the adapter uses Runtime Discovery plus the relevant immutable Model Contract Revision to determine the canonical request shape.

Rules:

- semantic Action input remains distinct from technical concurrency metadata;
- required optimistic-concurrency evidence must not be dropped merely because MCP prefers a simpler input schema;
- server defaults remain server-owned; the adapter must not pre-fill values in a way that changes omission semantics;
- relation/cardinality semantics come from LifeSpace contract metadata rather than field-name guesses;
- unsupported or ambiguous contract features fail closed instead of being approximated unsafely.

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

The MCP Adapter must operate with credentials that correspond to the real current execution context.

It must not:

- use a permanent platform administrator credential as a shortcut for user actions;
- mint user authority locally;
- accept client-supplied Principal/Grant/Scope values as proof;
- log bearer tokens or delegated execution tokens;
- persist reusable user credentials unless an explicit secure credential architecture is separately approved.

For a User represented by an Agent, current LifeSpace Delegation（委托） semantics and Actor attribution must be preserved.

## Platform Admin exclusion（平台管理排除）

Platform Admin / Console control-plane operations are out of scope for the ordinary MCP Adapter.

They must not appear in `tools/list` and must not be callable through generic fallback routing.

## Protocol surface（协议表面）

MCP-specific concerns may include:

- server capabilities and lifecycle;
- transport/session behavior;
- tool names/descriptions/input schema;
- protocol-compatible error objects;
- optional resources/prompts only if a real LifeSpace use case requires them.

Do not expose MCP Resources / Prompts simply for completeness. The initial adapter should implement only the protocol features required to prove dynamic capability discovery and safe execution.

## Confirmation and model behavior（确认与模型行为）

MCP descriptions and model instructions are UX/behavior guidance, not authorization or confirmation enforcement.

If a consuming product such as ALOHA requires explicit confirmation for high-impact actions, that confirmation belongs to the trusted owning product/control layer and/or downstream governed operation, not to a prompt sentence inside this adapter.

## First implementation acceptance（首期验收）

Before the MCP Adapter is considered implemented, tests should demonstrate at least:

1. different authenticated contexts receive different tool surfaces when LifeSpace discovery differs;
2. Space boundaries are preserved;
3. Agent Delegation narrowing affects visible/callable capabilities through LifeSpace;
4. a tool removed by current authorization cannot execute even if the client has stale discovery data;
5. action semantic input and concurrency evidence are mapped correctly;
6. unsupported contract metadata fails closed;
7. no platform-admin operation is exposed;
8. credentials and sensitive data are absent from logs/errors/fixtures.

Deployment runtime and MCP transport are intentionally not fixed by this bootstrap document. Select them when implementation requirements are concrete.
