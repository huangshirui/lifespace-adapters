# Security Policy（安全策略）

AISR Atlas 是公开仓库（Public Repository），并计划连接架构、研发、部署、运行和运维事实源。安全工作既要保护软件本身，也要保护部署实例可能访问到的私人数据与线上基础设施。

## Reporting a vulnerability（报告漏洞）

不要在公开 GitHub Issue、Pull Request、Discussion、Commit Message、Review Comment 或 CI 日志中放入 Exploit Detail（可利用漏洞细节）、Credential（凭据）、Personal Data（个人数据）、Production Log（生产日志）、Private Infrastructure Identifier（私有基础设施标识）或其他敏感证据。

如果仓库启用了 GitHub Private Vulnerability Reporting（私密漏洞报告），优先使用该渠道。若暂未启用，请先通过项目维护者已有的私密联系方式联系，再分享敏感技术细节。

安全的首轮报告应只说明：受影响组件、影响、复现前置条件，以及使用 Synthetic Data（合成数据）的最小复现；不要包含真实 Secret（密钥）或用户数据。

## Repository disclosure boundary（公开仓库披露边界）

公开仓库可以包含：

- Portable Source Code（可移植源代码）；
- Public Contract / Schema（公开契约 / 模式）；
- Public Product / Architecture Documentation（公开产品 / 架构文档）；
- Synthetic Example / Fixture（合成示例 / 测试夹具）。

公开仓库不得包含：

- 真实用户对话、Prompt、记忆、邮件、联系人、日历、文件、媒体、位置、身份标识，以及家庭、健康、金融等私人数据；
- Production / Staging 数据集、数据库 Dump、Trace、Request Capture 或含真实数据的 Log；
- API Key、OAuth Secret / Token、Cookie、JWT、Private Key、Password、Webhook Secret、Recovery Code、Signed Private URL 等；
- 非公开线上基础设施标识 / 拓扑，例如 Cloudflare Account / Zone / Resource / Tunnel Identifier、Origin IP、Private Host、Deployment-only Route、Database Connection String 或内部服务元数据；
- 从 Private Connector、MCP / Tool、Notion、GitHub Private Repo 或其他系统复制出的非公开内容。

示例、测试和文档只能使用 Synthetic Data（合成数据）与安全占位符。Runtime Secret（运行时密钥）和线上私密部署配置必须留在部署平台的 Secret / Environment / Binding 机制中，不进入源代码管理。

## If a disclosure is found（发现泄露时）

1. 立即停止复制、引用或继续传播暴露值。
2. 对受影响的 Credential / Token（凭据 / 令牌）立即撤销或轮换。
3. 默认已提交内容仍存在于 Git History（Git 历史）中；普通删除 Commit 并不等于清除历史。
4. 如敏感内容进入 Git 历史，完成 History Rewrite / Cleanup（历史重写 / 清理）后再认为仓库恢复安全。
5. 检查 CI Log / Artifact、PR / Issue、Review Comment 以及外部缓存是否存在二次披露。
6. 记录修复过程时，不要再次写出敏感值。

## Public-release gate（公开发布门禁）

对任何准备进入公开仓库的新代码、文档、示例或导入数据，都必须执行 Public-repository Safety Pass（公开仓库安全检查）。不仅检查当前 Working Tree（工作树），还应考虑 Git History、CI 日志、Artifact、PR / Issue 文本和自动生成内容。

仓库 CI 包含 Full-history Secret Scan（全 Git 历史密钥扫描）作为基础门禁；GitHub Secret Scanning / Push Protection（密钥扫描 / 推送保护）也应在仓库设置中启用。

另见 `AGENTS.md` 中适用于 Human / AI Contributor（人类 / AI 贡献者）的强制规则。
