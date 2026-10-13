import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSelectedModelSemantics } from "../src/progressive-discovery.mjs";
import { projectSelectedModelsToMcp } from "../src/projection.mjs";
const key = "external_sample";
const entries = ["spc_first", "spc_second"].map((spaceId, index) => ({ key, origin: "external", spaceId, schemaHash: String(index).repeat(64) }));
function detail(entry) { return { ...entry, display: { singular: "Sample", plural: "Samples" }, query: { canonical: {
 invocation: { method: "POST", pathTemplate: "/api/v1/spaces/{spaceId}/models/{modelKey}/records/query" }, composition: { selectionFacets: ["search", "filter"], selectionCombine: "intersection", ordering: "sort", pagination: "cursor-pagination" }, search: null,
 filter: { maxDepth: 2, maxNodes: 20, targets: [{ field: entry.spaceId === "spc_first" ? "f_first" : "f_second", valueType: "number", operators: ["eq"] }] }, sort: { fields: ["f_first"], directions: ["asc","desc"], maxCriteria: 1, default: [], nullPlacement: "provider-defined", stableTieBreaker: "provider-defined" }, pagination: { limit: { minimum: 1, maximum: 100 }, cursor: { opaque: true } }
 } } }; }
const inventory = { models: entries, spaces: entries.map(e => ({ spaceId: e.spaceId, spaceName: "Synthetic", models: [{ modelKey: key, access: ["read"] }] })), semanticDetailPathTemplate: "/api/v1/spaces/{spaceId}/_discovery/models/{modelKey}" };
test("same External business key has independent Space schema and execution bindings", async () => {
 const selected = await loadSelectedModelSemantics({ selectedModelKeys: [key], fetchJson: async path => ({ data: path.endsWith("inventory") ? inventory : detail(entries.find(e => path.includes(e.spaceId))) }) });
 const projected = projectSelectedModelsToMcp(selected); assert.equal(projected.tools.length, 2);
 for (const entry of entries) { const binding = projected.bindings[`lifespace.query.${key}.${entry.spaceId}`]; assert.deepEqual(binding.allowedSpaceIds, [entry.spaceId]); assert.deepEqual(Object.keys(binding.filter.targets), [entry.spaceId === "spc_first" ? "f_first" : "f_second"]); }
});
test("dynamic External detail cannot cross Space or accept a stale schema", async () => {
 await assert.rejects(loadSelectedModelSemantics({ selectedModelKeys: [key], fetchJson: async path => ({ data: path.endsWith("inventory") ? inventory : detail(entries[1]) }) }), /identity drift/);
});
