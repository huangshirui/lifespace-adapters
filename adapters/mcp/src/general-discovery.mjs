import { loadSelectedModelSemantics } from "./progressive-discovery.mjs";
import { projectSelectedModelsToMcp } from "./projection.mjs";
import { DOMAIN_PROFILES } from "./domain-projection.mjs";

const INVENTORY_PATH = "/api/v1/me/_discovery/inventory";
const SEARCH_HINTS = Object.freeze({
  calendar: Object.freeze(["calendar", "event", "schedule", "日程", "日历", "安排", "会议"]),
  tasks: Object.freeze(["task", "todo", "to-do", "待办", "任务"]),
});

function fail(message) {
  throw new Error(`LifeSpace MCP general discovery: ${message}`);
}

function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid inventory");
  return value;
}

function visibleEntries(rawInventory) {
  const inventory = object(rawInventory);
  if (!Array.isArray(inventory.models) || !Array.isArray(inventory.spaces)) {
    fail("invalid inventory model/Space list");
  }
  return inventory.models.flatMap((model) => {
    const spaces = inventory.spaces
      .filter((space) => !model.spaceId || model.spaceId === space.spaceId)
      .filter((space) => (space.models ?? []).some((edge) =>
        edge.modelKey === model.key && Array.isArray(edge.access) && edge.access.includes("read"),
      ))
      .map((space) => ({ spaceId: space.spaceId, spaceName: space.spaceName }))
      .sort((a, b) => a.spaceId.localeCompare(b.spaceId));
    return spaces.length ? [{ model, spaces }] : [];
  });
}

function tokensForModel(model) {
  const labels = [model.key, model.display?.singular, model.display?.plural, ...(model.capabilities ?? [])]
    .filter((value) => typeof value === "string");
  const domains = Object.values(DOMAIN_PROFILES).filter((profile) =>
    profile.modelKeys.includes(model.key)
      || (model.capabilities ?? []).some((c) => profile.capabilities.includes(c)),
  );
  for (const profile of domains) {
    labels.push(profile.id, profile.title, ...(SEARCH_HINTS[profile.id] ?? []));
  }
  return labels.map((s) => s.toLowerCase());
}

/**
 * Task relevance search, not an authorization engine or a new Model Registry.
 * Results come ONLY from the current LifeSpace-pruned inventory. No query to
 * unpublished model catalogs, inferred grants, or untrusted client scopes.
 */
export function findCapabilitiesFromInventory(inventory, intent, limit = 5) {
  if (typeof intent !== "string" || !intent.trim() || intent.length > 240) {
    fail("intent must have 1-240 characters");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 8) fail("limit must be 1-8");
  const phrase = intent.trim().toLowerCase();
  const matches = visibleEntries(inventory).map(({ model, spaces }) => {
    const matched = tokensForModel(model)
      .filter((label) => label.length >= 2 && (phrase.includes(label) || label.includes(phrase)));
    return { model, spaces, score: matched.reduce((max, s) => Math.max(max, s.length), 0) };
  }).filter((entry) => entry.score > 0);
  matches.sort((a, b) =>
    b.score - a.score
      || a.model.key.localeCompare(b.model.key)
      || (a.model.spaceId ?? "").localeCompare(b.model.spaceId ?? ""),
  );
  return matches.slice(0, limit).map(({ model, spaces }) => ({
    modelKey: model.key,
    ...(model.origin === "external" ? { origin: "external", sourceSpaceId: model.spaceId } : {}),
    title: model.display?.plural ?? model.key,
    operations: ["query"],
    spaces,
  }));
}

export async function findTaskCapabilities({ fetchJson, intent, limit = 5 }) {
  if (typeof fetchJson !== "function") fail("fetchJson is required");
  const answer = object(await fetchJson(INVENTORY_PATH));
  return findCapabilitiesFromInventory(object(answer.data), intent, limit);
}

/**
 * For generic query_records only: load the selected current model's immutable
 * semantics and reuse the exactly same projected Query builder used by
 * domain-specific MCP tools. Core still checks access on tools/call.
 */
export async function resolveGeneralQueryBinding({ fetchJson, modelKey, spaceId }) {
  if (typeof fetchJson !== "function") fail("fetchJson is required");
  if (typeof modelKey !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(modelKey)) fail("invalid modelKey");
  if (typeof spaceId !== "string" || !/^spc_[A-Za-z0-9_-]+$/u.test(spaceId)) fail("invalid spaceId");

  const answer = object(await fetchJson(INVENTORY_PATH));
  const inventory = object(answer.data);
  const candidates = visibleEntries(inventory)
    .filter((entry) => entry.model.key === modelKey && entry.spaces.some((space) => space.spaceId === spaceId));
  if (!candidates.length) fail("model is not readable in selected Space");
  const entries = inventory.models.filter((model) => model.key === modelKey);
  if (entries.some((entry) => entry.origin === "external")
    && entries.some((entry) => entry.origin !== "external")) fail("ambiguous Native/External model key");

  const selected = await loadSelectedModelSemantics({
    selectedModelKeys: [modelKey],
    fetchJson: (path) => path === INVENTORY_PATH ? { data: inventory } : fetchJson(path),
  });
  const { bindings } = projectSelectedModelsToMcp(selected);
  const compatible = Object.values(bindings).filter((binding) =>
    binding.modelKey === modelKey && binding.allowedSpaceIds.includes(spaceId),
  );
  if (compatible.length !== 1) fail("model/Space resolves to an ambiguous Query binding");
  return compatible[0];
}

export const GENERAL_QUERY_INPUT_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["modelKey", "spaceId"],
  properties: {
    modelKey: { type: "string", minLength: 1, description: "Model key returned by find_capabilities." },
    spaceId: { type: "string", minLength: 1, description: "Readable LifeSpace Space returned by find_capabilities." },
    search: { type: "string", minLength: 1 },
    filters: { type: "array", maxItems: 30, items: {
      type: "object", required: ["field", "operator"],
      additionalProperties: false,
      properties: {
        field: { type: "string" },
        operator: { type: "string" },
        value: {},
      },
    } },
    sort: { type: "array", maxItems: 8, items: {
      type: "object", required: ["field", "direction"],
      additionalProperties: false,
      properties: { field: { type: "string" }, direction: { enum: ["asc", "desc"] } },
    } },
    limit: { type: "integer", minimum: 1, maximum: 200 },
    cursor: { type: "string", minLength: 1 },
    advancedFilter: { type: "object" },
  },
});

export const GENERAL_DISCOVERY_INPUT_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["intent"],
  properties: {
    intent: { type: "string", minLength: 1, maxLength: 240, description: "Current task expressed in natural language." },
    limit: { type: "integer", minimum: 1, maximum: 8, default: 5 },
  },
});
