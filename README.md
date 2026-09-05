# LifeSpace Adapters

LifeSpace Adapters is the **protocol adaptation layer（协议适配层）** for LifeSpace.

It turns canonical LifeSpace contracts and current Runtime Discovery（运行时发现） results into protocol-specific surfaces without duplicating LifeSpace domain semantics or authorization logic.

The first adapter is MCP（Model Context Protocol，模型上下文协议）.

## What this repository owns（本仓库负责什么）

- protocol-specific server / transport / session behavior;
- deterministic projection from LifeSpace discovery/contracts into protocol schemas;
- protocol-specific compatibility, naming and error mapping;
- adapter-local tests and deployable packaging;
- small shared helpers that remain adapter concerns.

## What this repository does not own（本仓库不负责什么）

The following remain authoritative in [`huangshirui/LifeSpace`](https://github.com/huangshirui/LifeSpace):

- Identity（身份）;
- Space / Membership / Data Grant（空间 / 成员关系 / 数据授权）;
- Principal / Actor / Application Context（权限主体 / 执行者 / 应用上下文）;
- Agent Delegation（Agent 委托）;
- Shared Reality（共享现实） domain models;
- Model Definition / Registry / Model Contract（模型定义 / 注册表 / 模型契约）;
- Runtime Discovery（运行时发现） and current effective capability pruning;
- Policy（策略）, validation, optimistic concurrency and governed Change（受治理变更）.

This repository must not access LifeSpace databases directly or become a second source of truth for those concerns.

## Architecture（架构）

```text
Agent / AI Client / Protocol Client
                │
                ▼
       LifeSpace Adapters
       ├── MCP
       └── future protocols
                │
                ▼
       Canonical LifeSpace APIs
       + Runtime Discovery
       + Model Contract Revision
                │
                ▼
             LifeSpace
```

For dynamic clients, LifeSpace provides both current-subject and Space-scoped Runtime Discovery:

```text
GET /api/v1/me/_discovery
GET /api/v1/spaces/{spaceId}/_discovery
```

The adapter projects the already-authorized current capability surface. It does **not** independently recompute Membership / Grant / Delegation / Policy intersections, and execution still goes back through LifeSpace for authoritative checks.

## Repository layout（仓库结构）

```text
adapters/
  mcp/              MCP-specific implementation and tests
shared/             protocol-agnostic adapter helpers only
docs/
  architecture.md
  lifespace-contract-consumption.md
  mcp-adapter.md
  github-hardening.md
```

`shared/` is deliberately not a domain layer. If a concept belongs to LifeSpace semantics or authorization, it belongs in LifeSpace rather than here.

## Current status（当前状态）

The repository has entered **MCP Adapter M1: Tool Projection Core（MCP 工具投影核心）**.

Implemented in M1:

- deterministic projection from current LifeSpace Runtime Discovery plus one pinned immutable Model Contract Revision into per-Space MCP tool definitions;
- exact preservation of Model Contract JSON request schemas, including concurrency annotations and complex JSON Schema composition;
- deterministic binding from projected tool arguments to canonical LifeSpace HTTP method/path/query/body structure;
- fail-closed behavior for missing/mismatched Model Contract evidence, unsupported references and unsafe tool names;
- tests covering authority-driven visibility changes, Space separation, stale capability removal, Platform Admin exclusion and request construction.

Not implemented yet:

- MCP Streamable HTTP server/transport;
- MCP authorization handshake / credential acquisition;
- live LifeSpace HTTP execution;
- deployment runtime.

M1 intentionally does not use a privileged Model Admin credential at runtime. A deployable adapter must receive explicit immutable `mct_*` evidence through its release/deployment input and use the caller's real LifeSpace execution context for discovery and execution.

Run the current adapter tests with:

```bash
npm test
```

## Documentation（文档）

- [Architecture and ownership boundary](docs/architecture.md)
- [LifeSpace contract consumption](docs/lifespace-contract-consumption.md)
- [MCP adapter boundary and milestones](docs/mcp-adapter.md)
- [GitHub public-repository hardening](docs/github-hardening.md)

## License（许可）

LifeSpace Adapters is licensed under **GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`)**.

Copyright (C) 2026 Shirui Huang.

See [`LICENSE`](LICENSE) for the full license text.

## Security（安全）

This is a Public Repository（公开仓库）. Do not commit real user data, credentials, production/staging payloads, private infrastructure metadata, or non-public connector/tool output.

Sensitive vulnerabilities must not be reported through public Issue / PR content. See [`SECURITY.md`](SECURITY.md) and [`AGENTS.md`](AGENTS.md).
