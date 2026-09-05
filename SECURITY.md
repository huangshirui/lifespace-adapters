# Security Policy（安全策略）

LifeSpace Adapters is a Public Repository（公开仓库） that may sit close to authentication, capability discovery and tool execution. Security work must protect both the adapter software and any LifeSpace data/credentials a deployed adapter can access.

## Reporting a vulnerability（报告漏洞）

Do not place exploit details, credentials, personal data, production logs, private infrastructure identifiers or real LifeSpace payloads in public GitHub Issues, Pull Requests, Discussions, Commit Messages, Review Comments or CI logs.

If GitHub Private Vulnerability Reporting（私密漏洞报告） is enabled, use it. Otherwise contact the maintainer privately before sharing sensitive technical details.

A safe first report should include only the affected component, impact, prerequisites and a minimal reproduction using Synthetic Data（合成数据）.

## Repository disclosure boundary（公开仓库披露边界）

The repository may contain:

- portable source code;
- public protocol/contract adaptation documentation;
- Synthetic Example / Fixture（合成示例 / 测试夹具）;
- public compatibility metadata.

It must not contain:

- real conversations, prompts, memories, emails, calendars, files, location or other user content;
- production/staging datasets, database dumps, traces, request captures or real discovery/tool payloads;
- API keys, OAuth secrets/tokens, JWTs, cookies, private keys, passwords, webhook secrets, delegated Agent tokens, signed private URLs or similar credentials;
- live Space/User/Application/Agent identifiers copied from private environments;
- non-public Cloudflare/provider account/resource IDs, origin IPs, private hosts/routes or deployment-only topology;
- private Connector / MCP / Tool / Notion / repository content.

Runtime secrets and live configuration belong in deployment-platform Secret / Environment / Binding mechanisms, never in Git.

## Adapter-specific risks（适配器特有风险）

### Credential leakage（凭据泄露）

Never log Authorization headers, bearer/JWT values, delegated Agent execution tokens, cookies or complete authenticated context objects.

### Cross-user / cross-Space leakage（跨用户 / 跨空间泄露）

Discovery results, caches, tool arguments/results and error details must never be reused across authenticated contexts unless the cache key and data classification make that separation explicit and safe.

### Authority broadening（权限扩大）

The adapter must not convert tool visibility into authorization, invent Grants/Delegations, or use a broad administrator/service credential to bypass user-scoped authority. Execution must go through canonical LifeSpace authorization checks.

### Stale discovery（过期发现）

A client may hold stale `tools/list` state after Membership / Grant / Delegation changes. The adapter must treat execution-time LifeSpace authorization as authoritative and surface denial safely.

### Schema weakening（契约弱化）

Protocol conversion must not drop security/consistency-relevant metadata such as required concurrency evidence or silently approximate unsupported input semantics. Unsupported cases should fail closed.

## If a disclosure is found（发现泄露时）

1. Stop copying/referencing the exposed value.
2. Revoke/rotate affected credentials immediately where applicable.
3. Treat Git history as persistent until explicitly cleaned.
4. If needed, perform history rewrite/cleanup before considering the repository restored.
5. Check CI logs/artifacts, PR/Issue text, review comments and external caches for secondary disclosure.
6. Record remediation without reproducing the sensitive value.

## Public-release gate（公开发布门禁）

Before merging important integration/runtime changes, perform a Public-repository Safety Pass（公开仓库安全检查） over:

- current tree/diff;
- Git history;
- CI logs/artifacts;
- PR/Issue/review content;
- generated fixtures/examples;
- third-party license/attribution.

GitHub Secret Scanning / Push Protection and the CI full-history Gitleaks scan should both be enabled as complementary controls.

See `AGENTS.md` for mandatory Human / AI Contributor（人类 / AI 贡献者） rules.
