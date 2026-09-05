# packages/domain

AISR Atlas 的核心领域模型（Domain Model）与规则层。

V0.1 计划包含：

- Workspace（工作区）；
- Unit（单元）；
- Type（类型）；
- Containment（包含关系）；
- Relationship（关系）；
- Facet（侧面）；
- Draft / Revision / Diff / Change Log；
- Layout / View 边界；
- Definition / Runtime State / Work State 三分法；
- V0.1 Invariants（不变量）与校验。

任何 Web、API、MCP 或 Adapter 都不应绕过这里的领域规则直接修改系统语义。
