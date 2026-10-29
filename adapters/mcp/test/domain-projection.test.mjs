import assert from "node:assert/strict";
import test from "node:test";
import {
  DOMAIN_PROFILES,
  resolveMcpEndpoint,
  selectDomainInventory,
  projectDomainQuerySurface,
} from "../src/domain-projection.mjs";

const taskHash = "a".repeat(64);
const eventHash = "b".repeat(64);
const extHash = "c".repeat(64);

function inventory() {
  return {
    semanticDetailPathTemplate: "/api/v1/spaces/{spaceId}/_discovery/models/{modelKey}",
    models: [
      { key: "event", version: 3, schemaHash: eventHash, display: { singular: "Event", plural: "Events" }, capabilities: ["calendar"], actions: [] },
      { key: "task", version: 5, schemaHash: taskHash, display: { singular: "Task", plural: "Tasks" }, capabilities: [], actions: [] },
      { key: "secret", version: 1, schemaHash: extHash, display: { singular: "Secret", plural: "Secrets" }, capabilities: [], actions: [] },
    ],
    spaces: [
      { spaceId: "spc_a", spaceName: "A", models: [
        { modelKey: "event", access: ["read", "write"] },
        { modelKey: "task", access: ["read"] },
        { modelKey: "secret", access: ["read"] },
      ] },
      { spaceId: "spc_b", spaceName: "B", models: [
        { modelKey: "event", access: ["read"] },
        { modelKey: "task", access: ["write"] },
      ] },
      { spaceId: "spc_c", spaceName: "C", models: [
        { modelKey: "event", access: [] },
        { modelKey: "task", access: ["read"] },
      ] },
    ],
  };
}

function detail(key, version, schemaHash) {
  return {
    data: {
      key,
      version,
      schemaHash,
      display: { singular: key, plural: key + "s" },
      query: {
        canonical: {
          invocation: { method: "POST", pathTemplate: "/api/v1/spaces/{spaceId}/models/{modelKey}/records/query" },
          composition: {
            selectionFacets: ["search", "filter"],
            selectionCombine: "intersection",
            ordering: "sort",
            pagination: "cursor-pagination",
          },
          search: { fields: ["title"], minLength: 1, maxLength: 100 },
          filter: { maxDepth: 8, maxNodes: 100, targets: [
            { field: "createdAt", kind: "envelope", valueType: "datetime", operators: ["eq", "within"], nullable: false },
            ...(key === "event" ? [{
              field: "when", kind: "calendar-range", valueType: "temporal-range", operators: ["overlaps", "contains", "before", "after", "kindIs"], nullable: false,
            }] : []),
          ] },
          sort: {
            fields: ["createdAt"], directions: ["asc", "desc"], maxCriteria: 8,
            default: [{ field: "createdAt", direction: "desc" }],
            nullPlacement: "last", stableTieBreaker: "record-id-asc",
          },
          pagination: {
            limit: { minimum: 1, maximum: 200, default: 100 },
            cursor: { opaque: true, binds: ["normalized-filter"], snapshotConsistency: false },
          },
        },
      },
    },
  };
}

test("registered endpoints are distinct logical resources, with no query-parameter switching", () => {
  assert.deepEqual(Object.keys(DOMAIN_PROFILES), ["calendar", "tasks"]);
  assert.deepEqual(resolveMcpEndpoint("/mcp"), { kind: "general", domain: null });
  assert.deepEqual(resolveMcpEndpoint("/mcp/calendar"), { kind: "domain", domain: "calendar" });
  assert.deepEqual(resolveMcpEndpoint("/mcp/tasks"), { kind: "domain", domain: "tasks" });
  assert.equal(resolveMcpEndpoint("/mcp/health"), null);
  assert.equal(resolveMcpEndpoint("/mcp/calendar/other"), null);
  assert.equal(resolveMcpEndpoint("/mcp?domain=calendar"), null);
  assert.equal(resolveMcpEndpoint("/mcp/%2e%2e"), null);
});

test("Calendar profile selects current-principal calendar-capable models only", () => {
  const data = selectDomainInventory(inventory(), "calendar");
  assert.deepEqual(data.models.map((m) => m.key), ["event"]);
  assert.deepEqual(data.spaces.map((s) => s.spaceId), ["spc_a", "spc_b"]);
  assert.deepEqual(data.spaces[0].models, [{ modelKey: "event", access: ["read", "write"] }]);
  assert.deepEqual(inventory().models.map((m) => m.key), ["event", "task", "secret"]);
});

test("Tasks profile preserves read-only edges and excludes an unreadable Space", () => {
  const data = selectDomainInventory(inventory(), "tasks");
  assert.deepEqual(data.models.map((m) => m.key), ["task"]);
  assert.deepEqual(data.spaces.map((s) => s.spaceId), ["spc_a", "spc_c"]);
  assert.deepEqual(data.spaces[1].models, [{ modelKey: "task", access: ["read"] }]);
});

test("no authorized models yields no tools, and unsupported models never fall back to all", async () => {
  const missing = inventory();
  missing.spaces = [{ spaceId: "spc_z", models: [{ modelKey: "event", access: [] }] }];
  const selected = selectDomainInventory(missing, "calendar");
  assert.deepEqual(selected.models, []);
  assert.deepEqual(selected.spaces, []);
  const requests = [];
  const result = await projectDomainQuerySurface({
    endpoint: "/mcp/calendar",
    fetchJson: async (path) => { requests.push(path); return { data: missing }; },
  });
  assert.deepEqual(result.tools, []);
  assert.deepEqual(result.bindings, {});
  assert.deepEqual(requests, ["/api/v1/me/_discovery/inventory"]);
});

test("External models with the same key remain Space-specific", () => {
  const source = {
    ...inventory(),
    models: [
      { key: "task", origin: "external", spaceId: "spc_a", schemaHash: "1".repeat(64), display: { singular: "A task", plural: "A tasks" } },
      { key: "task", origin: "external", spaceId: "spc_c", schemaHash: "2".repeat(64), display: { singular: "C task", plural: "C tasks" } },
    ],
  };
  const result = selectDomainInventory(source, "tasks");
  assert.deepEqual(result.models.map((m) => m.spaceId), ["spc_a", "spc_c"]);
  assert.deepEqual(result.spaces.map((s) => s.spaceId), ["spc_a", "spc_c"]);
});

test("mixed Native and External identities with one key fail closed", () => {
  const source = inventory();
  source.models.push({ key: "task", origin: "external", spaceId: "spc_a", schemaHash: "3".repeat(64) });
  assert.throws(() => selectDomainInventory(source, "tasks"), /ambiguous Native\/External/u);
});

test("a Native capability match cannot leak an unrelated External Space with the same key", () => {
  const source = inventory();
  source.models.push({
    key: "event", origin: "external", spaceId: "spc_c", schemaHash: "3".repeat(64),
    display: { singular: "Provider event", plural: "Provider events" },
  });
  assert.throws(() => selectDomainInventory(source, "calendar"), /ambiguous Native\\/External/u);
});

test("unknown profiles and invalid inventory fail closed", () => {
  assert.throws(() => selectDomainInventory(inventory(), "football"), /unknown domain/u);
  assert.throws(() => selectDomainInventory({ models: [], spaces: null }, "tasks"), /inventory must contain/u);
});

test("domain tool projection loads only chosen semantics and reuses Canonical Query builder", async () => {
  const requests = [];
  const surface = await projectDomainQuerySurface({
    endpoint: "/mcp/calendar",
    fetchJson: async (path) => {
      requests.push(path);
      if (path === "/api/v1/me/_discovery/inventory") return { data: inventory() };
      if (path === "/api/v1/spaces/spc_a/_discovery/models/event") return detail("event", 3, eventHash);
      throw new Error("Unexpected lookup " + path);
    },
  });
  assert.deepEqual(requests, [
    "/api/v1/me/_discovery/inventory",
    "/api/v1/spaces/spc_a/_discovery/models/event",
  ]);
  assert.deepEqual(surface.tools.map((t) => t.name), ["lifespace.query.event"]);
  assert.deepEqual(surface.tools[0].inputSchema.properties.spaceId.enum, ["spc_a", "spc_b"]);
  assert.equal(surface.bindings["lifespace.query.event"].modelKey, "event");
  assert.equal(surface.bindings["lifespace.query.task"], undefined);
});

test("stale semantic hash fails closed even inside a domain endpoint", async () => {
  await assert.rejects(
    projectDomainQuerySurface({
      endpoint: "/mcp/calendar",
      fetchJson: async (path) => path.endsWith("/inventory")
        ? { data: inventory() }
        : detail("event", 3, taskHash),
    }),
    /identity drift/u,
  );
});

test("general endpoint does not silently expand into all model tools", async () => {
  await assert.rejects(
    projectDomainQuerySurface({ endpoint: "/mcp", fetchJson: async () => { throw Error("not reached"); } }),
    /expected a registered domain endpoint/u,
  );
});
