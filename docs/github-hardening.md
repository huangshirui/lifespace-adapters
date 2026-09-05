# GitHub Public Repository Hardening Baseline（GitHub 公开仓库加固基线）

This document records the target GitHub-side security and merge baseline for `huangshirui/lifespace-adapters`.

GitHub Settings（仓库设置） are not fully stored in Git, so this file is a desired/reviewable baseline. Actual server-side state must be verified in GitHub.

## 1. Default branch protection（默认分支保护）

Create a Repository Ruleset（仓库规则集） for default branch `main`:

- Name: `Protect main`
- Enforcement: Active
- Target: Default Branch (`~DEFAULT_BRANCH`)

Rules:

- Restrict deletions;
- Block force pushes / non-fast-forward updates;
- Require linear history;
- Require a Pull Request before merging;
- Required approving review count: `0` while this remains a single-maintainer repository;
- Require conversation resolution;
- Require status checks to pass;
- Require branches to be up to date before merging;
- Merge method: Squash only.

Required status checks:

- `verify`
- `secret-scan`

Let CI run successfully at least once before selecting required check names in the Ruleset.

## 2. Secret protection（密钥保护）

Enable available GitHub security features:

- Secret Scanning（密钥扫描）;
- Push Protection（推送保护）.

CI also runs a full-history Gitleaks scan. Push Protection is preventative; CI history scanning provides continued detection. Neither replaces Human/AI review.

## 3. Vulnerability reporting（漏洞报告）

Enable GitHub Private Vulnerability Reporting（私密漏洞报告）.

`SECURITY.md` instructs contributors not to disclose credentials, exploit detail, real payloads or infrastructure data through public Issue / PR content.

## 4. GitHub Actions security（Actions 安全）

- Default Workflow Permissions should be read-only for repository contents/packages unless a specific workflow needs more.
- Do not allow Actions to create/approve Pull Requests without an explicit reviewed need.
- Every workflow declares minimum `permissions`.
- Third-party Actions/containers should be pinned to trusted releases; security-sensitive tooling should prefer commit/image digest pinning.
- Public fork PRs never receive production secrets.
- CI output is public data: never print Authorization headers, tokens, runtime context or real LifeSpace payloads.

The current `secret-scan` job pins both Gitleaks version and container digest.

## 5. Dependency security（依赖安全）

Once dependency manifests/lockfiles exist:

- commit the lockfile;
- enable Dependabot Alerts;
- evaluate Dependabot Security Updates;
- add dependency/license review where useful;
- use reproducible installs in CI.

Do not create empty dependency-management configuration before there is a real package manifest.

## 6. Merge/history policy（合并 / 历史策略）

For `main`:

- normal changes go through PR;
- Squash Merge only;
- no force push;
- no branch deletion of protected `main`;
- CI must pass;
- review conversations must be resolved.

At repository level, disable Merge Commit and Rebase Merge when convenient so the UI matches the Ruleset rather than presenting merge methods that will later be rejected.

Enable automatic deletion of merged topic branches if desired; this does not apply to protected `main`.

## 7. Repository feature surface（仓库功能表面）

Recommended for this engineering repository:

- Issues: enabled;
- Projects: optional;
- Wiki: disabled unless there is a deliberate documentation use case;
- Discussions: disabled until community discussion is actually needed;
- Pages: disabled unless documentation hosting is deliberately introduced.

Repository Description should clearly state that this is the protocol adapter layer for LifeSpace; Topics can be added once the first implementation exists rather than guessing prematurely.

## 8. Adapter-specific public safety（适配器特有公开安全）

Because adapters sit near authentication and tool execution, public-repository review must check for:

- copied bearer tokens, JWTs, cookies or delegated Agent execution tokens;
- captured MCP requests/responses containing real data;
- raw LifeSpace Runtime Discovery responses from production/staging users;
- live Space/User/Application/Agent identifiers;
- private hostnames, Cloudflare resource IDs or deployment bindings;
- logs that reveal tool arguments/results from real users.

Tests/docs must use Synthetic Data（合成数据） and safe placeholders only.

## 9. Public-release safety pass（公开发布检查）

Before an important release or first real integration, check:

1. current tree for Secret / Personal Data / Private Infrastructure Metadata;
2. Git history for deleted-but-still-recoverable sensitive values;
3. CI logs/artifacts;
4. Issue / PR / review comments;
5. fixtures/examples for synthetic-only data;
6. third-party License / Attribution;
7. `SECURITY.md` and Private Vulnerability Reporting status;
8. actual Ruleset / Secret Scanning / Push Protection state.

## 10. Project-family baseline（项目族基线）

`lifespace-adapters` should maintain the same public-repository safety class as other public Verinasci/AISR engineering repositories such as ALOHA Assistant:

- `AGPL-3.0-or-later`;
- explicit `AGENTS.md` public safety model;
- `SECURITY.md`;
- `verify` + `secret-scan` CI;
- `Protect main` Ruleset;
- Secret Scanning + Push Protection;
- full-history secret scanning.

Project-specific rules may be stricter, but should not silently weaken this shared baseline.
