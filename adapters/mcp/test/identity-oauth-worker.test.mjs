import { test } from "node:test";
import assert from "node:assert/strict";
import {
  handleIdentityOAuthMcp, oauthResourceConfig, validateIntrospection,
} from "../src/identity-oauth-worker.mjs";

const SERVER_ID = "mcp_" + "a".repeat(32);
const RESOURCE = "https://resource.example.com/mcp/" + SERVER_ID;
const ISSUER = "https://identity.example.com";
const TOKEN = "lsp_oat_" + "A".repeat(43);
const SECRET = "synthetic-resource-secret-" + "S".repeat(40);
const base = {
  MCP_RESOURCE_URI: RESOURCE, MCP_OAUTH_ISSUER: ISSUER,
  OAUTH_RESOURCE_SERVER_SECRET: SECRET,
};
const active = {
  active: true, client_id: "ocli_synthetic",
  authorization_id: "oaz_synthetic", sub: "usr_synthetic",
  application_id: "app_synthetic", space_id: "spc_synthetic",
  agent_id: "agt_synthetic", scope: "resources:read",
  resource: RESOURCE, exp: Math.floor(Date.now() / 1000) + 180,
  allow_user_authorization: false,
};
function fixture(introspection = active) {
  const calls = [];
  const env = { ...base, IDENTITY: { fetch: async (url, init) => {
    calls.push({ url, init });
    return Response.json(introspection);
  } } };
  return { env, calls };
}
function rpc(method, opts = {}) {
  return new Request(RESOURCE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer " + TOKEN,
      ...opts.headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: opts.params || {} }),
  });
}

test("RFC 9728 metadata lists Identity as the AS, not Cloudflare Managed OAuth", async () => {
  const f = fixture();
  for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp/" + SERVER_ID]) {
    const result = await handleIdentityOAuthMcp(new Request("https://resource.example.com" + path), f.env);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), {
      resource: RESOURCE, authorization_servers: [ISSUER],
      scopes_supported: ["resources:read"], bearer_methods_supported: ["header"],
    });
  }
  assert.equal(f.calls.length, 0);
  assert.deepEqual(oauthResourceConfig(base), {
    issuer: ISSUER, resource: RESOURCE, origin: "https://resource.example.com",
    path: "/mcp/" + SERVER_ID,
    metadata: "https://resource.example.com/.well-known/oauth-protected-resource/mcp/" + SERVER_ID,
  });
});

test("MCP 401 advertises protected-resource metadata before making any Identity/Core call", async () => {
  const f = fixture();
  for (const authorization of [undefined, "", "Bearer forged",
    "Bearer lsp_ort_" + "x".repeat(50), "Bearer " + "x".repeat(5000)]) {
    const req = rpc("initialize", { headers: { authorization: authorization || "" } });
    const result = await handleIdentityOAuthMcp(req, f.env);
    assert.equal(result.status, 401);
    assert.match(result.headers.get("www-authenticate") || "", /resource_metadata="https:\/\/resource\.example\.com\/\.well-known\/oauth-protected-resource\/mcp\/mcp_[a-f0-9]{32}"/u);
    assert.match(result.headers.get("www-authenticate") || "", /scope="resources:read"/u);
  }
  assert.equal(f.calls.length, 0);
});

test("opaque token is introspected privately for its exact resource; never forwarded to Core", async () => {
  const f = fixture();
  const result = await handleIdentityOAuthMcp(rpc("initialize"), f.env);
  assert.equal(result.status, 200);
  const content = await result.json();
  assert.equal(content.result.protocolVersion, "2025-11-25");
  assert.equal(f.calls.length, 1);
  assert.equal(new URL(f.calls[0].url).pathname, "/oauth/introspect");
  assert.equal(f.calls[0].init.headers["x-lifespace-resource-secret"], SECRET);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(f.calls[0].init.body)), {
    token: TOKEN, resource: RESOURCE,
  });
  assert.ok(!JSON.stringify(content).includes(TOKEN));
  assert.ok(!JSON.stringify(content).includes("usr_synthetic"));
  assert.ok(!JSON.stringify(content).includes("agt_synthetic"));
});

test("revoked, expired, wrong-resource, mismatched agent or client is rejected before protocol dispatch", async () => {
  for (const payload of [
    { ...active, active: false },
    { ...active, resource: "https://other.example.com/mcp" },
    { ...active, resource: "https://resource.example.com/mcp/mcp_" + "b".repeat(32) },
    { ...active, exp: Math.floor(Date.now() / 1000) - 2 },
    { ...active, agent_id: "" },
    { ...active, client_id: "" },
    { ...active, space_id: "" },
    { ...active, allow_user_authorization: "yes" },
    { ...active, scope: "resources:read resources:read" },
  ]) {
    const f = fixture(payload);
    const r = await handleIdentityOAuthMcp(rpc("initialize"), f.env);
    assert.equal(r.status, 401);
    assert.equal(f.calls.length, 1);
  }
});

test("a valid write-only token cannot list read tools or silently gain read scope", async () => {
  const f = fixture({ ...active, scope: "resources:write" });
  const r = await handleIdentityOAuthMcp(rpc("tools/list"), f.env);
  assert.equal(r.status, 403);
  assert.match(r.headers.get("www-authenticate") || "", /insufficient_scope/u);
});

test("correct authorization does not yet grant Core execution or User Delegation", async () => {
  const f = fixture({ ...active, allow_user_authorization: true });
  for (const name of ["tools/list", "tools/call"]) {
    const r = await handleIdentityOAuthMcp(rpc(name), f.env);
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { error: "CORE_EXECUTION_NOT_CONFIGURED" });
  }
  assert.equal(f.calls.length, 2);
  assert.deepEqual(validateIntrospection({ ...active, allow_user_authorization: true }, oauthResourceConfig(base)).context, {
    clientId: active.client_id, authorizationId: active.authorization_id,
    userId: active.sub, applicationId: active.application_id,
    spaceId: active.space_id, agentId: active.agent_id,
    scopes: ["resources:read"], mayRequestDelegation: true,
  });
});

test("malformed config or missing internal resource secret fails closed without token disclosure", async () => {
  for (const env of [
    { ...base, MCP_OAUTH_ISSUER: "http://identity.example.com" },
    { ...base, MCP_RESOURCE_URI: RESOURCE + "?scope=all" },
    { ...base, MCP_RESOURCE_URI: "https://resource.example.com/mcp" },
    { ...base, MCP_RESOURCE_URI: "https://resource.example.com/mcp/" + SERVER_ID + "/other" },
    { ...base, MCP_RESOURCE_URI: "https://resource.example.com/other" },
    { ...base, MCP_OAUTH_ISSUER: "https://identity.example.com/custom" },
    { ...base, MCP_RESOURCE_URI: "https://*.example.com/mcp/" + SERVER_ID },
  ]) {
    const r = await handleIdentityOAuthMcp(rpc("initialize"), env);
    assert.equal(r.status, 503);
  }
  const r = await handleIdentityOAuthMcp(rpc("initialize"), {
    ...base, IDENTITY: fixture().env.IDENTITY,
    OAUTH_RESOURCE_SERVER_SECRET: "",
  });
  assert.equal(r.status, 503);
});

test("a different configured mcp_* Server ID on the same host cannot reuse OAuth bearer", async () => {
  const wrongServer = "mcp_" + "b".repeat(32);
  const f = fixture();
  const wrongPath = "https://resource.example.com/mcp/" + wrongServer;
  const r = await handleIdentityOAuthMcp(new Request(wrongPath, {
    method: "POST", headers: {
      authorization: "Bearer " + TOKEN,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
  }), f.env);
  assert.equal(r.status, 404);
  assert.equal(f.calls.length, 0);
});

test("host-origin mismatch, CORS origin, query/path confusion and wrong transport are denied", async () => {
  const f = fixture();
  assert.equal((await handleIdentityOAuthMcp(new Request("https://evil.example.com/mcp", { method: "POST" }), f.env)).status, 403);
  assert.equal((await handleIdentityOAuthMcp(rpc("ping", { headers: { origin: "https://evil.example.com" } }), f.env)).status, 403);
  assert.equal((await handleIdentityOAuthMcp(new Request(RESOURCE + "?foo=bar", { method: "POST" }), f.env)).status, 404);
  assert.equal((await handleIdentityOAuthMcp(new Request(RESOURCE), f.env)).status, 405);
  assert.equal(f.calls.length, 0);
});


function connectedFixture({ denied = false, wrongSpace = false, invalidExchange = false } = {}) {
  const calls = [];
  const signToken = ["eyJ" + "syntheticheader", "syntheticpayload", "syntheticsignature"].join(".");
  const schema = "a".repeat(64);
  const inventory = { data: {
    semanticDetailPathTemplate: "/api/v1/spaces/{spaceId}/_discovery/models/{modelKey}",
    models: [{ key: "task", version: 3, schemaHash: schema }],
    spaces: [{
      spaceId: wrongSpace ? "spc_other" : "spc_synthetic",
      spaceName: "Synthetic", models: [{ modelKey: "task", access: ["read"] }],
    }],
  } };
  const detail = { data: {
    key: "task", version: 3, schemaHash: schema, display: { singular: "Task", plural: "Tasks" },
    query: { canonical: {
      invocation: { method: "POST", pathTemplate: "/api/v1/spaces/{spaceId}/models/{modelKey}/records/query" },
      composition: {
        selectionFacets: ["search", "filter"], selectionCombine: "intersection",
        ordering: "sort", pagination: "cursor-pagination",
      },
      search: { fields: ["title"], minLength: 1, maxLength: 100 },
      filter: {
        maxDepth: 3, maxNodes: 8,
        targets: [{ field: "status", kind: "field", valueType: "enum", operators: ["eq"], nullable: false }],
      },
      sort: {
        fields: ["createdAt"], directions: ["asc", "desc"], maxCriteria: 1,
        default: [{ field: "createdAt", direction: "desc" }],
        nullPlacement: "last", stableTieBreaker: "record-id-asc",
      },
      pagination: { limit: { minimum: 1, maximum: 50, default: 20 }, cursor: { opaque: true } },
    } },
  } };
  const env = {
    ...base,
    IDENTITY: { fetch: async (url, init) => {
      const path = new URL(url).pathname;
      calls.push({ service: "IDENTITY", path, init });
      if (path === "/oauth/introspect") return Response.json(active);
      if (path === "/oauth/execution-tokens") {
        assert.equal(init.headers["x-lifespace-resource-secret"], SECRET);
        assert.deepEqual(JSON.parse(init.body), { token: TOKEN, resource: RESOURCE });
        return Response.json({ data: {
          tokenType: "Bearer", accessToken: signToken,
          scope: "resources:read", expiresIn: 60,
          applicationId: invalidExchange ? "app_other" : active.application_id,
          agentId: active.agent_id, spaceId: active.space_id,
        } });
      }
      throw new Error("Unexpected Identity endpoint " + path);
    } },
    CORE: { fetch: async (url, init) => {
      const path = new URL(url).pathname;
      calls.push({ service: "CORE", path, init });
      assert.equal(init.headers.authorization, "Bearer " + signToken);
      assert.ok(!JSON.stringify(init.headers).includes(TOKEN));
      if (denied && path.endsWith("/records/query")) return Response.json({ error: "forbidden" }, { status: 403 });
      if (path === "/api/v1/me/_discovery/inventory") return Response.json(inventory);
      if (path.endsWith("/_discovery/models/task")) return Response.json(detail);
      if (path.endsWith("/records/query")) return Response.json({ data: { items: [{ title: "Synthetic only" }] } });
      throw new Error("Unexpected Core endpoint " + path);
    } },
  };
  return { env, calls };
}

test("OAuth Agent Direct tools/list uses only Identity-minted Core JWT and scoped current discovery", async () => {
  const f = connectedFixture();
  const result = await handleIdentityOAuthMcp(rpc("tools/list"), f.env);
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.result.tools.length, 1);
  assert.equal(data.result.tools[0].name, "lifespace.query.task");
  assert.deepEqual(data.result.tools[0].inputSchema.properties.spaceId.enum, ["spc_synthetic"]);
  assert.deepEqual(f.calls.map(x => x.service + " " + x.path), [
    "IDENTITY /oauth/introspect",
    "IDENTITY /oauth/execution-tokens",
    "CORE /api/v1/me/_discovery/inventory",
    "CORE /api/v1/spaces/spc_synthetic/_discovery/models/task",
  ]);
});

test("OAuth MCP tools/call executes Canonical Query on the selected Space with current Core authority", async () => {
  const f = connectedFixture();
  const req = rpc("tools/call", { params: { name: "lifespace.query.task", arguments: {
    spaceId: "spc_synthetic", search: "Synthetic", filters: [{ field: "status", operator: "eq", value: "open" }],
    limit: 3,
  } } });
  const result = await handleIdentityOAuthMcp(req, f.env);
  assert.equal(result.status, 200);
  const resultBody = await result.json();
  assert.deepEqual(JSON.parse(resultBody.result.content[0].text), { items: [{ title: "Synthetic only" }] });
  const coreQuery = f.calls.find(x => x.path.endsWith("/records/query"));
  assert.equal(coreQuery.init.method, "POST");
  assert.deepEqual(JSON.parse(coreQuery.init.body), {
    search: { text: "Synthetic" },
    filter: { field: "status", op: "eq", value: "open" },
    page: { limit: 3 },
  });
  assert.ok(!JSON.stringify(f.calls.filter(x => x.service === "CORE")).includes(TOKEN));
});

test("Agent cannot select a second Space, stale tool or write API through OAuth MCP adapter", async () => {
  const f = connectedFixture();
  const wrong = await handleIdentityOAuthMcp(rpc("tools/call", { params: { name: "lifespace.query.task",
    arguments: { spaceId: "spc_other" } } }), f.env);
  assert.equal((await wrong.json()).error.code, -32602);
  assert.equal(f.calls.some(x => x.path.endsWith("/records/query")), false);
  const stale = await handleIdentityOAuthMcp(rpc("tools/call", { params: { name: "lifespace.update.task",
    arguments: { spaceId: "spc_synthetic" } } }), f.env);
  assert.equal((await stale.json()).error.code, -32602);
  assert.equal(f.calls.some(x => x.path.endsWith("/records/query")), false);
});

test("Core current-state denial is returned as a denied tool operation, never retried with OAuth bearer", async () => {
  const f = connectedFixture({ denied: true });
  const response = await handleIdentityOAuthMcp(rpc("tools/call", { params: { name: "lifespace.query.task",
    arguments: { spaceId: "spc_synthetic" } } }), f.env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.result.isError, true);
  assert.equal(payload.result.content[0].text, "CORE_PERMISSION_DENIED");
  assert.ok(!JSON.stringify(f.calls.filter(x => x.service === "CORE")).includes(TOKEN));
});

test("Core returned a different Space or Identity exchange mismatched Agent context: fail closed", async () => {
  for (const f of [connectedFixture({ wrongSpace: true }), connectedFixture({ invalidExchange: true })]) {
    const response = await handleIdentityOAuthMcp(rpc("tools/list"), f.env);
    assert.equal(response.status, 503);
    assert.equal(f.calls.some(x => x.path.endsWith("/records/query")), false);
  }
});
