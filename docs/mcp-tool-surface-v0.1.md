# V0.1 MCP / Tool 能力边界

## 1. 目标

AISR Atlas 的 AI 能力不绑定某个聊天产品。ChatGPT、其他 Agent 或自动化系统应通过 MCP / Tool（模型上下文协议 / 工具）读取和修改 Atlas。

AI 不需要“看图识图”，而应直接读取结构化的 Canonical System Graph（规范系统图谱）。

## 2. 默认读取原则

AI 默认读取**最新 Draft（草稿）的当前完整状态**，而不是每次同时加载完整 Change Log（变更日志）和全部历史 Revision（修订版本）。

需要追溯时，AI 再主动查询：

- Draft Change Log；
- Published ↔ Draft Diff；
- Revision ↔ Revision Diff；
- 某 Unit 的历史变化。

## 3. V0.1 建议的查询能力（Query）

命名仅作为设计方向，最终 API / MCP Schema 在后续阶段确定。

```text
list_workspaces
get_workspace
get_current_draft
get_published_revision
get_unit
list_children
list_relationships
get_unit_facets
get_default_layout
get_personal_layout
get_runtime_state
get_work_state
get_draft_diff
get_change_log
compare_revisions
```

查询应支持按稳定 Unit ID 定位，例如：

```text
aloha.gateway
lifespace.identity
```

## 4. V0.1 建议的修改能力（Mutation）

### 定义性修改（写入 Draft）

```text
create_unit
update_unit
remove_unit
change_parent
create_relationship
update_relationship
remove_relationship
update_declared_facet
```

### Layout 修改

```text
update_default_layout
update_personal_layout
reset_personal_layout_to_default
```

### Runtime / Work State 修改

```text
update_runtime_state
append_runtime_event
update_work_state
append_work_event
```

### 发布

```text
publish_draft
```

## 5. Publish 安全约束

`publish_draft` 可以作为 Tool 暴露，但调用必须基于用户明确的发布意图。

允许：

> “这个草稿可以了，发布。”

不允许：

> AI 认为修改合理，于是自行 Publish。

产品内 V0.1 不需要复杂审批工作流；这是一条工具调用权限与 Agent 行为约束。

## 6. 修改结果应返回什么

所有定义性 Mutation 至少返回：

- 修改后的 Draft 标识；
- 受影响的 Unit / Relationship ID；
- 本次结构化 Change（变更摘要）；
- 必要时返回校验错误。

AI 不应依赖重新解析整张画布来确认变更结果。

## 7. Change Log

Draft 的每次定义性修改应形成 Change Log 条目，但 Tool 不需要在普通 `get_current_draft` 中默认携带全部日志。

Change Log 至少需要能够表达：

```text
actor
source
timestamp
operation
target
before
after
```

## 8. Actor 与 Source

MCP / Tool 写入时需要保留可归因信息（Attribution）：

- Actor（操作者）：Human、ChatGPT、其他 AI / Agent、Automation 等；
- Source（来源）：具体会话、客户端、集成或 API 来源。

V0.1 先保证可记录，不要求做复杂权限矩阵。

## 9. 不做

V0.1 MCP / Tool 不承担：

- 跨 Workspace 操作关系；
- 多 Draft 分支合并；
- 自动审批；
- AI 自主发布；
- GitHub / Cloudflare 等 Adapter 的全部自动化能力。
