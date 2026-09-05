# LifeSpace Adapters Agent Instructions

LifeSpace Adapters is the protocol-adaptation layer around LifeSpace. It translates canonical LifeSpace contracts and current capability projections into external protocol surfaces without becoming a second source of truth for LifeSpace semantics, authorization, or domain models.

The first adapter is MCP（Model Context Protocol，模型上下文协议）. Future protocol adapters may be added only when they have a real consumer and a clear boundary.

## Open-source and public-repository safety model（开源与公开仓库安全模型）

This is a **public open-source repository（公开开源仓库）**. Treat every tracked file, Commit（提交）, Branch（分支）, Pull Request（拉取请求）, Issue（议题）, Review Comment（评审评论）, CI Log / Artifact（持续集成日志 / 产物）, Fixture（测试夹具）, generated example and documentation snippet as if it can become public and permanently indexed.

The repository contains public source code and public documentation only. It is not a storage location for private user context, credentials, production data, or live infrastructure configuration.

Never commit, paste, generate, snapshot, log, fixture, test with, or otherwise expose:

- real conversations, prompts, memories, emails, contacts, calendars, tasks, files, photos, audio, precise location, identifiers, health/financial/family data, or other real user content;
- production/staging datasets, exports, database dumps, request/response captures, analytics samples, traces or logs containing real data;
- API keys, OAuth secrets, access/refresh tokens, JWTs, cookies, sessions, private keys, webhook secrets, passwords, recovery codes, signed URLs or other credentials;
- non-public infrastructure identifiers or topology, including provider account/resource IDs, origin IPs, private hosts/routes, Access identifiers, deployment-only endpoints, private repository/document links or equivalent live metadata;
- non-public content retrieved through Connector（连接器）, MCP / Tool（工具）, Notion, private repositories, or personal systems unless it is explicitly intended to be public and necessary for this repository.

Use Synthetic Data（合成数据） only. Use `example.com`, invented actors and clearly fake identifiers. Never anonymize a real private payload and commit it.

Runtime secrets and live configuration must be injected through deployment/platform Secret / Environment / Binding（密钥 / 环境 / 绑定） mechanisms and must never be committed or printed to logs.

## Licensing and third-party material（许可与第三方材料）

- This repository is licensed under **GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`)** unless a file explicitly states otherwise.
- Do not change licensing or introduce incompatible third-party code/assets without explicit project-owner approval.
- Before copying code, prompts, schemas or substantial text from another project, verify License / Attribution（许可 / 署名） requirements. Publicly accessible does not mean reusable.

## Read before making changes（修改前阅读顺序）

Read in this order:

1. `README.md` for repository purpose, scope and current status;
2. `docs/architecture.md` for ownership and adapter boundaries;
3. `docs/lifespace-contract-consumption.md` for canonical LifeSpace contract-consumption rules;
4. the relevant adapter document, currently `docs/mcp-adapter.md`;
5. the nearest nested `AGENTS.md` for every directory changed, if one exists;
6. the canonical LifeSpace sources that own any behavior being projected, especially `huangshirui/LifeSpace` `docs/contracts.md`, relevant authentication/authorization docs, `apps/core/openapi.yaml`, `apps/identity/openapi.yaml`, and the relevant immutable Model Contract Revision when ordinary model behavior is involved;
7. relevant tests, configuration and implementation in this repository.

If an adapter behavior depends on a LifeSpace contract that is unclear or missing, fix or clarify the owning LifeSpace contract first. Do not fill the gap by inventing a parallel domain rule here.

## Sources of truth（事实源）

LifeSpace owns the durable semantics. This repository owns only protocol adaptation.

Canonical LifeSpace-owned truth includes:

- Identity（身份）, Principal / Actor（权限主体 / 执行者）, Application Context（应用上下文）;
- Space / Membership / Data Grant（空间 / 成员关系 / 数据授权）;
- Agent Delegation（Agent 委托） and current Effective Authority（有效权限）;
- Shared Reality（共享现实） domain models and Model Definitions（模型定义）;
- Runtime Discovery（运行时发现） and current capability pruning;
- Kernel / Identity OpenAPI and immutable Model Contract Revisions;
- mutation validation, Policy（策略）, optimistic concurrency and governed Change（受治理变更）.

This repository may own:

- protocol-specific server/session/transport behavior;
- deterministic projection from LifeSpace discovery/contracts into protocol schemas;
- protocol-specific naming, error mapping and compatibility behavior;
- adapter-local tests and deployment packaging;
- small shared helpers that remain protocol-adaptation concerns.

Planned behavior is not Implemented Behavior（已实现行为）. Do not make README/docs imply that an adapter or deployment is available until it is verified.

## Mandatory architecture boundaries（强制架构边界）

### Pure adapter rule（纯适配器规则）

- Do not access LifeSpace D1/databases directly.
- Do not reimplement Membership, Data Grant, Application × Model Access, Agent Delegation, Policy, model validation or authorization intersections.
- Do not create a shadow LifeSpace Domain Model（领域模型）, Registry（注册表）, migration history, permission database or user/Space directory.
- Do not make this repository the owner of canonical LifeSpace JSON Schema/OpenAPI. Consume explicit LifeSpace contract versions/revisions instead.
- A protocol adapter may narrow or reshape a surface for protocol compatibility, but it must never broaden the authority supplied by LifeSpace.

### Dynamic capability projection（动态能力投影）

LifeSpace Runtime Discovery is the source for what the current authenticated context can discover:

```text
GET /api/v1/me/_discovery
GET /api/v1/spaces/{spaceId}/_discovery
```

The adapter must project the **current pruned result**, not expose a static catalog of every LifeSpace model/action.

Do not independently recompute the authority intersection. LifeSpace Core already evaluates verified principal context, credential scope, Application × Model Access, current Space membership/Data Grant, current Agent Delegation when relevant, and published model/capability restrictions.

Runtime Discovery is a capability preview, not authorization proof. Every execution request must go back through the authoritative LifeSpace operation, which rechecks current authorization, policy, concurrency and semantic validation.

### Principal / Actor / Application attribution（主体 / 执行者 / 应用归因）

Preserve these concepts when they differ:

```text
principal          = whose authority is exercised
actor              = who/what executes or initiates
applicationContext = through which application context it occurs
```

An Agent acting for a User does not acquire user authority merely because it is the Actor. The adapter must not turn a broad service credential into a substitute for user Delegation（委托）.

### Control-plane exclusion（控制面排除）

Platform Admin（平台管理） contracts are not part of the ordinary Agent/tool discovery surface. Do not expose privileged Console/control-plane operations through MCP or another adapter merely because the endpoints exist in LifeSpace.

Any future control-plane adapter requires an explicit architecture decision, independent authentication profile and dedicated tests.

## Contract and compatibility workflow（契约与兼容工作流）

- Consume explicit compatible LifeSpace contract versions/revisions; do not silently track an undocumented latest shape.
- Ordinary model syntax belongs to immutable `mct_*` Model Contract Revisions, not to handwritten adapter schemas.
- Environment-local `mct_*` IDs are exact contract evidence and may differ across environments; do not assume one globally stable revision ID.
- If a LifeSpace contract changes incompatibly, update adapter compatibility intentionally and test both supported and rejected versions.
- Protocol-specific annotations must not redefine LifeSpace semantic input, concurrency metadata, relation semantics or authorization rules.

## Repository discipline（仓库纪律）

- `adapters/<protocol>/` owns one concrete protocol adapter.
- `shared/` may contain protocol-agnostic adapter helpers such as LifeSpace client/projection utilities, but must not become a second platform/domain layer.
- `docs/` contains stable architecture, contract-consumption and adapter decisions; do not use it as a transient task log.
- Do not create `packages/domain`, a duplicate Model Registry, or adapter-owned platform migrations.
- `lifespace-n8n-nodes` remains a separate platform integration repository; do not absorb it here merely because it also consumes LifeSpace.
- Prefer the smallest implementation that proves the next adapter invariant. Add shared abstraction only after at least one real cross-adapter need is visible.

## Security and credential handling（安全与凭据处理）

- Never log Authorization headers, bearer tokens, cookies, delegated Agent tokens, service credentials or raw authenticated context.
- Never expose one caller's discovery result, tool output, cache entry or error detail to another caller.
- Authentication material used by an adapter must be scoped to the actual execution model; a long-lived platform administrator credential is not an acceptable convenience shortcut.
- Client-provided IDs, claims, scopes or tool arguments are input, not authorization authority.
- Protocol-level descriptions or model prompts are not security boundaries.

## Change completion（变更完成标准）

Before declaring a change complete:

1. verify that the owning LifeSpace contract still matches the adapter assumption;
2. update adapter docs/compatibility notes when the protocol surface changes;
3. add positive, deny/error and stale/revoked-authority tests appropriate to the change;
4. run repository CI/checks that apply;
5. perform a Public-repository Safety Pass（公开仓库安全检查） over the diff and generated output;
6. confirm no LifeSpace domain/authorization rule was duplicated into adapter code.

If a required check cannot be run, state that explicitly and do not describe the behavior as verified.
