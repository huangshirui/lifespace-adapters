import assert from "node:assert/strict";
import test from "node:test";
import { buildLifeSpaceQueryRequest, projectSelectedModelsToMcp } from "../src/projection.mjs";
import { loadSelectedModelSemantics } from "../src/progressive-discovery.mjs";

const hashTask = "a".repeat(64);
const hashEvent = "b".repeat(64);

function canonical({ calendar = false } = {}) {
  return {
    invocation: { method: "POST", pathTemplate: "/api/v1/spaces/{spaceId}/models/{modelKey}/records/query" },
    composition: {
      selectionFacets: ["search", "filter"],
      selectionCombine: "intersection",
      ordering: "sort",
      pagination: "cursor-pagination",
    },
    search: { fields: ["summary"], minLength: 1, maxLength: 100 },
    filter: {
      maxDepth: 8,
      maxNodes: 100,
      targets: [
        { field: "createdAt", kind: "envelope", valueType: "datetime", operators: ["eq", "ne", "lt", "lte", "gt", "gte", "within"], nullable: false },
        { field: "dueDate", kind: "field", valueType: "date", operators: ["eq", "ne", "lt", "lte", "gt", "gte", "within", "isNull", "isNotNull"], nullable: true },
        { field: "status", kind: "field", valueType: "enum", operators: ["eq", "ne"], nullable: false },
        ...(calendar ? [{ field: "when", kind: "calendar-range", valueType: "temporal-range", operators: ["overlaps", "contains", "before", "after", "kindIs"], nullable: false }] : []),
      ],
    },
    sort: {
      fields: ["createdAt", "dueDate", "updatedAt"], directions: ["asc", "desc"], maxCriteria: 8,
      default: [{ field: "createdAt", direction: "desc" }], nullPlacement: "last", stableTieBreaker: "record-id-asc",
    },
    pagination: {
      limit: { minimum: 1, maximum: 200, default: 100 },
      cursor: { opaque: true, binds: ["normalized-search", "normalized-filter", "effective-sort", "temporal-viewing-context", "continuation-key"], snapshotConsistency: false },
    },
  };
}

function query({ calendar = false } = {}) {
  return {
    canonical: canonical({ calendar }),
    filters: [{ field: "status", parameter: "status", mode: "enum-set" }],
    comparisons: [],
    capabilityQueries: calendar ? [{ key: "calendar.window", capability: "calendar" }] : [],
  };
}

function inventory() {
  return {
    data: {
      semanticDetailPathTemplate: "/api/v1/spaces/{spaceId}/_discovery/models/{modelKey}",
      models: [
        { key: "event", version: 3, schemaHash: hashEvent, display: { singular: "Event", plural: "Events" }, capabilities: ["calendar"], actions: [] },
        { key: "task", version: 5, schemaHash: hashTask, display: { singular: "Task", plural: "Tasks" }, capabilities: [], actions: [] },
      ],
      spaces: [
        { spaceId: "spc_beta", spaceName: "Beta", models: [{ modelKey: "task", access: ["read"] }, { modelKey: "event", access: ["read", "write"] }] },
        { spaceId: "spc_alpha", spaceName: "Alpha", models: [{ modelKey: "event", access: ["read"] }] },
      ],
    },
  };
}

function detail(modelKey, options = {}) {
  const isEvent = modelKey === "event";
  return {
    data: {
      key: modelKey,
      version: isEvent ? 3 : 5,
      schemaHash: isEvent ? hashEvent : hashTask,
      display: { singular: isEvent ? "Event" : "Task", plural: isEvent ? "Events" : "Tasks" },
      query: query({ calendar: options.calendar ?? isEvent }),
    },
  };
}

function selection(modelKey = "task", options = {}) {
  return {
    models: [{
      detail: detail(modelKey, options).data,
      spaces: options.spaces ?? [{ spaceId: "spc_beta", spaceName: "Beta", access: ["read"] }],
    }],
  };
}

async function selectedEvent() {
  const requests = [];
  const data = await loadSelectedModelSemantics({
    selectedModelKeys: ["event"],
    fetchJson: async (path) => {
      requests.push(path);
      if (path === "/api/v1/me/_discovery/inventory") return inventory();
      if (path === "/api/v1/spaces/spc_alpha/_discovery/models/event") return detail("event");
      throw new Error(`unexpected request ${path}`);
    },
  });
  return { data, requests };
}

test("progressive discovery loads only selected model detail and preserves readable Spaces", async () => {
  const { data, requests } = await selectedEvent();
  assert.deepEqual(requests, [
    "/api/v1/me/_discovery/inventory",
    "/api/v1/spaces/spc_alpha/_discovery/models/event",
  ]);
  assert.deepEqual(data.models[0].spaces.map((space) => space.spaceId), ["spc_alpha", "spc_beta"]);
});

test("semantic detail identity drift fails closed", async () => {
  await assert.rejects(
    loadSelectedModelSemantics({
      selectedModelKeys: ["task"],
      fetchJson: async (path) => path.endsWith("inventory")
        ? inventory()
        : { ...detail("task"), data: { ...detail("task").data, schemaHash: "c".repeat(64) } },
    }),
    /identity drift/u,
  );
});

test("one model projects one Agent-friendly Canonical Query tool even when legacy capability metadata remains", async () => {
  const { data } = await selectedEvent();
  const { tools } = projectSelectedModelsToMcp(data);
  assert.deepEqual(tools.map((tool) => tool.name), ["lifespace.query.event"]);
  assert.equal(tools[0].inputSchema.properties.search.type, "string");
  assert.ok(tools[0].inputSchema.properties.filters);
  assert.ok(tools[0].inputSchema.properties.advancedFilter);
  assert.ok(tools[0].inputSchema.properties.sort);
  assert.ok(tools[0].inputSchema.properties.limit);
  assert.ok(tools[0].inputSchema.properties.cursor);
  assert.equal(tools[0].inputSchema.properties.filter, undefined);
  assert.equal(tools[0].inputSchema.properties.page, undefined);
  assert.equal(tools[0].inputSchema.properties.q, undefined);
});

test("flat filter schema is descriptor-backed and includes Calendar range without a model branch", () => {
  const { tools } = projectSelectedModelsToMcp(selection("event"));
  const branches = tools[0].inputSchema.properties.filters.items.oneOf;
  const whenOperators = branches
    .filter((branch) => branch.properties.field.enum[0] === "when")
    .map((branch) => branch.properties.operator.enum[0]);
  assert.deepEqual(whenOperators, ["overlaps", "contains", "before", "after", "kindIs"]);
  assert.deepEqual(
    tools[0].inputSchema.$defs.advancedFilterNode["x-lifespace-targets"].map((target) => target.field),
    ["createdAt", "dueDate", "status", "when"],
  );
});

test("tool ordering and Space enums are deterministic", () => {
  const selected = {
    models: [
      selection("task").models[0],
      selection("event", { spaces: [{ spaceId: "spc_beta", access: ["read"] }, { spaceId: "spc_alpha", access: ["read"] }] }).models[0],
    ],
  };
  const { tools } = projectSelectedModelsToMcp(selected);
  assert.deepEqual(tools.map((tool) => tool.name), ["lifespace.query.event", "lifespace.query.task"]);
  assert.deepEqual(tools[0].inputSchema.properties.spaceId.enum, ["spc_alpha", "spc_beta"]);
});

test("request builder lowers simple Agent inputs into Canonical Query", () => {
  const projected = projectSelectedModelsToMcp(selection());
  const binding = projected.bindings["lifespace.query.task"];
  const args = {
    spaceId: "spc_beta",
    search: "renew",
    filters: [
      { field: "status", operator: "eq", value: "open" },
      { field: "dueDate", operator: "within", value: { kind: "date", start: "2026-09-01", endExclusive: "2026-10-01" } },
    ],
    sort: [{ field: "dueDate", direction: "asc" }, { field: "createdAt", direction: "desc" }],
    limit: 25,
    cursor: "opaque-token",
  };
  assert.deepEqual(buildLifeSpaceQueryRequest(binding, args), {
    method: "POST",
    path: "/api/v1/spaces/spc_beta/models/task/records/query",
    body: {
      search: { text: "renew" },
      filter: {
        and: [
          { field: "status", op: "eq", value: "open" },
          { field: "dueDate", op: "within", value: { kind: "date", start: "2026-09-01", endExclusive: "2026-10-01" } },
        ],
      },
      sort: args.sort,
      page: { limit: 25, cursor: "opaque-token" },
    },
  });
});

test("advancedFilter remains available only for nested Boolean logic", () => {
  const projected = projectSelectedModelsToMcp(selection());
  const binding = projected.bindings["lifespace.query.task"];
  const advancedFilter = {
    or: [
      { field: "status", op: "eq", value: "open" },
      { field: "dueDate", op: "isNull" },
    ],
  };
  const request = buildLifeSpaceQueryRequest(binding, { spaceId: "spc_beta", advancedFilter });
  assert.deepEqual(request.body.filter, advancedFilter);
  assert.throws(
    () => buildLifeSpaceQueryRequest(binding, {
      spaceId: "spc_beta",
      filters: [{ field: "status", operator: "eq", value: "open" }],
      advancedFilter,
    }),
    /cannot be combined/u,
  );
});

test("local date windows are forwarded unchanged for Core DST conversion", () => {
  const projected = projectSelectedModelsToMcp(selection());
  const binding = projected.bindings["lifespace.query.task"];
  const value = { kind: "local_date_window", startDate: "2026-09-10", endDateExclusive: "2026-09-11", timezone: "Asia/Shanghai" };
  const request = buildLifeSpaceQueryRequest(binding, {
    spaceId: "spc_beta",
    filters: [{ field: "createdAt", operator: "within", value }],
  });
  assert.deepEqual(request.body.filter.value, value);
});

test("request builder rejects unprojected Space, field, operator and top-level argument", () => {
  const projected = projectSelectedModelsToMcp(selection());
  const binding = projected.bindings["lifespace.query.task"];
  assert.throws(() => buildLifeSpaceQueryRequest(binding, { spaceId: "spc_other" }), /not in the projected readable Space set/u);
  assert.throws(() => buildLifeSpaceQueryRequest(binding, { spaceId: "spc_beta", q: "legacy" }), /unsupported property/u);
  assert.throws(() => buildLifeSpaceQueryRequest(binding, { spaceId: "spc_beta", filters: [{ field: "unknown", operator: "eq", value: "x" }] }), /was not projected/u);
  assert.throws(() => buildLifeSpaceQueryRequest(binding, { spaceId: "spc_beta", filters: [{ field: "status", operator: "gte", value: "x" }] }), /was not projected for filter field/u);
});

test("request builder enforces null predicate and pagination bounds", () => {
  const projected = projectSelectedModelsToMcp(selection());
  const binding = projected.bindings["lifespace.query.task"];
  assert.throws(
    () => buildLifeSpaceQueryRequest(binding, { spaceId: "spc_beta", filters: [{ field: "dueDate", operator: "isNull", value: null }] }),
    /unsupported property/u,
  );
  assert.throws(() => buildLifeSpaceQueryRequest(binding, { spaceId: "spc_beta", limit: 201 }), /must be an integer/u);
});