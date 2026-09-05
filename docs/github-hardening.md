# GitHub Public Repository Hardening Baseline（GitHub 公开仓库加固基线）

本文记录 AISR Atlas 公开仓库（Public Repository）的 GitHub 侧安全与合并策略。它用于让仓库设置可复查、可恢复，并与代码内的 `AGENTS.md`、`SECURITY.md` 和 CI（持续集成）保持一致。

> GitHub Settings（仓库设置）不完全存在于 Git 中，因此本文件是设置基线，不代表某个开关已经实际启用。实际状态需要在 GitHub UI / API 中再次核验。

## 1. Default branch protection（默认分支保护）

为默认分支 `main` 建立 Repository Ruleset（仓库规则集）：

- **Name（名称）**：`Protect main`
- **Enforcement（执行状态）**：Active（启用）
- **Target（目标）**：Default Branch（默认分支 / `~DEFAULT_BRANCH`）

规则：

- Restrict deletions（禁止删除受保护分支）；
- Block force pushes / Non-fast-forward（禁止强制推送 / 非快进更新）；
- Require linear history（要求线性历史）；
- Require a pull request before merging（合并前必须通过 Pull Request）；
- Required approving review count（必须批准数）：V0.1 单人维护阶段为 `0`；
- Require conversation resolution（必须解决 Review Conversation / 评审讨论）；
- Require extra approval for unattributed changes（对无法归因的变更要求额外批准，如 GitHub UI 提供）；
- Allowed merge method（允许合并方式）：仅 `Squash`（压缩合并）；
- Require status checks to pass（必须通过状态检查）；
- Require branches to be up to date before merging（合并前要求分支基于最新 `main`）。

Required Status Checks（必需状态检查）：

- `verify`
- `secret-scan`

这些 Context（检查名称）由 `.github/workflows/ci.yml` 提供。首次创建 Ruleset 前，最好先让 CI 在仓库中成功运行一次，使 GitHub 能识别检查名称。

Bypass（绕过）应尽量限制为 Repository Administrator / Maintainer（仓库管理员 / 维护者），并优先采用 **Pull Request only（仅通过 PR 绕过）**，避免保留普通 Direct Push（直接推送）通道。

## 2. Secret protection（密钥保护）

在 Code Security（代码安全）相关设置中启用可用的：

- Secret Scanning（密钥扫描）；
- Push Protection（推送保护）。

CI 同时通过 Gitleaks 扫描完整 Git History（Git 历史）。二者用途不同：GitHub Push Protection 尽量在敏感值进入仓库前阻断；CI History Scan 用于持续发现当前树和历史中的潜在 Secret。

不要因为开启了扫描就降低 `AGENTS.md` 中的人工 / AI 安全约束。

## 3. Vulnerability reporting（漏洞报告）

启用 GitHub Private Vulnerability Reporting（私密漏洞报告），使外部研究者可以不通过公开 Issue 报告敏感漏洞。

`SECURITY.md` 应持续告诉贡献者：敏感 Exploit Detail（漏洞利用细节）、Secret、真实日志或私人基础设施信息不得公开提交。

## 4. GitHub Actions security（GitHub Actions 安全）

推荐设置：

- Workflow Permissions（工作流权限）默认使用 **Read repository contents and packages（只读仓库内容与包）**；
- 不允许 GitHub Actions 自动创建 / 批准 Pull Request，除非未来出现明确且经过 Review 的需求；
- 每个 Workflow 显式声明最小 `permissions`；
- 第三方 Action / Container 应尽量固定到受信任版本，关键安全工具优先 Pin Digest / Commit SHA（固定摘要 / 提交）；
- Workflow 不得输出 Secret、完整认证对象或真实用户数据；
- Public Fork PR（公开 Fork 拉取请求）不得获得生产 Secret。

当前 CI 的 `secret-scan` 使用固定版本和 Image Digest（镜像摘要）的 Gitleaks。

## 5. Dependency security（依赖安全）

在项目开始出现 Dependency Manifest / Lockfile（依赖清单 / 锁文件）后：

- 启用 Dependabot Alerts（依赖漏洞告警）；
- 评估启用 Dependabot Security Updates（安全更新）；
- 增加 Dependency Review（依赖评审）或同等检查，尤其关注 AGPL 兼容性和供应链风险；
- Lockfile 必须进入版本控制，CI 使用可重复安装方式。

V0.1 仓库骨架尚未建立正式依赖清单时，不为“看起来完整”而创建无意义的 Dependabot 配置。

## 6. Merge / history policy（合并 / 历史策略）

对 `main`：

- 正常变更走 Pull Request；
- Ruleset 只允许 Squash Merge；
- 禁止 Force Push 和 Branch Deletion；
- CI 必须通过；
- Review Conversation 必须解决。

Repository-level（仓库级）的 Merge Commit / Rebase Merge 开关即使保持开启，也不能绕过 `main` Ruleset；但为减少误解，未来可在 GitHub 仓库设置中仅保留 Squash Merge。

## 7. Deployment and environment secrets（部署与环境密钥）

当 Atlas 开始部署到 Cloudflare 等环境时：

- Secret 只进入 GitHub Actions Secret / Environment Secret / Cloudflare Secret；
- Account ID、Zone ID、Tunnel ID、Private Route 等非公开资源标识不得因为“不是密码”就直接进入公开仓库；
- 生产部署优先使用 GitHub Environment（环境）做权限与审计边界；
- Public PR 不得自动部署到带生产权限的 Environment；
- CI Log / Artifact 同样按公开信息处理。

## 8. Public-release safety pass（公开发布安全检查）

每次重要发布或首次引入真实集成前至少检查：

1. 当前 Tree（文件树）是否有 Secret / Personal Data / Private Infrastructure Metadata；
2. Git History 是否有已经删除但仍可检出的敏感内容；
3. CI Log / Artifact 是否泄露；
4. Issue / PR / Review Comment 是否包含私人内容；
5. Example / Fixture 是否全部是 Synthetic Data；
6. 新增第三方材料的 License / Attribution 是否明确；
7. `SECURITY.md` 与 Private Vulnerability Reporting 是否仍有效。

## 9. Current baseline parity（当前对齐目标）

Atlas 的初始目标与 `huangshirui/ALOHA-Assistant` 的公开仓库保护策略保持同一安全等级：

- `AGPL-3.0-or-later`；
- `AGENTS.md` 公开仓库安全模型；
- `SECURITY.md` 私密漏洞报告边界；
- `verify` + `secret-scan` CI；
- `Protect main` Ruleset；
- Secret Scanning + Push Protection；
- Full-history Secret Scan（完整历史密钥扫描）。

项目可以在此基线上继续加固，但不应无意降低这些边界。
