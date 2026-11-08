// Protocol-only projection of Core's exact, current immutable Native contract.
// Core owns schema validation, Policy, concurrency, Grants and Change attribution.
const operations = { create: "POST", update: "PATCH", delete: "DELETE" };
export function projectNativeMutations(selection) {
  const result = { tools: [], bindings: {} };
  for (const { detail, spaces } of selection.models) {
    const m = detail.mutations;
    if (!m) continue;
    if (detail.origin === "external" || !/^mct_[a-f0-9]{64}$/u.test(m.contractId || "")
      || m.modelVersion !== detail.version || m.schemaHash !== detail.schemaHash
      || !m.operations || typeof m.operations !== "object" || Array.isArray(m.operations)
      || !m.$defs || typeof m.$defs !== "object" || Array.isArray(m.$defs)
      || !/^[a-z][a-z0-9_]{1,62}$/u.test(detail.key)) throw new Error("Invalid Core mutation contract evidence");
    const allowed = spaces.filter(s => s.access.includes("read") && s.access.includes("write")).map(s => s.spaceId);
    if (!allowed.length) continue;
    // No external schema retrieval. A missing or non-local ref fails closed.
    for (const ref of JSON.stringify({ operations: m.operations, $defs: m.$defs }).matchAll(/"\$ref":"([^"]+)"/gu)) {
      if (!ref[1].startsWith("#/$defs/") || !Object.hasOwn(m.$defs, ref[1].slice(8))) {
        throw new Error("Unresolved Core mutation schema ref");
      }
    }
    for (const [operation, input] of Object.entries(m.operations)) {
      if (!Object.hasOwn(operations, operation) || !input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("Unsupported Core mutation operation");
      }
      const name = `lifespace.${operation}.${detail.key}`;
      const properties = { spaceId: { type: "string", enum: allowed }, data: structuredClone(input) };
      if (operation !== "create") properties.recordId = { type: "string", pattern: "^rec_[A-Za-z0-9_-]+$" };
      result.tools.push({ name, title: `${operation} ${detail.display.singular}`,
        description: `LifeSpace Native ${operation}. Core rechecks current authority, model Policy and optimistic concurrency.`,
        annotations: { readOnlyHint: false, destructiveHint: operation !== "create", idempotentHint: false, openWorldHint: false },
        inputSchema: { type: "object", additionalProperties: false, properties,
          required: ["spaceId", "data", ...(operation === "create" ? [] : ["recordId"])], $defs: structuredClone(m.$defs) } });
      result.bindings[name] = { kind: "native-mutation", operation, modelKey: detail.key,
        allowedSpaceIds: allowed, contractId: m.contractId };
    }
  }
  return result;
}
export function buildNativeMutation(binding, args) {
  if (!binding || binding.kind !== "native-mutation" || !Object.hasOwn(operations, binding.operation)
    || !args || typeof args !== "object" || Array.isArray(args)
    || Object.keys(args).some(k => !["spaceId", "recordId", "data"].includes(k))
    || !binding.allowedSpaceIds.includes(args.spaceId)
    || !args.data || typeof args.data !== "object" || Array.isArray(args.data)) throw new Error("Invalid mutation arguments");
  if (binding.operation === "create" ? args.recordId !== undefined : !/^rec_[A-Za-z0-9_-]+$/u.test(args.recordId || "")) {
    throw new Error("Invalid mutation record selector");
  }
  if (binding.operation !== "create" && (!Number.isSafeInteger(args.data.version) || args.data.version < 1)) {
    throw new Error("Current record version required");
  }
  const path = `/api/v1/spaces/${encodeURIComponent(args.spaceId)}/models/${encodeURIComponent(binding.modelKey)}/records`;
  return { method: operations[binding.operation], path: path + (binding.operation === "create" ? "" : "/" + encodeURIComponent(args.recordId)), body: args.data };
}
