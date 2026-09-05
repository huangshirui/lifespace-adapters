# schemas/v0.1

AISR Atlas V0.1 的机器可读 Schema 目录。

当前先冻结领域需求，下一步在这里定义至少以下 Schema：

- `workspace.schema.json`
- `unit.schema.json`
- `relationship.schema.json`
- `facet.schema.json`
- `draft.schema.json`
- `revision.schema.json`
- `layout.schema.json`
- `runtime-state.schema.json`
- `work-state.schema.json`

Schema 设计必须遵守 `docs/domain-model-v0.1.md` 和 `docs/versioning-and-layout-v0.1.md` 中的不变量（Invariants）。

V0.1 的首轮 Schema 不应提前引入跨 Workspace 关系、多 Draft 分支或跨 Revision Layout 迁移。
