import { loadSelectedModelSemantics } from "./progressive-discovery.mjs";
import { projectSelectedModelsToMcp } from "./projection.mjs";

// MCP display profiles are adapter configuration, not LifeSpace Models or permissions.
// Only actively supported read-only surfaces are registered in V1.
export const DOMAIN_PROFILES = Object.freeze({
  calendar: Object.freeze({
    id: "calendar",
    title: "Calendar",
    capabilities: Object.freeze(["calendar"]),
    modelKeys: Object.freeze([]),
    operations: Object.freeze(["query"]),
  }),
  tasks: Object.freeze({
    id: "tasks",
    title: "Tasks",
    capabilities: Object.freeze([]),
    modelKeys: Object.freeze(["task"]),
    operations: Object.freeze(["query"]),
  }),
});

const INVENTORY_PATH = "/api/v1/me/_discovery/inventory";

function fail(message) {
  throw new Error(`LifeSpace MCP domain projection: ${message}`);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

/**
 * Resolves one stable MCP resource path. Query parameters are intentionally not
 * considered: they cannot select a new virtual server or grant permissions.
 */
export function resolveMcpEndpoint(pathname) {
  if (pathname === "/mcp") return { kind: "general", domain: null };
  if (typeof pathname !== "string") return null;
  const match = /^\/mcp\/([a-z][a-z0-9-]*)$/u.exec(pathname);
  if (!match || !Object.hasOwn(DOMAIN_PROFILES, match[1])) return null;
  return { kind: "domain", domain: match[1] };
}

function matchesProfile(entry, profile) {
  return profile.modelKeys.includes(entry.key)
    || (Array.isArray(entry.capabilities)
      && entry.capabilities.some((capability) => profile.capabilities.includes(capability)));
}

function readableEdge(edge) {
  return Array.isArray(edge.access) && edge.access.includes("read");
}

/**
 * Narrows *Core-pruned* runtime inventory to one display domain. Never takes
 * application/user/Space permissions from request arguments or static profiles.
 * External entries remain Space-specific, including when schemas differ.
 */
export function selectDomainInventory(inventoryValue, domain) {
  const inventory = object(inventoryValue, "inventory");
  const profile = DOMAIN_PROFILES[domain];
  if (!profile) fail("unknown domain");
  if (!Array.isArray(inventory.models) || !Array.isArray(inventory.spaces)) {
    fail("inventory must contain models and spaces");
  }
  const eligible = inventory.models.filter((entry) => matchesProfile(object(entry, "model entry"), profile));
  const originByKey = new Map();
  for (const entry of eligible) {
    if (typeof entry.key !== "string" || !entry.key) fail("invalid model key");
    if (entry.origin === "external" && (typeof entry.spaceId !== "string" || !entry.spaceId)) {
      fail("external model has no Space identity");
    }
    const origin = entry.origin === "external" ? "external" : "native";
    const previous = originByKey.get(entry.key);
    if (previous && previous !== origin) {
      // The existing progressive loader selects by modelKey; fail closed
      // rather than potentially projecting a Native schema over External data.
      fail(`ambiguous Native/External model key ${entry.key}`);
    }
    originByKey.set(entry.key, origin);
  }

  const spaces = inventory.spaces.map((spaceValue) => {
    const space = object(spaceValue, "Space entry");
    const models = Array.isArray(space.models) ? space.models.filter((edge) =>
      readableEdge(edge) && eligible.some((entry) =>
        edge.modelKey === entry.key && (entry.origin !== "external" || entry.spaceId === space.spaceId),
      )) : [];
    return { ...space, models };
  }).filter((space) => space.models.length > 0);

  const selectedModels = eligible.filter((entry) => spaces.some((space) =>
    space.models.some((edge) => edge.modelKey === entry.key)
      && (entry.origin !== "external" || space.spaceId === entry.spaceId),
  ));
  return {
    ...inventory,
    models: selectedModels,
    spaces,
  };
}

/**
 * Read-only domain tool projection, independent of MCP transport and OAuth.
 * fetchJson must use the *authenticated* LifeSpace execution context.
 * Core remains the authority on every subsequent tools/call.
 */
export async function projectDomainQuerySurface({ endpoint, fetchJson }) {
  if (typeof fetchJson !== "function") fail("fetchJson must be a function");
  const route = resolveMcpEndpoint(endpoint);
  if (!route || route.kind !== "domain") fail("expected a registered domain endpoint");
  const response = await fetchJson(INVENTORY_PATH);
  const data = object(object(response, "inventory response").data, "inventory response.data");
  const filtered = selectDomainInventory(data, route.domain);
  const modelKeys = [...new Set(filtered.models.map((entry) => entry.key))].sort();
  if (!modelKeys.length) return { domain: route.domain, tools: [], bindings: {} };

  const selected = await loadSelectedModelSemantics({
    selectedModelKeys: modelKeys,
    fetchJson: (path) => path === INVENTORY_PATH ? { data: filtered } : fetchJson(path),
  });
  return { domain: route.domain, ...projectSelectedModelsToMcp(selected) };
}
