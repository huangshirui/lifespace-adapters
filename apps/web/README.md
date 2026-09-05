# apps/web

面向人的 AISR Atlas Web 客户端。

V0.1 计划职责：

- Workspace（工作区）选择；
- Canvas（画布）渲染；
- Unit（单元）层级展开 / 折叠；
- Relationship（关系）展示；
- Default / Personal Layout（默认 / 个人布局）；
- Architecture / Development / Runtime / Operations 等 View（视图）切换；
- Draft（草稿）与 Published Revision（已发布修订版本）查看；
- Diff（差异）查看与显式 Publish（发布）。

当前实现方向：React + React Flow。

重要：Web 只负责呈现和交互，不得通过 XY 坐标推导或隐式修改 Canonical Model（规范模型）。
