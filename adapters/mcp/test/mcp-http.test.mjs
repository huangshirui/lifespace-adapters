import assert from "node:assert/strict";
import test from "node:test";
import { createAuthenticatedMcpHttpHandler } from "../src/mcp-http.mjs";

const eventHash = "b".repeat(64);
const inventory = {
  data: {
    semanticDetailPathTemplate: "/api/v1/spaces/{spaceId}/_discovery/models/{modelKey}",
    models: [
      { key: "event", version: 1, schemaHash: eventHash, display: { singular: "Event", plural: "Events" }, capabilities: ["calendar"], actions: [] },
      { key: "task", version: 1, schemaHash: "a".repeat(64), display: { singular: "Task", plural: "Tasks" }, capabilities: [], actions: [] },
    ],
    spaces: [
      { spaceId: "spc_visible", spaceName: "Visible", models: [
        { modelKey: "event", access: ["read"] },
        { modelKey: "task", access: ["read"] },
      ] },
      { spaceId: "spc_hidden", spaceName: "Hidden", models: [
        { modelKey: "event", access: ["write"] },
      ] },
    ],
  },
};
const detail = {
  data: {
    key: "event",
    version: 1,
    schemaHash: eventHash,
    display: { singular: "Event", plural: "Events" },
    query: {
      canonical: {
        invocation: { method: "POST", pathTemplate: "/api/v1/spaces/{spaceId}/models/{modelKey}/records/query" },
        composition: {
          selectionFacets: ["search", "filter"],
          selectionCombine: "intersection",
          ordering: "sort",
          pagination: "cursor-pagination",
        },
        search: null,
        filter: {
          maxDepth: 8,
          maxNodes: 100,
          targets: [
            { field: "when", kind: "calendar-range", valueType: "temporal-range", operators: ["overlaps"], nullable: false },
          ],
        },
        sort: {
          fields: ["createdAt"], directions: ["asc", "desc"], maxCriteria: 8,
          default: [{ field: "createdAt", direction: "desc" }],
          nullPlacement: "last",
          stableTieBreaker: "record-id-asc",
        },
        pagination: {
          limit: { minimum: 1, maximum: 100, default: 25 },
          cursor: { opaque: true, binds: ["normalized-filter"], snapshotConsistency: false },
        },
      },
    },
  },
};

function request(path, method, params = {}, extraHeaders = {}) {
  return new Request("https://mcp.example.com" + path, {
    method: "POST",
    headers: {
      "Authorization": "Bearer synthetic",
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
      ...extraHeaders,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function readProtocol(response) {
  const body = await response.text();
  if (body.startsWith("data:") || response.headers.get("Content-Type")?.includes("text/event-stream")) {
    const events = body.split("\n").filter((line) => line.startsWith("data:")).map((line) => JSON.parse(line.slice(5).trim()));
    return events.at(-1);
  }
  return JSON.parse(body);
}

function trustedContext({ onExecute, inventoryValue = inventory } = {}) {
  return {
    fetchJson: async (path) => {
      if (path === "/api/v1/me/_discovery/inventory") return inventoryValue;
      if (path === "/api/v1/spaces/spc_visible/_discovery/models/event") return detail;
      throw Error("Unexpected semantic lookup: " + path);
    },
    executeQuery: async (op) => {
      onExecute?.(op);
      return { data: { records: [{ id: "rec_synthetic" }] } };
    },
  };
}

test("refuses to construct an MCP handler without a verified authorizer", () => {
  assert.throws(() => createAuthenticatedMcpHttpHandler(), /authorizeRequest/u);
});

test("unknown endpoint and cross-origin request fail closed", async () => {
  const handle = createAuthenticatedMcpHttpHandler({ authorizeRequest: async () => trustedContext() });
  assert.equal((await handle(request("/mcp/health", "tools/list"))).status, 404);
  assert.equal((await handle(request("/mcp/calendar", "tools/list", {}, { Origin: "https://evil.example" }))).status, 403);
});

test("unauthenticated requests cannot reach Core inventory or any tool", async () => {
  let accessed = false;
  const handle = createAuthenticatedMcpHttpHandler({
    authorizeRequest: async () => { accessed = true; return null; },
  });
  const answer = await handle(request("/mcp/calendar", "tools/list"));
  assert.equal(answer.status, 401);
  assert.match(answer.headers.get("www-authenticate"), /Bearer/u);
  assert.equal(accessed, true);
});

test("authorized stateless tools/list projects only Calendar query within readable Spaces", async () => {
  const handle = createAuthenticatedMcpHttpHandler({
    authorizeRequest: async () => trustedContext(),
  });
  const res = await handle(request("/mcp/calendar", "tools/list"));
  assert.equal(res.status, 200);
  const packet = await readProtocol(res);
  assert.deepEqual(packet.result.tools.map((tool) => tool.name), ["lifespace.query.event"]);
  assert.deepEqual(packet.result.tools[0].inputSchema.properties.spaceId.enum, ["spc_visible"]);
  assert.equal(packet.result.tools[0].annotations.readOnlyHint, true);
});

test("authorized tools/call delegates a read-only Canonical Query to Core", async () => {
  let executed;
  const handle = createAuthenticatedMcpHttpHandler({
    authorizeRequest: async () => trustedContext({ onExecute: (op) => { executed = op; } }),
  });
  const res = await handle(request("/mcp/calendar", "tools/call", {
    name: "lifespace.query.event",
    arguments: {
      spaceId: "spc_visible",
      filters: [{
        field: "when", operator: "overlaps",
        value: { kind: "local_date_window", startDate: "2026-10-29", endDateExclusive: "2026-10-30", timezone: "Asia/Shanghai" },
      }],
      limit: 10,
    },
  }));
  assert.equal(res.status, 200);
  const packet = await readProtocol(res);
  assert.equal(packet.result.isError, undefined);
  assert.match(packet.result.content[0].text, /rec_synthetic/u);
  assert.equal(executed.method, "POST");
  assert.equal(executed.path, "/api/v1/spaces/spc_visible/models/event/records/query");
  assert.equal(executed.body.filter.field, "when");
});

test("a stale client cannot call hidden Tasks through the Calendar endpoint", async () => {
  let executed = false;
  const handle = createAuthenticatedMcpHttpHandler({
    authorizeRequest: async () => trustedContext({ onExecute: () => { executed = true; } }),
  });
  const res = await handle(request("/mcp/calendar", "tools/call", { name: "lifespace.query.task", arguments: { spaceId: "spc_visible" } }));
  assert.equal(res.status, 200);
  const packet = await readProtocol(res);
  assert.ok(packet.error || packet.result?.isError);
  assert.equal(executed, false);
});

test("general MCP exposes only task discovery and generic query, without model schemas", async () => {
  const handle = createAuthenticatedMcpHttpHandler({ authorizeRequest: async () => trustedContext() });
  const res = await handle(request("/mcp", "tools/list"));
  assert.equal(res.status, 200);
  const packet = await readProtocol(res);
  assert.deepEqual(packet.result.tools.map((tool) => tool.name), [
    "lifespace.find_capabilities", "lifespace.query_records",
  ]);
});

test("general MCP resolves Chinese task intent without loading unrelated tool schemas", async () => {
  const handle = createAuthenticatedMcpHttpHandler({ authorizeRequest: async () => trustedContext() });
  const res = await handle(request("/mcp", "tools/call", {
    name: "lifespace.find_capabilities", arguments: { intent: "今天有哪些日程？" },
  }));
  assert.equal(res.status, 200);
  const packet = await readProtocol(res);
  const capabilities = JSON.parse(packet.result.content[0].text).capabilities;
  assert.deepEqual(capabilities.map((c) => c.modelKey), ["event"]);
  assert.deepEqual(capabilities[0].spaces.map((s) => s.spaceId), ["spc_visible"]);
});

test("general MCP queries only a current readable Space with canonical typed filters", async () => {
  let executed;
  const handle = createAuthenticatedMcpHttpHandler({
    authorizeRequest: async () => trustedContext({ onExecute: (op) => { executed = op; } }),
  });
  const res = await handle(request("/mcp", "tools/call", {
    name: "lifespace.query_records",
    arguments: {
      modelKey: "event", spaceId: "spc_visible",
      filters: [{ field: "when", operator: "overlaps", value: {
        kind: "local_date_window", startDate: "2026-10-29", endDateExclusive: "2026-10-30", timezone: "Asia/Shanghai",
      } }],
    },
  }));
  const packet = await readProtocol(res);
  assert.equal(packet.result?.isError, undefined);
  assert.match(packet.result.content[0].text, /rec_synthetic/u);
  assert.equal(executed.path, "/api/v1/spaces/spc_visible/models/event/records/query");
});

test("generic model access is denied after Core inventory removes read access", async () => {
  const revoked = structuredClone(inventory);
  revoked.data.spaces[0].models[0].access = [];
  let executed = false;
  const handle = createAuthenticatedMcpHttpHandler({
    authorizeRequest: async () => trustedContext({ inventoryValue: revoked, onExecute: () => { executed = true; } }),
  });
  const res = await handle(request("/mcp", "tools/call", {
    name: "lifespace.query_records", arguments: { modelKey: "event", spaceId: "spc_visible" },
  }));
  const packet = await readProtocol(res);
  assert.equal(packet.result.isError, true);
  assert.equal(executed, false);
});
