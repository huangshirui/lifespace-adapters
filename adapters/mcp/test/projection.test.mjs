import assert from "node:assert/strict";
import test from "node:test";
import { buildLifeSpaceQueryRequest, projectSelectedModelsToMcp } from "../src/projection.mjs";
import { loadSelectedModelSemantics } from "../src/progressive-discovery.mjs";

const hashTask = "a".repeat(64);
const hashEvent = "b".repeat(64);

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

function baseQuery() {
  return {
    searchable: ["summary"],
    filterable: ["status", "dueDate"],
    sortable: ["dueDate"],
    search: { parameter: "q", minLength: 1, maxLength: 100 },
    filters: [
      { field: "status", parameter: "status", mode: "enum-set" },
      { field: "dueDate", parameter: "dueDate", mode: "exact", range: { fromParameter: "dueDateFrom", toParameter: "dueDateTo" } },
    ],
    comparisons: [
      {
        field: "dueDate", source: "model", valueType: "date",
        operators: [
          { operator: "eq", parameter: "dueDate", transport: "legacy" },
          { operator: "gte", parameter: "dueDateFrom", transport: "legacy" },
          { operator: "lte", parameter: "dueDateTo", transport: "legacy" },
          { operator: "eq", parameter: "dueDate.eq", transport: "explicit" },
          { operator: "lt", parameter: "dueDate.lt", transport: "explicit" },
          { operator: "lte", parameter: "dueDate.lte", transport: "explicit" },
          { operator: "gt", parameter: "dueDate.gt", transport: "explicit" },
          { operator: "gte", parameter: "dueDate.gte", transport: "explicit" },
        ],
      },
      {
        field: "createdAt", source: "envelope", valueType: "datetime",
        operators: [
          { operator: "eq", parameter: "createdAt.eq", transport: "explicit" },
          { operator: "lt", parameter: "createdAt.lt", transport: "explicit" },
          { operator: "lte", parameter: "createdAt.lte", transport: "explicit" },
          { operator: "gt", parameter: "createdAt.gt", transport: "explicit" },
          { operator: "gte", parameter: "createdAt.gte", transport: "explicit" },
        ],
        localDateWindow: {
          dateStartParameter: "createdAt.dateStart",
          dateEndExclusiveParameter: "createdAt.dateEndExclusive",
          timezoneParameter: "createdAt.timezone",
          bounds: "[)", lowerOperator: "gte", upperOperator: "lt",
        },
      },
      {
        field: "updatedAt", source: "envelope", valueType: "datetime",
        operators: [
          { operator: "eq", parameter: "updatedAt.eq", transport: "explicit" },
          { operator: "lt", parameter: "updatedAt.lt", transport: "explicit" },
          { operator: "lte", parameter: "updatedAt.lte", transport: "explicit" },
          { operator: "gt", parameter: "updatedAt.gt", transport: "explicit" },
          { operator: "gte", parameter: "updatedAt.gte", transport: "explicit" },
        ],
      },
    ],
    sort: {
      parameter: "sort", syntax: "field:direction", repeatable: true, ordered: true, maxCriteria: 8,
      genericDefault: ["createdAt:desc"], envelopeFields: ["createdAt", "updatedAt"], nullPlacement: "last",
      genericValues: ["createdAt:asc", "createdAt:desc", "updatedAt:asc", "updatedAt:desc", "dueDate:asc", "dueDate:desc"],
      semantic: { standalone: true, values: [], defaults: {} },
    },
    pagination: {
      limit: { parameter: "limit", minimum: 1, maximum: 200, default: 100 },
      cursor: { parameter: "cursor", type: "string" },
    },
    capabilityParameters: [],
    capabilityQueries: [],
  };
}

function taskDetail() {
  return {
    data: {
      key: "task", version: 5, schemaHash: hashTask,
      display: { singular: "Task", plural: "Tasks" }, description: null,
      declaredAccess: ["read", "write"],
      fields: [
        { key: "summary", type: "string", required: true },
        { key: "status", type: "enum", values: ["open", "done"] },
        { key: "dueDate", type: "date", nullable: true },
      ],
      timeRanges: [], defaults: {}, query: baseQuery(), actions: [], capabilities: [], capabilityBindings: {},
    },
  };
}

function eventDetail() {
  const query = baseQuery();
  query.capabilityQueries = [{
    key: "calendar.window", capability: "calendar", semantics: "record-interval-overlap", recurrenceExpansion: false,
    parameters: [
      { parameter: "windowStartDate", type: "date", required: true, role: "window-start-date" },
      { parameter: "windowEndDateExclusive", type: "date", required: true, role: "window-end-date-exclusive" },
      { parameter: "viewingTimezone", type: "timezone", required: true, role: "viewing-timezone" },
    ],
    ordering: {
      parameter: "sort", values: ["calendarStart:asc", "calendarStart:desc"], default: "calendarStart:asc",
      dateBasis: "viewing-timezone", allDayPlacement: "before-timed-within-date", timedOrder: "instant", tieBreaker: "record-id-asc",
    },
  }];
  query.sort.semantic = { standalone: true, values: ["calendarStart:asc", "calendarStart:desc"], defaults: { calendar: "calendarStart:asc" } };
  return {
    data: {
      key: "event", version: 3, schemaHash: hashEvent,
      display: { singular: "Event", plural: "Events" }, description: null,
      declaredAccess: ["read", "write"],
      fields: [
        { key: "summary", type: "string", required: true },
        { key: "status", type: "enum", values: ["active", "cancelled"] },
        { key: "dueDate", type: "date", nullable: true },
      ],
      timeRanges: [], defaults: {}, query, actions: [], capabilities: ["calendar"], capabilityBindings: { calendar: {} },
    },
  };
}

async function selectedEvent() {
  const requests = [];
  const data = await loadSelectedModelSemantics({
    selectedModelKeys: ["event"],
    fetchJson: async (path) => {
      requests.push(path);
      if (path === "/api/v1/me/_discovery/inventory") return inventory();
      if (path === "/api/v1/spaces/spc_alpha/_discovery/models/event") return eventDetail();
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
        : { ...taskDetail(), data: { ...taskDetail().data, schemaHash: "c".repeat(64) } },
    }),
    /identity drift/u,
  );
});

test("generic query tool exposes explicit comparisons, envelope time and exact non-comparable filters", () => {
  const selection = {
    models: [{
      detail: taskDetail().data,
      spaces: [{ spaceId: "spc_beta", spaceName: "Beta", access: ["read"] }],
    }],
  };
  const projected = projectSelectedModelsToMcp(selection);
  assert.equal(projected.tools.length, 1);
  const schema = projected.tools[0].inputSchema;
  assert.ok(schema.properties["dueDate.gte"]);
  assert.ok(schema.properties["dueDate.lt"]);
  assert.ok(schema.properties["createdAt.gte"]);
  assert.ok(schema.properties["updatedAt.lt"]);
  assert.ok(schema.properties.status);
  assert.ok(schema.properties.q);
  assert.equal(schema.properties.dueDateFrom, undefined);
  assert.equal(schema.properties.dueDateTo, undefined);
});

test("datetime local-date window uses exact published names with all-or-none JSON Schema dependency", () => {
  const selection = {
    models: [{ detail: taskDetail().data, spaces: [{ spaceId: "spc_beta", access: ["read"] }] }],
  };
  const { tools } = projectSelectedModelsToMcp(selection);
  const schema = tools[0].inputSchema;
  assert.deepEqual(schema.dependentRequired["createdAt.dateStart"].sort(), ["createdAt.dateEndExclusive", "createdAt.timezone"].sort());
  assert.deepEqual(schema.dependentRequired["createdAt.timezone"].sort(), ["createdAt.dateEndExclusive", "createdAt.dateStart"].sort());
});

test("calendar.window becomes a separate capability query tool without guessed generic composition", async () => {
  const { data } = await selectedEvent();
  const { tools } = projectSelectedModelsToMcp(data);
  assert.deepEqual(tools.map((tool) => tool.name), ["lifespace.query.event", "lifespace.query.event.calendar.window"]);
  const calendar = tools[1];
  assert.deepEqual(calendar.inputSchema.required.sort(), ["spaceId", "viewingTimezone", "windowEndDateExclusive", "windowStartDate"].sort());
  assert.deepEqual(calendar.inputSchema.properties.sort.enum, ["calendarStart:asc", "calendarStart:desc"]);
  assert.equal(calendar.inputSchema.properties.q, undefined);
  assert.equal(calendar.inputSchema.properties.status, undefined);
});

test("tool ordering and Space enums are deterministic", async () => {
  const { data } = await selectedEvent();
  const { tools } = projectSelectedModelsToMcp(data);
  for (const tool of tools) {
    assert.deepEqual(tool.inputSchema.properties.spaceId.enum, ["spc_alpha", "spc_beta"]);
  }
  assert.deepEqual(tools.map((tool) => tool.name), [...tools.map((tool) => tool.name)].sort());
});

test("request builder preserves exact parameter names and repeated sort order", () => {
  const selection = { models: [{ detail: taskDetail().data, spaces: [{ spaceId: "spc_beta", access: ["read"] }] }] };
  const projected = projectSelectedModelsToMcp(selection);
  const binding = projected.bindings["lifespace.query.task"];
  const request = buildLifeSpaceQueryRequest(binding, {
    spaceId: "spc_beta",
    "createdAt.gte": "2026-09-01T00:00:00Z",
    "dueDate.lt": "2026-10-01",
    sort: ["dueDate:asc", "createdAt:desc"],
    limit: 25,
  });
  assert.equal(request.method, "GET");
  assert.equal(request.path, "/api/v1/spaces/spc_beta/models/task/records");
  const params = new URLSearchParams(request.query);
  assert.equal(params.get("createdAt.gte"), "2026-09-01T00:00:00Z");
  assert.equal(params.get("dueDate.lt"), "2026-10-01");
  assert.deepEqual(params.getAll("sort"), ["dueDate:asc", "createdAt:desc"]);
  assert.equal(params.get("limit"), "25");
});

test("request builder rejects unprojected Space and arguments", () => {
  const selection = { models: [{ detail: taskDetail().data, spaces: [{ spaceId: "spc_beta", access: ["read"] }] }] };
  const projected = projectSelectedModelsToMcp(selection);
  const binding = projected.bindings["lifespace.query.task"];
  assert.throws(() => buildLifeSpaceQueryRequest(binding, { spaceId: "spc_other" }), /not in the projected readable Space set/u);
  assert.throws(() => buildLifeSpaceQueryRequest(binding, { spaceId: "spc_beta", dueDateFrom: "2026-09-01" }), /was not projected/u);
});

test("request builder enforces local-date-window group without calculating UTC", () => {
  const selection = { models: [{ detail: taskDetail().data, spaces: [{ spaceId: "spc_beta", access: ["read"] }] }] };
  const projected = projectSelectedModelsToMcp(selection);
  const binding = projected.bindings["lifespace.query.task"];
  assert.throws(() => buildLifeSpaceQueryRequest(binding, {
    spaceId: "spc_beta",
    "createdAt.dateStart": "2026-09-10",
  }), /must be supplied together/u);
  const request = buildLifeSpaceQueryRequest(binding, {
    spaceId: "spc_beta",
    "createdAt.dateStart": "2026-09-10",
    "createdAt.dateEndExclusive": "2026-09-11",
    "createdAt.timezone": "Asia/Shanghai",
  });
  const params = new URLSearchParams(request.query);
  assert.equal(params.get("createdAt.dateStart"), "2026-09-10");
  assert.equal(params.get("createdAt.timezone"), "Asia/Shanghai");
  assert.equal([...params.keys()].some((key) => key.toLowerCase().includes("utc")), false);
});

test("unknown capability query metadata fails closed", () => {
  const detail = eventDetail().data;
  detail.query.capabilityQueries[0].parameters[0].type = "mystery";
  assert.throws(() => projectSelectedModelsToMcp({ models: [{ detail, spaces: [{ spaceId: "spc_alpha", access: ["read"] }] }] }), /unsupported capability query parameter type/u);
});
