## Summary（摘要）

<!-- What changed and why? 改了什么，为什么？ -->

## Adapter / contract impact（适配器 / 契约影响）

- [ ] 不改变 LifeSpace-owned domain / authorization semantics（LifeSpace 所有的领域 / 授权语义）
- [ ] 已核对受影响的 LifeSpace contract/version/revision（契约 / 版本 / 修订）
- [ ] Protocol-visible behavior（协议可见行为）未变化，或已在下方说明
- [ ] 存在兼容 / 迁移 / 部署影响，已在下方说明

说明：

## Verification（验证）

<!-- List checks actually run. 只列实际执行过的检查。 -->

- [ ] `verify`
- [ ] `secret-scan`
- [ ] 相关 adapter tests / integration checks 已执行

未执行或未通过的检查：

## Authorization / safety boundary（授权 / 安全边界）

- [ ] 未在 Adapter 中重复实现 Membership / Grant / Delegation / Policy 权限逻辑
- [ ] 执行仍通过 canonical LifeSpace operation（LifeSpace 权威操作）完成当前权限与语义校验
- [ ] 未暴露 Platform Admin（平台管理）控制面能力
- [ ] 未记录或提交 Authorization / Token / JWT / Cookie 等凭据

## Public-repository safety（公开仓库安全）

- [ ] 未包含 Secret / Credential（密钥 / 凭据）、`.env`、Signed URL 或私密部署配置
- [ ] 未包含真实用户 / Space / Agent 数据、Production / Staging payload、日志、Trace 或 Request Capture
- [ ] 未包含不应公开的基础设施 Identifier / Topology（标识 / 拓扑）
- [ ] 示例与测试数据均为 Synthetic Data（合成数据）
- [ ] 新增第三方材料的 License / Attribution（许可 / 署名）已核验

## Notes（补充）

<!-- Compatibility, risks, follow-ups, screenshots using synthetic/public data only, etc. -->
