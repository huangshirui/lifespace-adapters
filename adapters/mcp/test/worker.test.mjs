import assert from "node:assert/strict";
import test from "node:test";
import { handleMcpRequest } from "../src/worker.mjs";

const ASSERTION = "synthetic-access-assertion-not-a-real-jwt";
const TOKEN = "synthetic-lifespace-token";
const SCHEMA_HASH = "a".repeat(64);
const env = Object.freeze({
  IDENTITY_BASE_URL: "https://identity.example.com",
  CORE_BASE_URL: "https://core.example.com",
  LIFESPACE_APPLICATION_CREDENTIAL: "lsa_synthetic-test-only",
  MCP_MODEL_KEYS: "task",
});

function inventory() {
  return { data: {
    semanticDetailPathTemplate: "/api/v1/spaces/{spaceId}/_discovery/models/{modelKey}",
    models: [{ key: "task", version: 1, schemaHash: SCHEMA_HASH }],
    spaces: [{ spaceId: "spc_example", spaceName: "Example", models: [{ modelKey: "task", access: ["read"] }] }],
  } };
}

function detail() {
  return { data: {
    key: "task", version: 1, schemaHash: SCHEMA_HASH,
    display: { singular: "Task", plural: "Tasks" },
    query: { canonical: {
      invocation: { method: "POST", pathTemplate: "/api/v1/spaces/{spaceId}/models/{modelKey}/records/query" },
      composition: { selectionFacets: ["search", "filter"], selectionCombine: "intersection", ordering: "sort", pagination: "cursor-pagination" },
      search: { fields: ["title"], minLength: 1, maxLength: 100 },
      filter: { maxDepth: 3, maxNodes: 8, targets: [{ field: "status", kind: "field", valueType: "enum", operators: ["eq"], nullable: false }] },
      sort: { fields: ["createdAt"], directions: ["asc", "desc"], maxCriteria: 1, default: [{ field: "createdAt", direction: "desc" }], nullPlacement: "last", stableTieBreaker: "record-id-asc" },
      pagination: { limit: { minimum: 1, maximum: 50, default: 20 }, cursor: { opaque: true } },
    } },
  } };
}

function makeClient({ identityStatus = 200, scope = "resources:read", queryStatus = 200, data = [{ title: "synthetic" }] } = {}) {
  const requests = [];
  const fetcher = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ host: url.host, path: url.pathname, method: init.method, headers: init.headers, body: init.body });
    if (url.host === "identity.example.com") {
      return Response.json(identityStatus === 200
        ? { data: { accessToken: TOKEN, tokenType: "Bearer", scope, expiresIn: 600 } }
        : { error: "synthetic identity denial" }, { status: identityStatus });
    }
    if (url.pathname === "/api/v1/me/_discovery/inventory") return Response.json(inventory());
    if (url.pathname === "/api/v1/spaces/spc_example/_discovery/models/task") return Response.json(detail());
    if (url.pathname === "/api/v1/spaces/spc_example/models/task/records/query") {
      return Response.json(queryStatus === 200 ? { data } : { error: "denied" }, { status: queryStatus });
    }
    throw new Error("Unexpected synthetic request");
  };
  return { fetcher, requests };
}

function rpc(method, params, opts = {}) {
  return new Request("https://mcp.example.com/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json, text/event-stream",
      "cf-access-jwt-assertion": ASSERTION,
      ...opts.headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: opts.id ?? 1, method, ...(params === undefined ? {} : { params }) }),
  });
}

test("untrusted and missing Access assertion fails closed before Identity/Core", async () => {
  const client = makeClient();
  const request = rpc("tools/list", {});
  request.headers.delete("cf-access-jwt-assertion");
  const response = await handleMcpRequest(request, env, client.fetcher);
  assert.equal(response.status, 401);
  assert.equal(client.requests.length, 0);
});

test("Identity denies unlinked or invalid principals and no Core data is fetched", async () => {
  for (const status of [401, 403, 409]) {
    const client = makeClient({ identityStatus: status });
    const result = await handleMcpRequest(rpc("tools/list", {}), env, client.fetcher);
    assert.equal(result.status, 403);
    assert.equal(client.requests.length, 1);
    assert.equal(client.requests[0].path, "/internal/v1/access/tokens");
  }
});

test("Identity issues read-only credential from original assertion, and tools/list consumes current Core projection", async () => {
  const client = makeClient();
  const result = await handleMcpRequest(rpc("tools/list", {}), env, client.fetcher);
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.deepEqual(body.result.tools.map(x => x.name), ["lifespace.query.task"]);
  assert.deepEqual(body.result.tools[0].inputSchema.properties.spaceId.enum, ["spc_example"]);
  const exchanged = JSON.parse(client.requests[0].body);
  assert.deepEqual(exchanged, { accessAssertion: ASSERTION, requestedScopes: ["resources:read"] });
  assert.equal(client.requests[0].headers.authorization, "Bearer " + env.LIFESPACE_APPLICATION_CREDENTIAL);
  for (const operation of client.requests.slice(1)) {
    assert.equal(operation.headers.authorization, "Bearer " + TOKEN);
    assert.equal(JSON.stringify(operation).includes(ASSERTION), false);
  }
});

test("tools/call compiles canonical query and returns only Core-authorized results", async () => {
  const client = makeClient();
  const response = await handleMcpRequest(rpc("tools/call", {
    name: "lifespace.query.task",
    arguments: { spaceId: "spc_example", search: "synthetic", limit: 5 },
  }), env, client.fetcher);
  const body = await response.json();
  assert.equal(body.result.content[0].type, "text");
  assert.deepEqual(JSON.parse(body.result.content[0].text), [{ title: "synthetic" }]);
  const operation = client.requests.at(-1);
  assert.equal(operation.path, "/api/v1/spaces/spc_example/models/task/records/query");
  assert.deepEqual(JSON.parse(operation.body), { search: { text: "synthetic" }, page: { limit: 5 } });
});

test("Core current-state revocation rejects stale MCP tool calls even when discovery says readable", async () => {
  const client = makeClient({ queryStatus: 403 });
  const response = await handleMcpRequest(rpc("tools/call", {
    name: "lifespace.query.task",
    arguments: { spaceId: "spc_example" },
  }), env, client.fetcher);
  const body = await response.json();
  assert.equal(body.result.isError, true);
  assert.equal(body.result.content[0].text, "LIFESPACE_DENIED");
});

test("unprojected tool, Space and invalid arguments fail closed without query execution", async () => {
  for (const params of [
    { name: "lifespace.query.health", arguments: { spaceId: "spc_example" } },
    { name: "lifespace.query.task", arguments: { spaceId: "spc_other" } },
    { name: "lifespace.query.task", arguments: { spaceId: "spc_example", unknown: true } },
  ]) {
    const client = makeClient();
    const response = await handleMcpRequest(rpc("tools/call", params), env, client.fetcher);
    assert.equal((await response.json()).error.code, -32602);
    assert.equal(client.requests.some(x => x.path.endsWith("/records/query")), false);
  }
});

test("missing read scope, invalid Origin, invalid config and non-MCP methods deny", async () => {
  const wrongScope = makeClient({ scope: "resources:write" });
  assert.equal((await handleMcpRequest(rpc("tools/list", {}), env, wrongScope.fetcher)).status, 502);
  assert.equal(wrongScope.requests.length, 1);

  const wrongOrigin = makeClient();
  const request = rpc("tools/list", {}, { headers: { origin: "https://evil.example.com" } });
  assert.equal((await handleMcpRequest(request, env, wrongOrigin.fetcher)).status, 403);
  assert.equal(wrongOrigin.requests.length, 0);

  const badConfig = makeClient();
  const response = await handleMcpRequest(rpc("tools/list", {}), { ...env, MCP_MODEL_KEYS: "" }, badConfig.fetcher);
  assert.equal((await response.json()).error.code, -32603);

  const arbitrary = makeClient();
  const missingMethod = await handleMcpRequest(rpc("resources/list", {}), env, arbitrary.fetcher);
  assert.equal((await missingMethod.json()).error.code, -32601);
});

test("stateless initialization works and unsupported GET cannot expose data", async () => {
  const client = makeClient();
  const init = await handleMcpRequest(rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {}, clientInfo: { name: "synthetic-client", version: "1" },
  }), env, client.fetcher);
  assert.equal((await init.json()).result.protocolVersion, "2025-06-18");
  const get = await handleMcpRequest(new Request("https://mcp.example.com/mcp"), env, client.fetcher);
  assert.equal(get.status, 405);
});

test("identity transport fails safely and never uses service principal credentials as user authority", async () => {
  const client = makeClient();
  const response = await handleMcpRequest(rpc("tools/list", {}), {
    ...env, LIFESPACE_APPLICATION_CREDENTIAL: "synthetic-not-an-app-credential",
  }, client.fetcher);
  assert.equal(response.status, 503);
  assert.equal(client.requests.length, 0);
});
