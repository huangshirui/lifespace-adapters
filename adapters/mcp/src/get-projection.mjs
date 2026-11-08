// Core's per-request MCP Server operation projection is the sole Get tool gate.
// Native record semantics and permissions remain owned by LifeSpace Core.
const MODEL = /^[a-z][a-z0-9_]{1,62}$/u;
const RECORD = /^rec_[A-Za-z0-9_-]+$/u;
const SPACE = /^spc_[A-Za-z0-9_-]+$/u;

export function projectNativeGets(selection) {
  const result = { tools: [], bindings: {} };
  for (const { detail, spaces } of selection.models) {
    if (detail.origin === "external" || !Array.isArray(detail.mcpOperations)
      || !detail.mcpOperations.includes("get")) continue;
    if (typeof detail.key !== "string" || !MODEL.test(detail.key)) {
      throw new Error("Invalid Core Native Get model key");
    }
    const allowed = spaces.filter(s =>
      typeof s.spaceId === "string" && SPACE.test(s.spaceId)
      && Array.isArray(s.access) && s.access.includes("read")
    ).map(s => s.spaceId);
    if (!allowed.length) continue;
    const toolName = "lifespace.get." + detail.key;
    const singular = detail.display?.singular;
    result.tools.push({
      name: toolName,
      title: "Get " + (typeof singular === "string" ? singular : detail.key),
      description: "Fetch one Native LifeSpace record by ID. Current Core MCP Server, Space, Data Grant, Policy and OAuth Scope are verified on every execution.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: {
        type: "object", additionalProperties: false,
        properties: {
          spaceId: { type: "string", enum: allowed },
          recordId: { type: "string", pattern: "^rec_[A-Za-z0-9_-]+$" },
        },
        required: ["spaceId", "recordId"],
      },
    });
    result.bindings[toolName] = {
      kind: "native-get", modelKey: detail.key, allowedSpaceIds: allowed,
    };
  }
  return result;
}

export function buildNativeGet(binding, args) {
  if (!binding || binding.kind !== "native-get"
    || typeof binding.modelKey !== "string" || !MODEL.test(binding.modelKey)
    || !Array.isArray(binding.allowedSpaceIds)
    || !args || typeof args !== "object" || Array.isArray(args)
    || Object.keys(args).some(k => k !== "spaceId" && k !== "recordId")
    || typeof args.spaceId !== "string" || !SPACE.test(args.spaceId)
    || !binding.allowedSpaceIds.includes(args.spaceId)
    || typeof args.recordId !== "string" || !RECORD.test(args.recordId)) {
    throw new Error("Invalid Native Get arguments");
  }
  return {
    method: "GET",
    path: "/api/v1/spaces/" + encodeURIComponent(args.spaceId)
      + "/models/" + encodeURIComponent(binding.modelKey)
      + "/records/" + encodeURIComponent(args.recordId),
  };
}
