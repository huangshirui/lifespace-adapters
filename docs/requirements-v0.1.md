# AISR Atlas V0.1 需求基线

> 状态：Baseline / 待 Schema 实现

## 1. 产品定位

AISR Atlas 是独立项目，不以 LifeSpace 作为底座。它是一个面向人类（Human）与 AI 的系统地图 / 协作控制面（System Atlas / Collaboration Control Plane），用于统一理解一个工作区（Workspace）中的架构、开发、部署、运行、运维与人机协作状态。

Atlas 自身应能在被观察系统出现故障时继续运行，因此：

- LifeSpace、ALOHA、HomeMew、Relay、n8n 等都是 Atlas 的被描述 / 被观察对象；
- Atlas 不依赖 LifeSpace 才能启动或登录；
- 业务系统也不应把 Atlas 作为运行时强依赖。

## 2. V0.1 目标

V0.1 的目标不是“画出一张漂亮架构图”，而是建立一份人和 AI 都能可靠读写的规范系统图谱（Canonical System Graph），并完成最小闭环：

1. 创建 / 选择工作区（Workspace）；
2. 读取工作区当前草稿（Draft）或已发布修订版本（Published Revision）；
3. 在画布（Canvas）上查看层级、关系和状态；
4. 用户自由调整布局（Layout）而不改变架构语义；
5. 人或 AI 修改草稿中的定义性数据（Definition）；
6. 查看草稿相对已发布版本的差异（Diff）；
7. 用户明确确认后发布（Publish），形成新的修订版本（Revision）；
8. AI 可通过 MCP / Tool（模型上下文协议 / 工具）完成同样的查询和草稿修改。

## 3. 核心体验

### 3.1 工作区（Workspace）

- 从 V0.1 开始支持多个 Workspace；
- Workspace 之间相互隔离；
- V0.1 不支持跨 Workspace 的 Unit 引用或 Relationship；
- 每个 Workspace 有且只有一个根单元（Root Unit）。

### 3.2 画布（Canvas）

- Unit 以不同视觉形态展示其类型（Type）；
- 大 Unit 可以包含小 Unit，表现包含 / 层级关系（Containment）；
- Unit 可以通过连线表现关系（Relationship）；
- 支持缩放、平移、展开 / 折叠；
- 用户可以拖动 Unit 调整查看习惯；
- 拖动、缩放、尺寸、折叠等只影响布局（Layout），不得隐式改变语义模型（Semantic Model）。

### 3.3 默认布局与个人布局

每个修订版本（Revision）同时支持：

- 默认布局（Default Layout）：初版可由 AI 生成，人和 AI 都能调整并显式保存为默认布局；
- 个人布局（Personal Layout）：用户自己的查看习惯；
- 个人布局可以一键恢复为默认布局；
- Layout 与 Revision 绑定；
- V0.1 不做跨 Revision 的布局迁移。

### 3.4 草稿与发布

- 每个 Workspace 同时只有一个活动草稿（Draft）；
- 人和 AI 都可以持续修改 Draft；
- Draft 是可变的工作副本，不因每次修改立即产生正式 Revision；
- Draft 内部保留变更日志（Change Log）；
- AI 默认只需要获取最新 Draft 的完整当前状态，不强制加载 Change Log；
- 需要追溯时，AI 再按需查询 Change Log 或 Diff；
- 用户明确确认 Draft 后执行 Publish，形成新的 Published Revision；
- MCP / Tool 可暴露 Publish 能力，但只能在用户明确要求发布时调用；AI 不得自主发布。

## 4. 数据三分法

### 4.1 定义性数据（Definition）

回答：**系统是什么 / 应该是什么？**

包括但不限于：

- Unit 的创建、删除、名称；
- 类型（Type）；
- 父级 / 包含关系（Parent / Containment）；
- Unit 间关系（Relationship）；
- 声明式属性（Declared Properties）；
- 需要人工维护、会改变系统定义的 Facet。

定义性数据的修改进入 Draft，并在 Publish 时形成新的 Revision。

### 4.2 运行性数据（Runtime State）

回答：**系统现在运行得怎么样？**

例如：

- Running / Degraded / Down；
- 部署版本；
- 错误率、延迟、CPU 等指标；
- Alert（告警）；
- Incident（事故 / 故障事件）。

运行性数据进入当前状态（Current State）、事件（Event）、快照（Snapshot）或时间线（Timeline），不产生架构 Revision。

### 4.3 工作性数据（Work State）

回答：**现在谁在对它做什么？**

例如：

- 开发进度；
- Issue / PR；
- Human / AI Work Session（人 / AI 工作会话）；
- 正在修复 Bug、Review 或处理 Incident。

工作性数据进入当前状态 / 事件 / 时间线，不产生架构 Revision。

## 5. V0.1 视图原则

V0.1 只有一套结构布局（Structural Layout）。架构视图（Architecture View）、开发视图（Development View）、运行视图（Runtime View）、运维视图（Operations View）等只决定显示哪些 Facet / 信息层，不各自拥有独立 XY 布局。

## 6. 类型与扩展性

V0.1 采用：**核心内置集合（Core Types） + 工作区自定义扩展（Custom Types）**。

同样的扩展原则适用于：

- Unit Type（单元类型）；
- Relationship Type（关系类型）；
- Facet Type（侧面类型）。

内置类型只提供稳定基础，不应阻止未来 Workspace 定义 `device`、`model` 或其他领域类型。

## 7. V0.1 完成标准

V0.1 完成时，应至少具备：

- Workspace + Root Unit；
- Unit Graph（单元图谱）；
- Type / Containment / Relationship；
- 基础 Facet 模型；
- Published + Draft + Diff + Change Log；
- Default Layout + Personal Layout；
- Canvas 拖动、缩放与层级展开；
- MCP / Tool 的核心读写能力；
- Definition / Runtime State / Work State 三类数据边界；
- 运行与工作状态初期允许由人或 AI 手工 / Tool 写入。

## 8. V0.1 明确不做

- 跨 Workspace 关系；
- 多个并行 Draft / 架构分支；
- 跨 Revision 的 Layout 自动迁移；
- 产品内复杂审批流；
- 通用在线白板；
- 完整项目管理系统；
- GitHub Issue / PR 替代；
- Notion 文档替代；
- 完整 APM / 日志平台；
- 完整 CI/CD 平台；
- V0.1 强制接入 GitHub / Cloudflare / n8n / Observability 等自动 Adapter。

## 9. 后续阶段

V0.1 稳定后再逐步增加 Adapter（适配器），自动从 GitHub、CI/CD、Cloudflare、n8n、监控系统等事实源同步状态，并扩展协作、评论、通知和更丰富的运维能力。
