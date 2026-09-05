# packages/mcp

面向 ChatGPT 与其他 AI / Agent 的 MCP / Tool（模型上下文协议 / 工具）接口层。

V0.1 原则：

- AI 直接读取结构化 Canonical System Graph（规范系统图谱），不依赖视觉识图；
- 默认读取最新 Draft（草稿）的当前完整状态；
- Change Log（变更日志）和历史 Revision（修订版本）按需查询；
- AI 可以修改 Draft；
- Publish（发布）Tool 只有在用户明确发布指令下才能调用；
- 所有修改保留 Actor（操作者）与 Source（来源）。

具体能力边界见 `docs/mcp-tool-surface-v0.1.md`。
