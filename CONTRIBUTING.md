# Contributing to LifeSpace Adapters（参与贡献）

LifeSpace Adapters is a public open-source protocol-adaptation repository around LifeSpace. Contributions must preserve both protocol correctness and the boundary that LifeSpace remains the authoritative source for domain semantics and authorization.

## Before you start（开始前）

Read:

1. `AGENTS.md`;
2. `README.md`;
3. `docs/architecture.md`;
4. `docs/lifespace-contract-consumption.md`;
5. the relevant adapter document, currently `docs/mcp-adapter.md`;
6. the canonical LifeSpace contract/docs that own the behavior being projected.

If the required LifeSpace behavior is missing or ambiguous, fix/clarify it in LifeSpace rather than creating a private interpretation here.

## Public repository safety（公开仓库安全）

Only commit content suitable for permanent public disclosure.

- Use Synthetic Data（合成数据） only.
- Do not commit Secret / Credential（密钥 / 凭据）, `.env`, bearer tokens, cookies, JWTs, private keys or signed URLs.
- Do not commit real LifeSpace user/Space/Agent data, production/staging request captures, logs, traces or discovery payloads.
- Do not commit private infrastructure identifiers/topology.
- Verify License / Attribution（许可 / 署名） before adding third-party code, schemas or assets.

Sensitive vulnerabilities must follow `SECURITY.md` and must not be disclosed through public Issue / PR content.

## Change approach（修改方式）

For protocol-surface changes:

1. identify the canonical LifeSpace contract/semantics being consumed;
2. document any compatibility assumption;
3. update deterministic projection/mapping code;
4. add positive and deny/error tests;
5. verify stale/revoked authority remains denied by LifeSpace execution;
6. update adapter docs when externally observable protocol behavior changes.

Do not duplicate LifeSpace Model Definition, permission logic or platform migrations into this repository.

## Pull Request（拉取请求）

PRs should state:

- what changed and why;
- which LifeSpace contract/version/revision assumptions are affected;
- whether protocol-visible behavior changes;
- tests/checks actually run;
- compatibility or deployment impact;
- any unverified behavior.

Perform a Public-repository Safety Pass（公开仓库安全检查） before submitting.

## Checks（检查）

The bootstrap CI contains:

- `verify`: repository structure/boundary baseline checks;
- `secret-scan`: Gitleaks full Git-history scan.

When implementation introduces a package/runtime, extend CI with the relevant Type Check / Lint / Test / Build checks and use reproducible dependency installation.

If a check cannot run, state that explicitly rather than describing unverified behavior as working.

## Merge policy（合并策略）

The target `main` policy is PR + required CI + resolved review conversations + Squash Merge（压缩合并）. Server-side Ruleset status is tracked separately from Git content and must be verified in GitHub Settings.

## License（许可）

Unless a file explicitly states another compatible license, contributions are provided under **GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`)**.
