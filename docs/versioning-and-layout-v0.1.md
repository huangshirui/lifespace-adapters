# V0.1 版本、草稿与布局规则

## 1. 三层分离

AISR Atlas V0.1 必须严格区分三类数据：

### 1.1 规范模型（Canonical Model）

回答：**系统是什么？**

包括 Unit、Type、Containment、Relationship 以及定义性 Facet / 属性。

### 1.2 视图 / 布局状态（View / Layout State）

回答：**当前怎么看、画在哪里？**

包括：

- `x / y`
- `width / height`
- `collapsed`
- `viewport`
- 其他纯展示状态

### 1.3 动态 / 工作状态（Dynamic / Work State）

回答：**系统现在怎么样、谁正在做什么？**

包括 Runtime、Health、Deployment、Alert、Incident、Issue、PR、Human / AI Work Session 等高频变化。

## 2. 三条硬规则

> **Model answers what the system is.**  
> 模型（Model）决定系统是什么。

> **Layout answers where it is drawn.**  
> 布局（Layout）决定画在哪里。

> **View answers what the user wants to see.**  
> 视图（View）决定当前看什么。

以及：

> **Position is not semantics.**  
> 位置不是语义。

## 3. Canvas 拖动规则

Canvas 上的普通拖动只修改 Layout。

不得因为以下行为隐式改变 Canonical Model：

- 把 Unit 拖进另一个大框；
- 把两个 Unit 拖近；
- 调整 Unit 大小；
- 展开 / 折叠；
- 改变 Zoom / Viewport。

如果要修改 Parent / Containment、Relationship、Type 或定义性属性，必须走显式语义修改操作。

## 4. Parent 与视觉容器

虽然“视觉位置不决定语义”，但为了避免图看起来与模型矛盾，V0.1 约束：

- Child Unit 只能在 Parent 的视觉容器内移动；
- Child 超出可用空间时，Parent 视觉容器自动扩展；
- 移动 Parent 时，Child 作为整体随 Parent 移动；
- Child 的位置优先保存为相对 Parent 的坐标。

## 5. Draft 模型

每个 Workspace 同时只有：

```text
Published Revision N
        │
        ▼
Current Draft
```

Draft 是一个可变工作副本。

人或 AI 可以多次修改 Draft：

```text
Published Revision 18
        │
        ▼
Draft
  change A
  change B
  change C
        │
        ▼
Publish
        │
        ▼
Published Revision 19
```

`change A/B/C` 不分别产生正式 Revision。

## 6. Change Log 与 AI 上下文

Draft 持续记录 Change Log（变更日志），但 **Change Log 不属于 AI 每次读取 Draft 时的默认负载**。

默认读取：

```text
Workspace
Current Draft（最新完整状态）
```

按需读取：

```text
Draft Change Log
Published ↔ Draft Diff
Revision A ↔ Revision B Diff
```

这样既保留可追溯性，也避免历史变更持续占用 AI 上下文。

## 7. Publish 规则

V0.1 不做复杂审批流。

Publish 的唯一硬要求：**必须来自用户明确指令。**

允许：

- 用户在 Web 点击“发布”；
- 用户在 ChatGPT / 其他 AI 中明确说“发布当前草稿”，AI 再调用 MCP / Tool 执行 Publish。

不允许：

- AI 根据自己的判断自动发布；
- Adapter / Automation 在没有用户明确授权的情况下发布定义性模型。

## 8. Revision

Published Revision 是不可静默覆盖的正式系统版本。

至少应保留：

```yaml
revision_id:
parent_revision:
actor:
timestamp:
source:
rationale:
change_set:
```

支持比较：

- Published Revision A ↔ Published Revision B；
- Published Revision ↔ Current Draft。

## 9. Default / Personal Layout

每个 Revision 独立拥有：

```text
Revision N
├── Default Layout
└── Personal Layout(s)
```

### 默认布局（Default Layout）

- 新 Revision 的初版 Default Layout 可以由 AI 生成；
- 人和 AI 都可以修改；
- 只有显式“保存为默认布局”才更新 Default Layout。

### 个人布局（Personal Layout）

- 普通用户拖动优先修改 Personal Layout；
- 可以一键恢复为 Default Layout；
- 不影响 Canonical Model。

## 10. Layout 与 Revision 绑定

Layout 必须绑定具体 Revision。

V0.1 明确不实现 Revision 间布局迁移：

```text
Revision 18 / Layout 18
Revision 19 / Layout 19
```

Revision 19 不要求智能继承 Revision 18 的个人布局。这样先保证模型和行为简单、可预测。

## 11. Dynamic / Work State

以下变化不产生 Definition Revision：

- CPU / 延迟 / 错误率变化；
- Running → Degraded → Running；
- Alert / Incident；
- 部署状态；
- 开发进度；
- Issue / PR 状态；
- AI 开始或结束 Work Session。

使用 Event（事件）、Snapshot（快照）、Timeline（时间线）保存历史。
