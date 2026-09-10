function fail(message) {
  throw new Error(`LifeSpace MCP discovery: ${message}`);
}

function unwrap(response, label) {
  if (!response || typeof response !== "object" || Array.isArray(response) || !("data" in response)) {
    fail(`${label} must be a LifeSpace success envelope`);
  }
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
    fail(`${label}.data must be an object`);
  }
  return response.data;
}

function readableSpacesForModel(inventory, modelKey) {
  return (inventory.spaces ?? []).flatMap((space) => {
    const edge = (space.models ?? []).find((model) => model.modelKey === modelKey);
    return edge?.access?.includes("read")
      ? [{ spaceId: space.spaceId, spaceName: space.spaceName, access: [...edge.access] }]
      : [];
  }).sort((a, b) => a.spaceId.localeCompare(b.spaceId));
}

function detailPath(template, spaceId, modelKey) {
  if (typeof template !== "string" || !template.includes("{spaceId}") || !template.includes("{modelKey}")) {
    fail("inventory semanticDetailPathTemplate is unsupported");
  }
  return template
    .replace("{spaceId}", encodeURIComponent(spaceId))
    .replace("{modelKey}", encodeURIComponent(modelKey));
}

function sameIdentity(inventoryModel, detail) {
  return detail.key === inventoryModel.key
    && detail.version === inventoryModel.version
    && detail.schemaHash === inventoryModel.schemaHash;
}

export async function loadSelectedModelSemantics({ fetchJson, selectedModelKeys }) {
  if (typeof fetchJson !== "function") fail("fetchJson must be a function");
  if (!Array.isArray(selectedModelKeys) || selectedModelKeys.length === 0) fail("selectedModelKeys must be a non-empty array");
  const selected = [...new Set(selectedModelKeys)].sort();
  const inventory = unwrap(await fetchJson("/api/v1/me/_discovery/inventory"), "inventory response");
  if (!Array.isArray(inventory.models) || !Array.isArray(inventory.spaces)) fail("inventory must contain models and spaces arrays");

  const models = [];
  for (const modelKey of selected) {
    const inventoryModel = inventory.models.find((model) => model.key === modelKey);
    if (!inventoryModel) fail(`selected model ${JSON.stringify(modelKey)} is not visible in inventory`);
    const spaces = readableSpacesForModel(inventory, modelKey);
    if (!spaces.length) fail(`selected model ${JSON.stringify(modelKey)} has no readable Space`);
    const path = detailPath(inventory.semanticDetailPathTemplate, spaces[0].spaceId, modelKey);
    const detail = unwrap(await fetchJson(path), `semantic detail response for ${modelKey}`);
    if (!sameIdentity(inventoryModel, detail)) {
      fail(`semantic detail identity drift for ${modelKey}; refresh inventory before projecting tools`);
    }
    models.push({ inventoryModel, detail, spaces });
  }
  return { inventory, models };
}
