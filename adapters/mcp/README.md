# MCP Adapter

This directory owns the concrete MCP（Model Context Protocol，模型上下文协议） adapter for LifeSpace.

Current status: **M1 Tool Projection Core implemented; protocol transport not implemented yet**.

The adapter must:

- derive visible MCP capabilities from current LifeSpace Runtime Discovery（运行时发现）;
- preserve Space Context（空间上下文）;
- execute only through canonical LifeSpace operations;
- preserve Principal / Actor / Application Context（权限主体 / 执行者 / 应用上下文） semantics;
- fail closed when LifeSpace contract semantics cannot be represented safely;
- never expose Platform Admin（平台管理） control-plane operations through ordinary Agent discovery.

## M1 implementation

`src/projection.js` consumes:

1. the current already-pruned Runtime Discovery result for the authenticated execution context; and
2. one explicit immutable Model Contract Revision（不可变模型契约修订） used as exact OpenAPI/JSON Schema evidence.

It produces MCP tool definitions plus internal canonical-operation bindings. Space identity is fixed into each binding, so two Spaces exposing the same model remain distinct MCP capabilities.

`src/request.js` converts one projected binding plus validated MCP arguments into the canonical LifeSpace HTTP method/path/query/body structure. It does not send HTTP or hold credentials.

Synthetic tests live under `test/`. Run them from the repository root:

```bash
npm test
```

The M1 projection core deliberately has no external runtime dependency. The next milestone will wire it to the official MCP v2 server SDK and Streamable HTTP without moving LifeSpace authorization/domain rules into this repository.

See [`../../docs/mcp-adapter.md`](../../docs/mcp-adapter.md) before adding implementation.

Do not add a local domain model, permission database, copied Model Registry or direct D1 access here.
