# AISR Atlas Agent Instructions

AISR Atlas 是面向人类（Human）与 AI 共同使用的系统地图 / 协作控制面（System Atlas / Collaboration Control Plane）。本仓库定义 Atlas 产品、规范系统图谱（Canonical System Graph）、领域规则、Web/API/MCP 边界以及 V0.1 实现。

本文件适用于所有 Human / AI Contributor（人类 / AI 贡献者）。

## Open-source and public-repository safety model（开源与公开仓库安全模型）

这是一个 **公开开源仓库（Public Open-source Repository）**。将每个被追踪的文件、Commit（提交）、Branch（分支）、Pull Request（拉取请求）、Issue（议题）、Review Comment（评审评论）、CI Log / Artifact（持续集成日志 / 产物）、Screenshot（截图）、Fixture（测试夹具）、生成示例和文档片段，都视为可能被公开、永久索引并长期保留。

本仓库只用于**公开源代码与公开文档**，不是保存私人上下文、真实用户数据或线上基础设施配置的地方。

### Never publish private or sensitive data（禁止发布私人或敏感数据）

不得 Commit（提交）、粘贴、生成、快照、记录日志、作为测试数据或以其他形式暴露：

- 真实用户的对话、Prompt（提示词）、记忆、邮件、联系人、日历、任务、文件、照片、音频、精确位置、身份标识，以及健康、金融、家庭等私人数据；
- Production / Staging（生产 / 预发布）数据集、导出、数据库 Dump、真实 Request / Response Capture（请求 / 响应抓包）、Analytics Sample（分析样本）、Trace（链路）或 Log（日志）；
- 任何 Secret / Credential（密钥 / 凭据）：API Key、OAuth Client Secret、Access / Refresh Token、JWT、Cookie、Session、Private Key、Webhook Secret、Password、Recovery Code、Signed URL 等；
- 非公开的线上基础设施信息：Provider Account / Resource ID、Origin IP、Private Hostname / Route、Tunnel / Access Identifier、数据库连接串、部署专用拓扑、内部服务元数据、私有仓库 / 文档链接等；
- 通过 Connector（连接器）、MCP / Tool（模型上下文协议 / 工具）或个人系统读取到的非公开内容，除非该内容明确应当公开且确有必要进入仓库。

示例和测试只能使用 **Synthetic Data（合成数据）**。使用 `example.com`、虚构主体和明显的假 ID。不得把真实私人数据“匿名化”后再提交；匿名化并不等于适合公开。

Runtime Secret（运行时密钥）和线上配置必须通过 GitHub / Cloudflare 等平台的 Secret / Environment / Binding（密钥 / 环境 / 绑定）机制注入，不得进入 Git 历史。被追踪的配置文件只能包含可公开的便携配置或安全占位符。

如发现敏感信息已经进入仓库：立即停止传播；必要时先吊销 / 轮换凭据；默认 Git 历史仍长期存在，直到明确完成历史清理；同时检查 CI 日志、Artifact（产物）、PR / Issue 文本和外部缓存是否存在二次泄露。

## Licensing and third-party material（许可与第三方材料）

- 本仓库采用 **GNU Affero General Public License v3.0 or later（GNU Affero 通用公共许可证第 3 版或更高版本）**，SPDX 标识为 `AGPL-3.0-or-later`，除非某文件明确声明其他兼容许可。
- 未经项目所有者明确同意，不得改变许可策略或引入与当前许可不兼容的第三方代码、Schema（模式）、Prompt、图片、字体、图标、文档或其他资产。
- 复制第三方代码或较大段文字前，必须核验 License / Attribution（许可 / 署名）要求。**Publicly accessible does not mean reusable（公开可访问不等于可自由复用）**。
- 不要将未知来源、生成来源不明或许可不清楚的资产直接提交到仓库。

## Read before making changes（修改前阅读顺序）

修改领域行为前至少按以下顺序阅读：

1. `README.md`：项目定位、MVP 范围和当前阶段；
2. `docs/requirements-v0.1.md`：V0.1 需求基线；
3. `docs/domain-model-v0.1.md`：领域模型（Domain Model）；
4. `docs/versioning-and-layout-v0.1.md`：版本与布局规则；
5. `docs/mcp-tool-surface-v0.1.md`：MCP / Tool 能力边界；
6. `docs/architecture.md`：系统与仓库架构边界；
7. 修改目录内最近的 `AGENTS.md`（如未来增加嵌套规则）；
8. 相关 Schema、Contract（契约）、测试、配置与实现。

如果行为依赖的 Source of Truth（事实源）尚不存在，先建立最小明确契约，不要通过 UI 细节或临时实现反推领域规则。

## Sources of truth（事实源）

- 产品定位与 V0.1 验收：`README.md`、`docs/requirements-v0.1.md`
- 领域语义与不变量：`docs/domain-model-v0.1.md`
- Draft / Revision / Layout：`docs/versioning-and-layout-v0.1.md`
- MCP / Tool 对外能力：`docs/mcp-tool-surface-v0.1.md`
- 系统、部署与模块边界：`docs/architecture.md`
- 机器可读领域结构：`schemas/` 与 `packages/domain`（落地后）
- 可部署行为：`apps/*`
- 已验证行为：Automated Tests（自动化测试）和 CI（持续集成）

Planned Behavior（规划行为）不是 Implemented Behavior（已实现行为）。README / Docs 不得暗示尚未实现的 Adapter（适配器）、Runtime Integration（运行时集成）或监控能力已经可用。

## Core V0.1 invariants（V0.1 核心不变量）

除非先明确更新 V0.1 Baseline（基线），否则不得破坏以下规则：

1. Atlas 从 V0.1 开始支持多个 Workspace（工作区）。
2. V0.1 不支持 Cross-Workspace Relationship（跨工作区关系）。
3. 每个 Workspace 恰好有一个 Root Unit（根单元）。
4. Unit（单元）是 System、Project、Service、Component、Agent、Workflow、Datastore 等对象的统一语义实体。
5. Type（类型）是语义；Shape（图形）是展示。
6. Containment（包含关系）与 Relationship（关系）是两个不同概念。
7. Model（模型）、View（视图）与 Layout（布局）必须分离。
8. Canvas（画布）拖动只改变 Layout，不得隐式改变 Parent、Type、Containment、Relationship 或其他语义数据。
9. 每个 Workspace 只有一个当前 Published Revision（已发布修订版本）和一个 Active Draft（活动草稿）。
10. Draft 可持续修改；单次编辑不会逐条产生 Published Revision。
11. Change Log（变更日志）可按需查询，但不属于 AI 默认读取负载。
12. Publish（发布）必须来自用户明确意图；AI 不得自主决定发布。
13. Definition（定义性数据）、Runtime State（运行性数据）与 Work State（工作性数据）三类信息必须分离。
14. Runtime / Work State 的变化不得产生 Definition Revision（定义修订版本）。
15. 每个 Revision 拥有自己的 Default Layout（默认布局）与 Personal Layout（个人布局）。
16. V0.1 不进行跨 Revision 的 Layout Migration（布局迁移）。
17. Child Unit（子单元）的视觉位置保持在 Parent（父单元）容器内；移动 Parent 时 Children（子单元）作为视觉组一起移动。
18. V0.1 每个 Revision 只有一套空间布局；不同 View 仅切换呈现的信息侧面（Facet），不拥有独立 XY 位置。
19. Core Type / Relationship Type / Facet（核心类型 / 关系类型 / 侧面）允许通过受控扩展机制增加 Custom Definition（自定义定义），但不得绕过核心 Schema 与校验。
20. Workspace 之间保持模型隔离；不得通过视觉位置或外部数据导入暗中建立跨 Workspace 语义关系。

## Model / View / Layout boundary（模型 / 视图 / 布局边界）

核心原则：

> **Model answers what the system is. View answers what is being shown. Layout answers where it is drawn.**  
> 模型决定系统是什么；视图决定当前看什么；布局决定画在哪里。

UI 特有字段，例如 React Flow Node Shape（节点图形）、Color（颜色）、Handle（连接柄）、XY Coordinate（坐标）等不得泄漏到 Canonical System Model（规范系统模型）。

不得从 XY Position（坐标位置）推导 Parent / Containment / Relationship。把 Unit 拖入另一个视觉容器也不得自动 Reparent（重新归属）。真正的语义变更必须通过领域 Mutation（变更操作）进入 Draft。

## Definition / Runtime / Work boundary（三类数据边界）

- Definition（定义性数据）回答“系统是什么 / 应该是什么”，进入 Draft / Published Revision。
- Runtime State（运行性数据）回答“系统现在运行得怎么样”，进入 Current State / Event / Snapshot / Timeline。
- Work State（工作性数据）回答“谁正在对它做什么”，进入 Current State / Event / Timeline。

不得因为错误率、部署状态、开发进度、Issue / PR、AI Work Session 等动态事实变化而制造新的 Definition Revision。

## Draft / Revision / Publish boundary（草稿 / 修订 / 发布边界）

Human 与 AI 均可在授权范围内修改 Active Draft（活动草稿）。AI 默认读取最新 Draft 完整状态，不自动加载全部 Change Log；需要追溯时再显式查询 Log / Diff。

MCP / Tool 可以暴露 Publish 能力，但模型不得自行决定发布。只有收到明确用户意图（例如“发布当前草稿”）后，才可调用 Publish。

## Domain-first implementation（领域优先实现）

优先保持以下依赖方向：

```text
apps/web ───────┐
                ├──> packages/domain
packages/mcp ───┤
apps/api ───────┘

packages/adapters --> apps/api / domain ports
```

`packages/domain` 承载核心 Schema、Validation（校验）和不变量。Web / MCP / API 不应各自复制并分叉同一套领域规则。

## Repository discipline（仓库纪律）

- `apps/web`：Human-facing Canvas / View（面向人的画布 / 视图）。
- `apps/api`：Atlas Control Plane Backend（控制面后端）。
- `packages/domain`：领域模型、Schema、Validation 与核心规则。
- `packages/mcp`：面向 AI Client 的 MCP / Tool 表面。
- `packages/adapters`：外部事实源 Adapter；不得把外部系统变成 Atlas 启动所需的硬依赖。
- `schemas/`：版本化 Machine-readable Schema（机器可读模式）。
- `docs/`：稳定需求与架构决策；不要把临时工作日志塞进架构文档。

Atlas 是独立的 Out-of-band Control / Observability Plane（带外控制 / 可观测面）。LifeSpace、ALOHA、HomeMew、Relay、n8n 等既不能成为 Atlas 启动的必需底座，Atlas 也不能成为这些系统核心 Runtime Request Path（运行请求链路）的必需依赖。

## Contract and change workflow（契约与变更流程）

当修改 External Behavior（外部可观察行为）或领域语义时：

1. 先定位哪个 Source of Truth / Invariant（事实源 / 不变量）发生变化；
2. 必要时先或同步更新 Baseline Doc（基线文档）；
3. 修改 Schema / Contract；
4. 修改实现；
5. 增加成功、失败与边界路径测试；
6. 检查 Web / API / MCP / Domain / Adapter 等耦合面；
7. 说明 Migration / Compatibility（迁移 / 兼容）影响。

V0.1 优先选择能验证下一条核心不变量的最小实现，不建立没有真实需求的推测性 Framework（框架）。

## Change completion（变更完成标准）

宣布变更完成前：

- 检查相关 Baseline Doc、Schema、Domain、Web、API、MCP、Adapter、测试和部署配置是否一致；
- 至少运行仓库规定的 Check / CI（检查 / 持续集成）；如果环境无法运行，明确说明哪些检查未执行，不得把未经验证的行为描述为“已工作”；
- 对 Diff（差异）执行一次 Public-repository Safety Pass（公开仓库安全检查）：确认没有私人用户数据、Secret / Credential、线上基础设施私密信息、私有 Connector 输出或许可不明的第三方材料；
- 确认示例数据全部为 Synthetic Data（合成数据）。
