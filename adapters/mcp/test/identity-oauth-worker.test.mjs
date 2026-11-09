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

function modernRpc(method, opts = {}) {
  const meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/clientInfo": { name: "synthetic-modern-client", version: "1.0" },
    ...(opts.meta || {}),
  };
  const params = { ...(opts.params || {}), _meta: meta };
  return new Request(RESOURCE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer " + TOKEN,
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": method,
      ...(method === "tools/call" ? { "Mcp-Name": params.name } : {}),
      ...(opts.headers || {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 42, method, params }),
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

test("one private Adapter serves multiple Core mcp_* Resources with exact OAuth isolation", async () => {
  const secondId = "mcp_" + "b".repeat(32);
  const second = "https://resource.example.com/mcp/" + secondId;
  const dynamic = {
    ...base, MCP_RESOURCE_URI: undefined,
    MCP_RESOURCE_ORIGIN: "https://resource.example.com",
  };
  const f = fixture();
  f.env = { ...f.env, ...dynamic };
  // Both IDs are syntactically canonical. The public Core ingress and its
  // current-state DB policy decide which ones are actually enabled.
  for (const [id, resource] of [[SERVER_ID, RESOURCE], [secondId, second]]) {
    const path = "/.well-known/oauth-protected-resource/mcp/" + id;
    const metadata = await handleIdentityOAuthMcp(
      new Request("https://resource.example.com" + path), f.env,
    );
    assert.equal(metadata.status, 200);
    assert.equal((await metadata.json()).resource, resource);
    const noBearer = await handleIdentityOAuthMcp(new Request(resource, {
      method: "POST", headers: {
        "content-type": "application/json", accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
    }), f.env);
    assert.equal(noBearer.status, 401);
    assert.equal(noBearer.headers.get("www-authenticate")?.includes(path), true);
  }
  assert.equal(f.calls.length, 0);
  // A bearer authorized for Server A fails for Server B, including if
  // another private Service Binding caller skips the Core ingress.
  const wrongBearer = await handleIdentityOAuthMcp(new Request(second, {
    method: "POST", headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream",
      authorization: "Bearer " + TOKEN,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
  }), f.env);
  assert.equal(wrongBearer.status, 401);
  assert.equal(f.calls.length, 1);
  assert.equal(new URLSearchParams(f.calls[0].init.body).get("resource"), second);

  for (const bad of [
    "https://resource.example.com/mcp",
    "https://resource.example.com/mcp/" + secondId + "/",
    "https://resource.example.com/mcp/not-an-id",
    "https://evil.example.com/mcp/" + secondId,
  ]) {
    const response = await handleIdentityOAuthMcp(new Request(bad, { method: "GET" }), f.env);
    assert.ok(response.status === 404 || response.status === 503);
  }
  assert.equal(oauthResourceConfig({ ...dynamic, MCP_RESOURCE_URI: RESOURCE }, second), null);
  assert.equal(oauthResourceConfig({ ...dynamic, MCP_RESOURCE_ORIGIN: "https://*.example.com" }, second), null);
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

test("Core MCP Server scope ceiling drives metadata and OAuth challenge across environments", async () => {
  for (const [environment, hint, expected] of [
    ["staging", null, "resources:read"],
    ["production", "resources:read", "resources:read"],
    ["staging", "resources:read resources:write", "resources:read resources:write"],
    ["production", "resources:read resources:write", "resources:read resources:write"],
    ["production", "resources:manage", "resources:read"],
  ]) {
    const f = fixture();
    f.env.ENVIRONMENT = environment;
    const scopeHeader = hint ? { "x-lifespace-mcp-scope-ceiling": hint } : {};
    const metadata = await handleIdentityOAuthMcp(
      new Request("https://resource.example.com/.well-known/oauth-protected-resource", {
        headers: scopeHeader,
      }), f.env,
    );
    assert.equal(metadata.status, 200);
    assert.deepEqual((await metadata.json()).scopes_supported, expected.split(" "));

    const result = await handleIdentityOAuthMcp(rpc("initialize", {
      headers: { authorization: "", ...scopeHeader },
    }), f.env);
    assert.equal(result.status, 401);
    assert.match(result.headers.get("www-authenticate") || "",
      new RegExp('scope="' + expected + '"', "u"));
    assert.equal(f.calls.length, 0);
  }
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

test("Identity-verified CIMD client IDs retain exact OAuth resource and authorization context", async () => {
  const clientId = "https://agent.example.com/oauth/client.json";
  const result = validateIntrospection({ ...active, client_id: clientId }, oauthResourceConfig(base));
  assert.equal(result.context.clientId, clientId);
  assert.equal(result.context.authorizationId, active.authorization_id);
  for (const badId of [
    "http://agent.example.com/oauth/client.json",
    "https://agent.example.com/",
    "https://localhost/oauth/client.json",
    "https://127.0.0.1/oauth/client.json",
    "https://agent.example.com/oauth/client.json?redirect=https://evil.example",
    "https://bad:pass@agent.example.com/oauth/client.json",
    "https://agent.example.com:443/oauth/client.json",
  ]) {
    // URL normalization is exact; no user-supplied URL is ever fetched here.
    assert.deepEqual(
      validateIntrospection({ ...active, client_id: badId }, oauthResourceConfig(base)),
      { error: "invalid_token" },
      badId,
    );
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


function connectedFixture({ denied = false, wrongSpace = false, invalidExchange = false, modelCount = 1, queryStatus = 200, discoveryStatus = 200, queryThrows = false, oauthScopes = "resources:read", advertisedAccess = ["read"], mutations = false, mutationStatus = 201, environment = "test", mcpOperations = null, mayDelegate = false } = {}) {
  const calls = [];
  let tokenActive = true;
  const signToken = ["eyJ" + "syntheticheader", "syntheticpayload", "syntheticsignature"].join(".");
  const schema = "a".repeat(64);
  const modelKeys = modelCount === 1 ? ["task"]
    : Array.from({ length: modelCount }, (_unused, index) => "task_" + String(index).padStart(2, "0"));
  const inventory = { data: {
    semanticDetailPathTemplate: "/api/v1/spaces/{spaceId}/_discovery/models/{modelKey}",
    models: modelKeys.map(key => ({ key, version: 3, schemaHash: schema })),
    spaces: [{
      spaceId: wrongSpace ? "spc_other" : "spc_synthetic",
      spaceName: "Synthetic", models: modelKeys.map(key => ({ modelKey: key, access: advertisedAccess })),
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
  if (Array.isArray(mcpOperations)) detail.data.mcpOperations = mcpOperations;
  if (mutations) detail.data.mutations = {
    contractId: "mct_" + "b".repeat(64), modelVersion: 3, schemaHash: schema,
    operations: { create: { $ref: "#/$defs/Create" }, update: { $ref: "#/$defs/Update" }, delete: { type: "object", properties: { version: { type: "integer" } }, required: ["version"] } },
    $defs: { Create: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
      Update: { type: "object", properties: { name: { type: "string" }, version: { type: "integer" } }, required: ["version"], additionalProperties: false } },
  };
  // Core owns the same operation projection for every storage kind.
  // The test transport knows only opaque operationRef; no Native/External/Person dispatch.
  const operations = Array.isArray(mcpOperations) ? mcpOperations
    : mutations ? ["query", "create", "update", "delete"] : ["query"];
  const allowedOperations = operations.filter(op => ["query","get"].includes(op)
    ? advertisedAccess.includes("read") : advertisedAccess.includes("write"));
  const syntheticCatalog = modelKeys.flatMap((key,index) => allowedOperations.map((op,j) => {
    const ref = "op_" + (index * 8 + j + 1).toString(16).padStart(64,"0");
    return {operationRef:ref,modelKey:key,display:"Task",operation:op,
      title:op+" Task",description:"Core current authorized operation",
      requiredScopes:["query","get"].includes(op)?["resources:read"]:["resources:read","resources:write"],
      inputSchema:{type:"object",additionalProperties:false,
        properties:{spaceId:{type:"string",enum:[wrongSpace?"spc_other":"spc_synthetic"]},
          ...(op==="get"||op==="update"||op==="delete"
            ?{recordId:{type:"string",minLength:1}}:{}),
          ...(op==="get"?{}:{data:op==="create"&&mutations
            ?{$ref:"#/$defs/Create"}:{type:"object"}})},
        required:["spaceId",...(op==="get"||op==="update"||op==="delete"?["recordId"]:[]),
          ...(op==="create"||op==="update"||op==="delete"?["data"]:[])],
        ...(op==="create"&&mutations?{$defs:detail.data.mutations.$defs}:{})}};
  }));
  const operationByRef = new Map(syntheticCatalog.map(row => [row.operationRef,row.operation]));
  const env = {
    ...base, ENVIRONMENT: environment,
    IDENTITY: { fetch: async (url, init) => {
      const path = new URL(url).pathname;
      calls.push({ service: "IDENTITY", path, init });
      if (path === "/oauth/introspect") return Response.json(tokenActive ? { ...active, scope: oauthScopes, allow_user_authorization: mayDelegate } : { active: false });
      if (path === "/oauth/execution-tokens") {
        assert.equal(init.headers["x-lifespace-resource-secret"], SECRET);
        assert.deepEqual(JSON.parse(init.body), { token: TOKEN, resource: RESOURCE, ...((JSON.parse(init.body)).delegationId ? {delegationId:"dlg_synthetic"} : {}) });
        return Response.json({ data: {
          tokenType: "Bearer", accessToken: signToken,
          scope: mutations ? oauthScopes : "resources:read", expiresIn: 60,
          applicationId: invalidExchange ? "app_other" : active.application_id,
          agentId: active.agent_id, spaceId: active.space_id,
        } });
      }
      throw new Error("Unexpected Identity endpoint " + path);
    } },
    CORE: { fetch: async (url, init) => {
      const path = new URL(url).pathname;
      calls.push({ service: "CORE", path, url:String(url), init });
      assert.equal(init.headers.authorization, "Bearer " + signToken);
      assert.ok(!JSON.stringify(init.headers).includes(TOKEN));
      if (denied && path.endsWith("/records/query")) return Response.json({ error: "forbidden" }, { status: 403 });
      if (mayDelegate && path === "/api/v1/spaces/spc_synthetic/oauth-delegation-requests" && init.method === "POST") {
        const v = JSON.parse(init.body);
        assert.ok(["task","person","external_synthetic"].includes(v.modelKey));
        assert.ok(v.modelKey==="person"
          ? ["query","get","create","update","delete"].includes(v.operation)
          : v.modelKey==="external_synthetic" ? v.operation==="update"
          : ["create","action:complete"].includes(v.operation));
        assert.equal(typeof v.reason,"string");
        return Response.json({data:{id:"arq_"+ "f".repeat(32),status:"pending",approvalUrl:"https://account.example.test/delegation?request_id=arq_"+ "f".repeat(32)}});
      }
      if (mayDelegate && path === "/api/v1/spaces/spc_synthetic/oauth-delegation-requests/arq_"+"f".repeat(32)) {
        return Response.json({data:{id:"arq_"+"f".repeat(32),status:"approved",delegationId:"dlg_synthetic"}});
      }
      if (path === "/api/v1/spaces/spc_synthetic/_discovery/operations") {
        if (discoveryStatus !== 200)
          return Response.json({error:"synthetic Core unavailability"},{status:discoveryStatus});
        return Response.json({data:{operations:syntheticCatalog}});
      }
      const invocation = /^\/api\/v1\/spaces\/spc_synthetic\/_operations\/(op_[a-f0-9]{64})\/invoke$/u.exec(path);
      if (invocation) {
        assert.equal(init.method,"POST");
        const requested = JSON.parse(init.body);
        assert.deepEqual(Object.keys(requested),["arguments"]);
        const op = operationByRef.get(invocation[1]);
        if (!op) return Response.json({error:"unknown operation"},{status:404});
        if (op === "query") {
          if (denied) return Response.json({error:"forbidden"},{status:403});
          if (queryThrows) throw new Error("Synthetic Core query unavailable");
          if (queryStatus !== 200)
            return Response.json({error:{code:"SYNTHETIC_PRIVATE_ERROR",message:"Do not expose upstream details"}},{status:queryStatus});
          return Response.json({data:{items:[{title:"Synthetic only"}]}});
        }
        if (op === "get") return Response.json({data:{id:"rec_synthetic",version:1}});
        const payload=requested.arguments?.data;
        if (["update","delete"].includes(op)&&(!Number.isSafeInteger(payload?.version)||payload.version<1))
          return Response.json({error:"Missing current version"},{status:422});
        if (mutationStatus !== 201) return Response.json({error:"synthetic write failure"},{status:mutationStatus});
        if (op === "delete") return new Response(null,{status:204});
        return Response.json({data:{id:"rec_synthetic",version:1}},{status:op==="create"?201:200});
      }
      if (path === "/api/v1/me/_discovery/inventory") {
        if (discoveryStatus !== 200) return Response.json({ error: "synthetic upstream details" }, { status: discoveryStatus });
        return Response.json(inventory);
      }
      if (path.endsWith("/_discovery/models/batch")) {
        assert.equal(init.method, "POST");
        assert.deepEqual(JSON.parse(init.body), { modelKeys });
        return Response.json({ data: {
          models: modelKeys.map(modelKey => ({
            modelKey, detail: { ...detail.data, key: modelKey },
          })),
        } });
      }
      if (mcpOperations?.includes("get") && init.method === "GET"
        && path === "/api/v1/spaces/spc_synthetic/models/task/records/rec_synthetic") {
        return Response.json({ data: { id: "rec_synthetic", version: 1 } });
      }
      if (mayDelegate && /^\/api\/v1\/spaces\/spc_synthetic\/people(?:\/per_synthetic)?$/u.test(path)) {
        assert.equal(init.headers["x-lifespace-delegation-id"],"dlg_synthetic");
        if (init.method==="POST"){
          assert.equal(path,"/api/v1/spaces/spc_synthetic/people");
          return Response.json({data:{id:"per_synthetic",displayName:"Synthetic Person",version:1}},{status:201});
        }
        if (init.method==="GET"){
          if (path.endsWith("/per_synthetic"))
            return Response.json({data:{id:"per_synthetic",displayName:"Synthetic Person",version:1}});
          return Response.json({data:{items:[{id:"per_synthetic"}],nextCursor:null}});
        }
        if (init.method==="PATCH"){
          assert.deepEqual(JSON.parse(init.body),{version:1,displayName:"Synthetic Updated"});
          return Response.json({data:{id:"per_synthetic",displayName:"Synthetic Updated",version:2}});
        }
        if (init.method==="DELETE"){
          assert.deepEqual(JSON.parse(init.body),{version:2});
          return new Response(null,{status:204});
        }
      }
      if (mayDelegate && init.method === "POST"
        && path === "/api/v1/spaces/spc_synthetic/models/task/records/rec_synthetic/actions/complete") {
        assert.equal(init.headers["x-lifespace-delegation-id"],"dlg_synthetic");
        assert.deepEqual(JSON.parse(init.body),{version:1});
        return Response.json({data:{id:"rec_synthetic",version:2,status:"completed"}});
      }
      if (mayDelegate && init.method === "PATCH"
        && path === "/api/v1/spaces/spc_synthetic/models/external_synthetic/records/rec_external_synthetic") {
        assert.equal(init.headers["x-lifespace-delegation-id"],"dlg_synthetic");
        assert.deepEqual(JSON.parse(init.body),{amount:8});
        return Response.json({data:{id:"rec_external_synthetic",amount:8}});
      }
      if (mayDelegate && init.method === "POST" && path === "/api/v1/spaces/spc_synthetic/models/task/records") {
        assert.equal(init.headers["x-lifespace-delegation-id"], "dlg_synthetic");
        return Response.json({data:{id:"rec_synthetic",version:1}});
      }
      if (mutations && /\/records(?:\/rec_synthetic)?$/u.test(path)) {
        if (init.method === "DELETE" && mutationStatus === 201) return new Response(null, { status: 204 });
        return Response.json({ data: { id: "rec_synthetic", version: 1 } }, { status: mutationStatus });
      }
      if (path.endsWith("/records/query")) {
        if (queryThrows) throw new Error("Synthetic private upstream exception");
        if (queryStatus !== 200) {
          return Response.json({ error: { code: "SYNTHETIC_PRIVATE_ERROR", message: "Do not expose upstream details" } },
            { status: queryStatus });
        }
        return Response.json({ data: { items: [{ title: "Synthetic only" }] } });
      }
      throw new Error("Unexpected Core endpoint " + path);
    } },
  };
  return { env, calls, revokeOAuth: () => { tokenActive = false; } };
}

test("2026-07-28 stateless server/discover advertises both modern and legacy protocols", async () => {
  const f = connectedFixture();
  const response = await handleIdentityOAuthMcp(modernRpc("server/discover"), f.env);
  assert.equal(response.status, 200);
  const data = (await response.json()).result;
  assert.equal(data.resultType, "complete");
  assert.deepEqual(data.supportedVersions, ["2026-07-28", "2025-11-25"]);
  assert.ok(data._meta["io.modelcontextprotocol/serverInfo"].name);
  assert.deepEqual(f.calls.map(x => x.path), ["/oauth/introspect"]);
  // The original OAuth legacy handshake is intentionally not removed.
  const legacy = await handleIdentityOAuthMcp(rpc("initialize"), f.env);
  assert.equal(legacy.status, 200);
  assert.equal((await legacy.json()).result.protocolVersion, "2025-11-25");
});

test("modern tools/list and tools/call use per-request metadata and batched Core authority", async () => {
  const f = connectedFixture();
  const listed = await handleIdentityOAuthMcp(modernRpc("tools/list"), f.env);
  assert.equal(listed.status, 200);
  const list = (await listed.json()).result;
  assert.equal(list.resultType, "complete");
  assert.equal(list.cacheScope, "private");
  assert.equal(list.tools[0].name, "lifespace.query.task");
  const called = await handleIdentityOAuthMcp(modernRpc("tools/call", {
    params: { name: "lifespace.query.task", arguments: { spaceId: "spc_synthetic" } },
  }), f.env);
  assert.equal(called.status, 200);
  const result = (await called.json()).result;
  assert.equal(result.resultType, "complete");
  assert.equal(JSON.parse(result.content[0].text).items[0].title, "Synthetic only");
  assert.equal(f.calls.filter(x => x.path.endsWith("/_discovery/operations")).length, 2);
});

test("modern headers/body mismatch, unsupported revision and legacy-only methods fail closed", async () => {
  for (const [request, expectedStatus, expectedCode] of [
    [modernRpc("tools/list", { headers: { "Mcp-Method": "tools/call" } }), 400, -32020],
    [modernRpc("tools/list", { headers: { "MCP-Protocol-Version": "2025-11-25" } }), 400, -32020],
    [modernRpc("tools/list", { meta: { "io.modelcontextprotocol/protocolVersion": "1900-01-01" } }), 400, -32020],
    [modernRpc("tools/list", { headers: { "MCP-Protocol-Version": "1900-01-01" } }), 400, -32022],
    [modernRpc("tools/call", { params: { name: "lifespace.query.task", arguments: {} },
      headers: { "Mcp-Name": "lifespace.query.other" } }), 400, -32020],
    [modernRpc("initialize"), 404, -32601],
    [modernRpc("ping"), 404, -32601],
  ]) {
    const f = connectedFixture();
    const response = await handleIdentityOAuthMcp(request, f.env);
    assert.equal(response.status, expectedStatus);
    assert.equal((await response.json()).error.code, expectedCode);
    assert.equal(f.calls.some(x => x.service === "CORE"), false);
  }
});

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
    "CORE /api/v1/spaces/spc_synthetic/_discovery/operations",
  ]);
});

test("tools/list projects 20 authorized Models in one Core batch request, not 20 Worker calls", async () => {
  const f = connectedFixture({ modelCount: 20 });
  const response = await handleIdentityOAuthMcp(rpc("tools/list"), f.env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.result.tools.length, 20);
  assert.equal(new Set(data.result.tools.map(item => item.name)).size, 20);
  assert.equal(f.calls.filter(x => x.service === "CORE").length, 1);
  assert.deepEqual(f.calls.filter(x => x.service === "CORE").map(x => x.path), [
    "/api/v1/spaces/spc_synthetic/_discovery/operations",
  ]);
});

test("OAuth MCP tools/call executes Canonical Query on the selected Space with current Core authority", async () => {
  const f = connectedFixture();
  const req = rpc("tools/call", { params: { name: "lifespace.query.task", arguments: {
    spaceId: "spc_synthetic", data: {
      search: { text: "Synthetic" },
      filter: { field: "status", op: "eq", value: "open" },
      page: { limit: 3 },
    },
  } } });
  const result = await handleIdentityOAuthMcp(req, f.env);
  assert.equal(result.status, 200);
  const resultBody = await result.json();
  assert.deepEqual(JSON.parse(resultBody.result.content[0].text), { items: [{ title: "Synthetic only" }] });
  const coreQuery = f.calls.find(x => /\/_operations\/op_[a-f0-9]{64}\/invoke$/u.test(x.path));
  assert.equal(coreQuery.init.method, "POST");
  assert.deepEqual(JSON.parse(coreQuery.init.body), { arguments: {
    spaceId:"spc_synthetic", data:{
      search: { text: "Synthetic" },
      filter: { field: "status", op: "eq", value: "open" },
      page: { limit: 3 },
    },
  } });
  assert.ok(!JSON.stringify(f.calls.filter(x => x.service === "CORE")).includes(TOKEN));
});

test("revoking an OAuth Authorization invalidates cached MCP tool calls without a tool refresh", async () => {
  const f = connectedFixture();
  const list = await handleIdentityOAuthMcp(rpc("tools/list"), f.env);
  assert.equal(list.status, 200);
  assert.equal((await list.json()).result.tools[0].name, "lifespace.query.task");
  const before = f.calls.length;

  // Identity invalidates the authorization after the Client caches tools/list.
  // An unexpired client tool schema must never become execution authority.
  f.revokeOAuth();
  for (const request of [
    rpc("tools/call", { params: { name: "lifespace.query.task", arguments: { spaceId: "spc_synthetic" } } }),
    modernRpc("tools/call", { params: { name: "lifespace.query.task", arguments: { spaceId: "spc_synthetic" } } }),
    rpc("tools/list"),
  ]) {
    const response = await handleIdentityOAuthMcp(request, f.env);
    assert.equal(response.status, 401);
    assert.match(response.headers.get("www-authenticate") || "", /invalid_token/u);
    assert.ok(!JSON.stringify(await response.json()).includes(TOKEN));
  }
  assert.deepEqual(f.calls.slice(before).map(call => call.path), [
    "/oauth/introspect", "/oauth/introspect", "/oauth/introspect",
  ]);
  assert.equal(f.calls.filter(call => call.path.endsWith("/records/query")).length, 0);
});

test("OAuth read/write consent and a write-capable Core preview cannot widen read-only MCP execution", async () => {
  // Tests the existing read-only resource server, not a new write capability.
  // Even a broader OAuth consent/Grant/Server must not forge a mutation tool.
  const f = connectedFixture({
    oauthScopes: "resources:read resources:write", advertisedAccess: ["read", "write"],
  });
  const list = await handleIdentityOAuthMcp(rpc("tools/list"), f.env);
  assert.equal(list.status, 200);
  assert.deepEqual((await list.json()).result.tools.map(tool => tool.name), ["lifespace.query.task"]);

  for (const name of [
    "lifespace.create.task", "lifespace.update.task",
    "lifespace.delete.task", "lifespace.action.task.complete",
  ]) {
    const response = await handleIdentityOAuthMcp(rpc("tools/call", {
      params: { name, arguments: { spaceId: "spc_synthetic", title: "Synthetic only" } },
    }), f.env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).error.code, -32602);
  }
  assert.equal(f.calls.some(call => call.path.endsWith("/records")), false);
  assert.equal(f.calls.some(call => call.path.endsWith("/records/query")), false);

  const read = await handleIdentityOAuthMcp(rpc("tools/call", {
    params: { name: "lifespace.query.task", arguments: { spaceId: "spc_synthetic" } },
  }), f.env);
  assert.equal(read.status, 200);
  assert.equal(JSON.parse((await read.json()).result.content[0].text).items[0].title, "Synthetic only");
  assert.equal(f.calls.filter(call => call.path.includes("/_operations/op_")).length, 1);
  assert.ok(!JSON.stringify(f.calls.filter(call => call.service === "CORE")).includes(TOKEN));
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

test("Core Canonical Query 400/422 becomes a bounded MCP invalid-arguments tool result", async () => {
  for (const status of [400, 422]) {
    const f = connectedFixture({ queryStatus: status });
    const response = await handleIdentityOAuthMcp(modernRpc("tools/call", {
      params: { name: "lifespace.query.task", arguments: {
        spaceId: "spc_synthetic", data: { cursor: "synthetic-invalid-cursor" },
      } },
    }), f.env);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.result.resultType, "complete");
    assert.equal(payload.result.isError, true);
    assert.deepEqual(payload.result.content, [{ type: "text", text: "INVALID_OPERATION_ARGUMENTS" }]);
    assert.equal(f.calls.filter(call => call.path.includes("/_operations/op_")).length, 1);
    assert.ok(!JSON.stringify(payload).includes("SYNTHETIC_PRIVATE_ERROR"));
    assert.ok(!JSON.stringify(payload).includes(TOKEN));
  }
});

test("Core permission failures, upstream outages and discovery errors remain fail-closed", async () => {
  for (const [queryStatus, expected] of [
    [401, "CORE_PERMISSION_DENIED"], [403, "CORE_PERMISSION_DENIED"],
    [429, "CORE_UNAVAILABLE"], [500, "CORE_UNAVAILABLE"],
  ]) {
    const f = connectedFixture({ queryStatus });
    const response = await handleIdentityOAuthMcp(rpc("tools/call", {
      params: { name: "lifespace.query.task", arguments: { spaceId: "spc_synthetic" } },
    }), f.env);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.result.isError, true);
    assert.equal(payload.result.content[0].text, expected);
    assert.ok(!JSON.stringify(payload).includes("SYNTHETIC_PRIVATE_ERROR"));
  }
  const interrupted = connectedFixture({ queryThrows: true });
  const failed = await handleIdentityOAuthMcp(rpc("tools/call", {
    params: { name: "lifespace.query.task", arguments: { spaceId: "spc_synthetic" } },
  }), interrupted.env);
  assert.equal((await failed.json()).result.content[0].text, "CORE_UNAVAILABLE");

  // Discovery does not accept user Canonical Query parameters; a 400 here
  // remains an upstream failure rather than an invalid tool argument.
  const discovery = connectedFixture({ discoveryStatus: 400 });
  const response = await handleIdentityOAuthMcp(rpc("tools/list"), discovery.env);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "CORE_UNAVAILABLE" });
});

test("Core returned a different Space or Identity exchange mismatched Agent context: fail closed", async () => {
  for (const f of [connectedFixture({ wrongSpace: true }), connectedFixture({ invalidExchange: true })]) {
    const response = await handleIdentityOAuthMcp(rpc("tools/list"), f.env);
    assert.equal(response.status, 503);
    assert.equal(f.calls.some(x => x.path.endsWith("/records/query")), false);
  }
});


test("Staging projects and executes only Core contract-backed Native mutations with exact Space/version", async () => {
  const f = connectedFixture({ mutations: true, environment: "staging", oauthScopes: "resources:read resources:write", advertisedAccess: ["read", "write"] });
  const tools = (await (await handleIdentityOAuthMcp(rpc("tools/list"), f.env)).json()).result.tools;
  assert.deepEqual(tools.map(t => t.name).sort(), ["lifespace.create.task", "lifespace.delete.task", "lifespace.query.task", "lifespace.update.task"]);
  assert.equal(tools.find(t => t.name === "lifespace.create.task").inputSchema.properties.data.$ref, "#/$defs/Create");
  for (const [op, args] of [
    ["create", { spaceId: "spc_synthetic", data: { name: "Synthetic only" } }],
    ["update", { spaceId: "spc_synthetic", recordId: "rec_synthetic", data: { version: 1, name: "Changed" } }],
    ["delete", { spaceId: "spc_synthetic", recordId: "rec_synthetic", data: { version: 1 } }],
  ]) {
    const response = await handleIdentityOAuthMcp(rpc("tools/call", { params: { name: "lifespace." + op + ".task", arguments: args } }), f.env);
    const result = (await response.json()).result;
    assert.equal(result.isError, undefined);
    if (op === "delete") assert.equal(JSON.parse(result.content[0].text).deleted, true);
  }
  assert.deepEqual(f.calls.filter(c => /\/_operations\/op_[a-f0-9]{64}\/invoke$/u.test(c.path)).map(c => c.init.method), ["POST", "POST", "POST"]);
  for (const args of [
    { spaceId: "spc_other", data: { name: "No" } },
    { spaceId: "spc_synthetic", data: {}, principalUserId: "usr_other" },
  ]) {
    const denied = await handleIdentityOAuthMcp(rpc("tools/call", { params: { name: "lifespace.create.task", arguments: args } }), f.env);
    assert.equal((await denied.json()).error.code, -32602);
  }
  const badVersion = await handleIdentityOAuthMcp(rpc("tools/call", { params: { name: "lifespace.delete.task", arguments: { spaceId: "spc_synthetic", recordId: "rec_synthetic", data: {} } } }), f.env);
  assert.deepEqual((await badVersion.json()).result.content, [
    {type:"text",text:"INVALID_OPERATION_ARGUMENTS"}]);
  f.revokeOAuth();
  assert.equal((await handleIdentityOAuthMcp(rpc("tools/call", { params: { name: "lifespace.create.task", arguments: { spaceId: "spc_synthetic", data: { name: "No" } } } }), f.env)).status, 401);
});

test("Get-only Server lists only Native Get and executes exact record read", async () => {
  const f = connectedFixture({ mcpOperations: ["get"] });
  const listed = await handleIdentityOAuthMcp(rpc("tools/list"), f.env);
  assert.equal(listed.status, 200);
  assert.deepEqual((await listed.json()).result.tools.map(t => t.name), ["lifespace.get.task"]);
  const fetched = await handleIdentityOAuthMcp(rpc("tools/call", {
    params: { name: "lifespace.get.task",
      arguments: { spaceId: "spc_synthetic", recordId: "rec_synthetic" } },
  }), f.env);
  assert.deepEqual(JSON.parse((await fetched.json()).result.content[0].text),
    { id: "rec_synthetic", version: 1 });
  assert.ok(f.calls.some(c => c.service === "CORE"
    && /\/_operations\/op_[a-f0-9]{64}\/invoke$/u.test(c.path)
    && JSON.parse(c.init.body).arguments.recordId === "rec_synthetic"));
  const forbidden = await handleIdentityOAuthMcp(rpc("tools/call", {
    params: { name: "lifespace.query.task", arguments: { spaceId: "spc_synthetic" } },
  }), f.env);
  assert.equal((await forbidden.json()).error.code, -32602);
});

test("third-party OAuth may request LifeSpace Account URL, status and explicit represented execution", async () => {
  const f=connectedFixture({mayDelegate:true, oauthScopes:"resources:read resources:write"});
  const listed=await handleIdentityOAuthMcp(rpc("tools/list"),f.env);
  assert.equal(listed.status,200);
  const tools=(await listed.json()).result.tools;
  const names=tools.map(x=>x.name);
  assert.ok(names.includes("lifespace.request_user_delegation"));
  assert.ok(names.includes("lifespace.user_delegation_status"));
  assert.ok(names.includes("lifespace.execute_user_delegation"));
  const executeTool=tools.find(x=>x.name==="lifespace.execute_user_delegation");
  assert.ok(executeTool?.description?.includes("Account selects one-use, bounded time-limited repeat, or until-revoked lifetime"));
  assert.equal(executeTool?.inputSchema?.properties?.mode,undefined,
    "Agent must not choose duration/lifetime; only Account User can decide");

  const request=await handleIdentityOAuthMcp(rpc("tools/call",{params:{
    name:"lifespace.request_user_delegation",arguments:{
      modelKey:"task",operation:"create",reason:"Please create one task",
    },
  }}),f.env);
  const result=JSON.parse((await request.json()).result.content[0].text);
  assert.match(result.approvalUrl,/^https:\/\/account\.example\.test\/delegation\?request_id=arq_/u);
  const status=await handleIdentityOAuthMcp(rpc("tools/call",{params:{
    name:"lifespace.user_delegation_status",arguments:{requestId:"arq_"+"f".repeat(32)},
  }}),f.env);
  assert.equal(JSON.parse((await status.json()).result.content[0].text).status,"approved");
  const invoked=await handleIdentityOAuthMcp(rpc("tools/call",{params:{
    name:"lifespace.execute_user_delegation",arguments:{
      delegationId:"dlg_synthetic",modelKey:"task",operation:"create",data:{name:"Synthetic only"},
    },
  }}),f.env);
  assert.deepEqual(JSON.parse((await invoked.json()).result.content[0].text),{id:"rec_synthetic",version:1});
  const executeCalls=f.calls.filter(x=>x.path==="/oauth/execution-tokens");
  assert.ok(executeCalls.some(x=>JSON.parse(x.init.body).delegationId==="dlg_synthetic"));
  assert.ok(f.calls.some(x=>x.service==="CORE" && x.init.headers["x-lifespace-delegation-id"]==="dlg_synthetic"));
  // Published Native Action is another exact operation under the same
  // Account approval UX; it is never routed through trusted Agent confirmation.
  const actionRequest=await handleIdentityOAuthMcp(rpc("tools/call",{params:{
    name:"lifespace.request_user_delegation",arguments:{
      modelKey:"task",operation:"action:complete",reason:"Complete approved task once",
    },
  }}),f.env);
  assert.ok(JSON.parse((await actionRequest.json()).result.content[0].text).approvalUrl);
  const action=await handleIdentityOAuthMcp(rpc("tools/call",{params:{
    name:"lifespace.execute_user_delegation",arguments:{
      delegationId:"dlg_synthetic",modelKey:"task",operation:"action:complete",
      recordId:"rec_synthetic",data:{version:1},
    },
  }}),f.env);
  assert.deepEqual(JSON.parse((await action.json()).result.content[0].text),
    {id:"rec_synthetic",version:2,status:"completed"});
  assert.ok(f.calls.some(x=>x.service==="CORE"&&x.path.endsWith("/records/rec_synthetic/actions/complete")));
});

test("third-party Account-approved Person supports Kernel routes but never inherits Native record ids or authority", async()=>{
  const f=connectedFixture({mayDelegate:true,oauthScopes:"resources:read resources:write"});
  async function call(name,args){
    const resp=await handleIdentityOAuthMcp(rpc("tools/call",{params:{
      name,arguments:args,
    }}),f.env);
    return (await resp.json());
  }
  const request=await call("lifespace.request_user_delegation",{
    modelKey:"person",operation:"create",reason:"Create one approved Person",
  });
  assert.ok(JSON.parse(request.result.content[0].text).approvalUrl);
  const base={delegationId:"dlg_synthetic",modelKey:"person"};
  const create=await call("lifespace.execute_user_delegation",{
    ...base,operation:"create",data:{displayName:"Synthetic Person"},
  });
  assert.equal(JSON.parse(create.result.content[0].text).id,"per_synthetic");
  const get=await call("lifespace.execute_user_delegation",{
    ...base,operation:"get",recordId:"per_synthetic",
  });
  assert.equal(JSON.parse(get.result.content[0].text).displayName,"Synthetic Person");
  const query=await call("lifespace.execute_user_delegation",{
    ...base,operation:"query",data:{search:"Synthetic",limit:3},
  });
  assert.equal(JSON.parse(query.result.content[0].text).items[0].id,"per_synthetic");
  assert.ok(f.calls.some(c=>c.service==="CORE" && c.init.method==="GET"
    && c.url.includes("/people?q=Synthetic&limit=3")));
  const updated=await call("lifespace.execute_user_delegation",{
    ...base,operation:"update",recordId:"per_synthetic",
    data:{version:1,displayName:"Synthetic Updated"},
  });
  assert.equal(JSON.parse(updated.result.content[0].text).version,2);
  const deleted=await call("lifespace.execute_user_delegation",{
    ...base,operation:"delete",recordId:"per_synthetic",data:{version:2},
  });
  assert.equal(JSON.parse(deleted.result.content[0].text).deleted,true);
  const wrongId=await call("lifespace.execute_user_delegation",{
    ...base,operation:"update",recordId:"rec_native",
    data:{version:1,displayName:"Forbidden"},
  });
  assert.equal(wrongId.error.code,-32602);
  const wrongSchema=await call("lifespace.execute_user_delegation",{
    ...base,operation:"query",data:{arbitrary:"field"},
  });
  assert.equal(wrongSchema.error.code,-32602);
  assert.equal(f.calls.filter(c=>c.service==="CORE"&&c.path.includes("/people")).length,5);
});

test("External Account-approved write passes current Provider payload without Native version; Core owns at-most-one attempt",async()=>{
  const f=connectedFixture({mayDelegate:true,oauthScopes:"resources:read resources:write"});
  const request=await handleIdentityOAuthMcp(rpc("tools/call",{params:{
    name:"lifespace.request_user_delegation",
    arguments:{modelKey:"external_synthetic",operation:"update",reason:"One Provider write attempt"},
  }}),f.env);
  assert.ok(JSON.parse((await request.json()).result.content[0].text).approvalUrl);
  const executed=await handleIdentityOAuthMcp(rpc("tools/call",{params:{
    name:"lifespace.execute_user_delegation",
    arguments:{delegationId:"dlg_synthetic",modelKey:"external_synthetic",operation:"update",
      recordId:"rec_external_synthetic",data:{amount:8}},
  }}),f.env);
  assert.deepEqual(JSON.parse((await executed.json()).result.content[0].text),
    {id:"rec_external_synthetic",amount:8});
  const actual=f.calls.filter(c=>c.service==="CORE"&&c.init.method==="PATCH"
    && c.path.endsWith("/records/rec_external_synthetic"));
  assert.equal(actual.length,1);
  assert.equal(actual[0].init.headers["x-lifespace-delegation-id"],"dlg_synthetic");
});

test("third-party OAuth Delegation unavailable when opt-in disabled or write Scope absent", async () => {
  const disabled=connectedFixture({mayDelegate:false,oauthScopes:"resources:read resources:write"});
  const list=await handleIdentityOAuthMcp(rpc("tools/list"),disabled.env);
  assert.ok(!(await list.json()).result.tools.some(x=>x.name==="lifespace.request_user_delegation"));
  const fake=await handleIdentityOAuthMcp(rpc("tools/call",{params:{
    name:"lifespace.request_user_delegation",arguments:{
      modelKey:"task",operation:"create",reason:"Please create one task",
    },
  }}),disabled.env);
  assert.equal((await fake.json()).error.code,-32602);
  const readOnly=connectedFixture({mayDelegate:true,oauthScopes:"resources:read"});
  const blocked=await handleIdentityOAuthMcp(rpc("tools/call",{params:{
    name:"lifespace.request_user_delegation",arguments:{
      modelKey:"task",operation:"create",reason:"Please create one task",
    },
  }}),readOnly.env);
  assert.equal(blocked.status,403);
  assert.match(blocked.headers.get("www-authenticate")||"",/error="insufficient_scope"/u);
  const blockedMeta=(await blocked.json()).result._meta["mcp/www_authenticate"][0];
  assert.match(blockedMeta,/scope="resources:read resources:write"/u);
  assert.equal(readOnly.calls.some(x=>x.path.endsWith("/oauth-delegation-requests")),false);
});

test("Delegation tools advertise OAuth and provide bounded write Scope step-up", async () => {
  const f=connectedFixture({mayDelegate:true,oauthScopes:"resources:read"});
  const listed=await handleIdentityOAuthMcp(rpc("tools/list"),f.env);
  const list=(await listed.json()).result.tools;
  for(const name of [
    "lifespace.request_user_delegation",
    "lifespace.user_delegation_status",
    "lifespace.execute_user_delegation",
  ]){
    const tool=list.find(x=>x.name===name);
    assert.ok(tool,name);
    assert.deepEqual(tool.securitySchemes,[{type:"oauth2",scopes:["resources:read"]}]);
    assert.deepEqual(tool._meta.securitySchemes,tool.securitySchemes);
  }
  for(const operation of ["create","action:complete"]){
    const reply=await handleIdentityOAuthMcp(rpc("tools/call",{headers:{
      "x-lifespace-mcp-scope-ceiling":"resources:read resources:write",
    },params:{name:"lifespace.request_user_delegation",arguments:{
      modelKey:"task",operation,reason:"Synthetic authorized change test",
    }}}),f.env);
    assert.equal(reply.status,403);
    assert.match(reply.headers.get("www-authenticate")||"",/error="insufficient_scope"/u);
    const body=(await reply.json()).result;
    assert.equal(body.isError,true);
    const challenge=body._meta["mcp/www_authenticate"][0];
    assert.match(challenge,/scope="resources:read resources:write"/u);
    assert.match(challenge,/error="insufficient_scope"/u);
    assert.match(challenge,/oauth-protected-resource/u);
  }
  assert.equal(f.calls.some(x=>x.path.endsWith("/oauth-delegation-requests")),false);
});

test("Production and Staging advertise potentially upgradable writes but never grant them implicitly", async () => {
  const names=["lifespace.create.task","lifespace.delete.task","lifespace.query.task","lifespace.update.task"];
  const readOnly=connectedFixture({mutations:true,environment:"production",
    oauthScopes:"resources:read",advertisedAccess:["read","write"]});
  const catalog=await handleIdentityOAuthMcp(rpc("tools/list"),readOnly.env);
  assert.equal(catalog.status,200);
  const listedRead=(await catalog.json()).result.tools;
  assert.deepEqual(listedRead.map(t=>t.name),names);
  assert.deepEqual(listedRead.find(t=>t.name==="lifespace.create.task").securitySchemes,
    [{type:"oauth2",scopes:["resources:read","resources:write"]}]);
  const denied=await handleIdentityOAuthMcp(rpc("tools/call",{headers:{
    "x-lifespace-mcp-scope-ceiling":"resources:read resources:write",
  },params:{name:"lifespace.create.task",arguments:{
    spaceId:"spc_synthetic",data:{name:"Read Scope must not mutate"},
  }}}),readOnly.env);
  assert.equal(denied.status,403);
  assert.match(denied.headers.get("www-authenticate")||"",/scope="resources:read resources:write"/u);
  assert.equal(readOnly.calls.some(c=>c.path.includes("/_operations/")&&c.path.endsWith("/invoke")),false);
  const noGrant=connectedFixture({mutations:true,environment:"production",
    oauthScopes:"resources:read resources:write",advertisedAccess:["read"]});
  const withoutGrant=await handleIdentityOAuthMcp(rpc("tools/list"),noGrant.env);
  assert.deepEqual((await withoutGrant.json()).result.tools.map(t=>t.name),["lifespace.query.task"]);
  const production = connectedFixture({ mutations: true, environment: "production", oauthScopes: "resources:read resources:write", advertisedAccess: ["read", "write"] });
  const listed = await handleIdentityOAuthMcp(rpc("tools/list"), production.env);
  assert.deepEqual((await listed.json()).result.tools.map(t => t.name), [
    "lifespace.create.task", "lifespace.delete.task", "lifespace.query.task", "lifespace.update.task",
  ]);
  for (const [status, code] of [[400, "INVALID_OPERATION_ARGUMENTS"], [403, "CORE_PERMISSION_DENIED"], [409, "RECORD_VERSION_CONFLICT"]]) {
    const f = connectedFixture({ mutations: true, environment: "staging", oauthScopes: "resources:read resources:write", advertisedAccess: ["read", "write"], mutationStatus: status });
    const r = await handleIdentityOAuthMcp(rpc("tools/call", { params: { name: "lifespace.create.task", arguments: { spaceId: "spc_synthetic", data: { name: "Synthetic only" } } } }), f.env);
    assert.equal((await r.json()).result.content[0].text, code);
  }
});
