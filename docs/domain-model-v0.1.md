# AISR Atlas V0.1 领域模型

## 1. 规范系统图谱（Canonical System Graph）

Atlas 的核心不是图片，而是一张结构化、机器可读、可版本化的规范系统图谱（Canonical System Graph）。

其基础抽象为：

**Workspace + Unit + Type + Containment + Relationship + Facet + View + Layout + Draft + Revision + Dynamic / Work State**

## 2. 工作区（Workspace）

Workspace 是 V0.1 的顶层隔离边界。

规则：

- 支持多个 Workspace；
- Workspace 之间不建立跨域 Relationship；
- 每个 Workspace 有且只有一个 Root Unit（根单元）；
- 每个 Workspace 独立拥有 Published Revision、Draft、Layout 与动态状态。

## 3. 单元（Unit）

Unit 是 Atlas 中最小的统一系统对象。大框和小框不是两套数据结构。

系统、项目、应用、服务、组件、Agent、Workflow、Runtime、Datastore、External System 等都可以是 Unit。

V0.1 的 Unit 至少需要：

```yaml
id: aloha.gateway
name: ALOHA Gateway
type: service
parent: aloha
```

要求：

- `id` 必须稳定；
- `id` 用于关联 Relationship、Layout、Runtime State、Work State 和外部事实源；
- 展示名称（name）可以修改，但不应轻易改变稳定 ID。

## 4. 类型（Type）

Type 回答：**这个 Unit 是什么？**

建议的 V0.1 核心内置类型：

- `system`
- `project`
- `application`
- `service`
- `component`
- `agent`
- `workflow`
- `runtime`
- `datastore`
- `external-system`

核心原则：

> **Type is semantics. Shape is presentation.**  
> 类型（Type）属于语义；图形（Shape）属于展示。

Canonical Model 不保存“六边形 / 圆柱”这种 UI 决策。Web 根据 Type 映射视觉形态。

Workspace 可以扩展自定义 Type。

## 5. 包含关系（Containment）

Containment 回答：**这个 Unit 属于谁 / 在谁里面？**

V0.1 使用单父级（Single Parent）层级：

```text
Root Unit
└── Project
    └── Service
        └── Component
```

规则：

- 除 Root Unit 外，每个 Unit 有一个 Parent；
- Parent 必须位于同一 Workspace；
- 不允许循环包含；
- Containment 是语义模型的一部分；
- 改变 Parent 属于定义性变更（Definition Change），必须进入 Draft。

## 6. 关系（Relationship）

Relationship 回答：**两个 Unit 之间是什么关系？**

与 Containment 分开建模。

建议核心关系类型：

- `depends_on`
- `calls`
- `reads`
- `writes`
- `publishes`
- `subscribes`
- `authenticates_with`
- `delegates_to`
- `deployed_on`
- `observed_by`

Relationship 也应有稳定 ID，方便未来增加说明、来源、状态、证据和版本追踪。

示例：

```yaml
id: rel.aloha-gateway.lifespace-identity
from: aloha.gateway
to: lifespace.identity
type: depends_on
```

V0.1 不允许 Relationship 跨 Workspace。

## 7. 侧面（Facet）

Unit 不设置一个包打天下的 `status`，而是通过可扩展的 Facet 描述不同侧面。

一个 Unit 可以同时：

```text
Development: Implemented
Runtime: Running
Health: Warning
Work: AI 正在修 Issue #42
```

建议第一批 Facet：

- `architecture`：架构定位、稳定性、当前 / 规划等；
- `development`：开发状态、进度、Issue / PR；
- `runtime`：运行状态；
- `health`：健康 / 风险；
- `deployment`：环境、版本、Release；
- `work`：Human / AI Work Session 与当前工作。

后续可以扩展 Security、Cost、Ownership、SLA、Documentation、Test Coverage、Incident、Observability 等。

Facet Type 采用“核心内置 + Workspace 自定义扩展”。

## 8. 视图（View）

View 回答：**当前想看系统的哪一面？**

例如：

- Overview View（总览视图）
- Architecture View（架构视图）
- Development View（开发视图）
- Runtime View（运行视图）
- Operations View（运维视图）
- Collaboration View（协作视图）

V0.1 的多个 View 共享同一套结构 Layout，只切换显示哪些 Facet / 状态信息。

## 9. 布局（Layout）

Layout 回答：**Unit 画在哪里？**

Layout 与 Canonical Model 完全分离。

典型字段：

```yaml
unit_id: aloha.gateway
position:
  x: 680
  y: 320
size:
  width: 220
  height: 100
collapsed: false
```

子 Unit 坐标优先采用相对 Parent 的坐标。

## 10. 草稿（Draft）与修订版本（Revision）

每个 Workspace：

- 一个当前已发布修订版本（Published Revision）；
- 一个活动草稿（Draft）。

Draft 是可持续修改的工作副本。修改不会每次立即产生新的 Published Revision。

用户明确 Publish 后，Draft 一次性形成新的 Published Revision。

## 11. 三类状态数据

### 11.1 定义性数据（Definition）

回答“系统是什么”。进入 Draft / Revision。

### 11.2 运行性数据（Runtime State）

回答“系统现在运行得怎么样”。进入 Current State / Event / Snapshot / Timeline。

### 11.3 工作性数据（Work State）

回答“现在谁在对它做什么”。进入 Current State / Event / Timeline。

## 12. V0.1 不变量（Invariants）

以下规则应直接进入领域校验：

1. Workspace 之间不允许建立 Relationship；
2. 每个 Workspace 必须且只能有一个 Root Unit；
3. 除 Root Unit 外，每个 Unit 必须有且只有一个 Parent；
4. Containment 不允许循环；
5. Position / Size / Collapsed 等 Layout 字段不得改变 Parent、Type 或 Relationship；
6. 拖动 Child Unit 不允许脱离 Parent 的视觉容器；必要时 Parent 自动扩展；
7. Type 是语义，Shape 是 View；
8. 每个 Workspace 只有一个活动 Draft；
9. Publish 必须显式发生；
10. Runtime State / Work State 变化不得制造 Definition Revision；
11. Layout 必须与 Revision 绑定；
12. V0.1 不迁移跨 Revision Layout。
