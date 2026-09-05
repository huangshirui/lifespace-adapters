# Contributing to AISR Atlas（参与贡献）

感谢参与 AISR Atlas。这个项目从一开始就是 Human + AI（人类 + AI）共同维护的公开开源项目，因此领域一致性、可审计性、隐私与基础设施安全都属于贡献质量的一部分。

## Before you start（开始前）

请先阅读：

1. `AGENTS.md`：贡献与公开仓库强制规则；
2. `README.md`：项目定位与 V0.1 范围；
3. `docs/requirements-v0.1.md`：V0.1 需求基线；
4. `docs/domain-model-v0.1.md`：领域模型（Domain Model）；
5. 与修改相关的其他 `docs/*`、Schema 与测试。

如果你的改动会改变 Unit（单元）、Containment（包含关系）、Relationship（关系）、Facet（侧面）、Draft / Revision（草稿 / 修订）、Layout（布局）或 MCP / Tool 行为，请先确认它是否会改变 V0.1 Baseline（基线）。

## Public repository safety（公开仓库安全）

只提交适合永久公开的内容。

- 使用 Synthetic Data（合成数据），不得使用经过“匿名化”的真实私人数据作为 Fixture / Example（测试夹具 / 示例）。
- 不提交 Secret / Credential（密钥 / 凭据）、`.env`、真实 Token、Cookie、Private Key、Signed URL 或线上数据库连接串。
- 不提交真实用户内容、生产 / 预发布数据、日志、Trace、Request Capture 或私有 Connector 输出。
- 不提交非公开基础设施标识、Origin IP、Private Hostname、Tunnel / Account / Resource ID 等，除非其明确应当公开。
- 第三方代码、Schema、Prompt、图像、图标、字体或大段文本必须先确认许可与署名要求。

敏感安全问题请按照 `SECURITY.md` 私密报告，不要在公开 Issue / PR 中披露。

## Change approach（修改方式）

领域语义变更采用 Domain-first（领域优先）：

1. 明确需要改变的需求 / 不变量；
2. 必要时先或同步更新文档基线；
3. 更新 Schema / Contract（模式 / 契约）；
4. 更新实现；
5. 添加或更新测试；
6. 检查 Web / API / Domain / MCP / Adapter 等相关表面是否保持一致。

不要为了未来可能的需求先建立大型抽象层。V0.1 优先实现能够验证核心模型的最小闭环。

## Pull Request（拉取请求）

PR 应保持聚焦，并清楚说明：

- 改了什么、为什么；
- 是否影响 V0.1 Domain Model（领域模型）或 Baseline（基线）；
- 更新了哪些文档 / Schema / 测试；
- 执行了哪些检查；
- 是否存在尚未验证的行为或迁移影响。

在提交 PR 前完成一次 Public-repository Safety Pass（公开仓库安全检查）。

默认分支 `main` 通过 Repository Ruleset（仓库规则集）保护：使用 PR、通过必要 CI、解决 Review Conversation（评审讨论），并使用 Squash Merge（压缩合并）保持线性历史。

## Checks（检查）

仓库当前最小 CI 包含：

- `verify`：检查公开仓库与 V0.1 基线所需文件；
- `secret-scan`：使用 Gitleaks 扫描完整 Git History（Git 历史）。

后续建立工程实现后，`verify` 会扩展为 Type Check / Lint / Test / Schema Validation（类型检查 / 静态检查 / 测试 / 模式校验）。

如果某项检查无法运行，请在 PR 中明确写明，而不是将未经验证的行为描述为已经通过。

## License（许可）

除非文件明确声明其他兼容许可，本仓库贡献按照 **GNU Affero General Public License v3.0 or later（AGPL-3.0-or-later）** 提交。提交贡献即表示你有权按该许可提供这些内容。
