import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  checkStagingPkceTarget, runStagingPkceRevocation,
} from "../scripts/verify-staging-oauth-pkce.mjs";

const resource = "https://resource-staging.example.test/mcp/mcp_" + "a".repeat(32);
const issuer = "https://identity-staging.example.test";
const accessToken = "lsp_oat_" + "A".repeat(43);
const refreshToken = "lsp_ort_" + "B".repeat(43);
const code = "lsp_oac_" + "C".repeat(43);
const config = { resource, issuer, confirmation: "REVOKE_DEDICATED_STAGING_OAUTH" };

function fakeIssuer({ dcr = true, benchmark = false, queryFails = false } = {}) {
  let active = true;
  const calls = [];
  let redirect = "";
  return {
    calls,
    fetch: async (url, init = {}) => {
      const path = new URL(url).pathname;
      calls.push({ path, method: init.method || "GET" });
      if (path === "/.well-known/oauth-protected-resource/mcp/mcp_" + "a".repeat(32)) {
        return Response.json({ resource, authorization_servers: [issuer] });
      }
      if (path === "/.well-known/oauth-authorization-server") {
        return Response.json({
          issuer, authorization_endpoint: issuer + "/oauth/authorize",
          token_endpoint: issuer + "/oauth/token",
          revocation_endpoint: issuer + "/oauth/revoke",
          ...(dcr ? { registration_endpoint: issuer + "/oauth/register" } : {}),
          code_challenge_methods_supported: ["S256"],
        });
      }
      if (path === "/oauth/register") {
        assert.equal(init.method, "POST");
        const body = JSON.parse(init.body);
        assert.deepEqual(body.grant_types, ["authorization_code", "refresh_token"]);
        assert.equal(body.redirect_uris.length, 1);
        assert.match(body.redirect_uris[0], /^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/u);
        redirect = body.redirect_uris[0];
        return Response.json({
          client_id: "ocli_synthetic", redirect_uris: [redirect],
          token_endpoint_auth_method: "none",
        }, { status: 201 });
      }
      if (path === "/oauth/token") {
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("client_id"), "ocli_synthetic");
        if (body.get("grant_type") === "refresh_token") {
          assert.equal(active, false);
          assert.equal(body.get("refresh_token"), refreshToken);
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }
        assert.equal(body.get("grant_type"), "authorization_code");
        assert.equal(body.get("code"), code);
        assert.equal(body.get("redirect_uri"), redirect);
        assert.match(body.get("code_verifier"), /^[A-Za-z0-9_-]{43,128}$/u);
        return Response.json({
          token_type: "Bearer", access_token: accessToken, refresh_token: refreshToken,
          scope: "resources:read", resource,
        });
      }
      if (path === "/oauth/revoke") {
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("token"), refreshToken);
        assert.equal(body.get("client_id"), "ocli_synthetic");
        active = false;
        return new Response(null, { status: 200 });
      }
      if (path.startsWith("/mcp/mcp_")) {
        assert.equal(init.headers.authorization, "Bearer " + accessToken);
        const body=JSON.parse(init.body);
        if(!active)return Response.json({error:"synthetic invalid token"},{status:401});
        if(body.method==="tools/call"){
          assert.ok(benchmark);
          assert.equal(body.params.name,"lifespace.query.task");
          assert.deepEqual(body.params.arguments.data,{page:{limit:1}});
          const allowed=body.params.arguments.spaceId==="spc_synthetic";
          return Response.json({jsonrpc:"2.0",id:1,result:allowed&&!queryFails
            ?{content:[{type:"text",text:"Synthetic private fixture result"}],structuredContent:{items:[]}}
            :{isError:true,content:[{type:"text",text:"Denied"}]}});
        }
        assert.equal(body.method,"tools/list");
        return Response.json({jsonrpc:"2.0",id:1,result:{tools:[{name:"lifespace.query.task",
          ...(benchmark?{inputSchema:{properties:{spaceId:{enum:["spc_synthetic"]}}}}:{})}]}});
      }
      throw new Error("Unexpected synthetic request");
    },
  };
}

test("complete synthetic DCR → loopback PKCE → MCP list → revoke authorization → stale bearer denied", async () => {
  const server = fakeIssuer();
  let browserRequests = 0;
  const result = await runStagingPkceRevocation(config, {
    fetchImpl: server.fetch, timeoutMs: 3000,
    onAuthorizeUrl: async authorize => {
      browserRequests++;
      const auth = new URL(authorize);
      assert.equal(auth.origin, issuer);
      assert.equal(auth.pathname, "/oauth/authorize");
      assert.equal(auth.searchParams.get("scope"), "resources:read");
      assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
      assert.equal(auth.searchParams.get("resource"), resource);
      const verifierChallenge = auth.searchParams.get("code_challenge");
      assert.match(verifierChallenge, /^[A-Za-z0-9_-]{43}$/u);
      const callback = new URL(auth.searchParams.get("redirect_uri"));
      callback.searchParams.set("code", code);
      callback.searchParams.set("state", auth.searchParams.get("state"));
      callback.searchParams.set("iss", issuer);
      const response = await fetch(callback);
      assert.equal(response.status, 200);
      assert.equal((await response.text()).includes(code), false);
    },
  });
  assert.equal(browserRequests, 1);
  assert.deepEqual(result, {
    dcrRegistered: true, consentCodeExchanged: true,
    revokeAuthorizationHttp: 200, oldBearerHttp: 401,
    refreshReplayHttp: 400, cachedTools: 1, passed: true,
  });
  assert.deepEqual(server.calls.map(x => x.path), [
    "/.well-known/oauth-protected-resource/mcp/mcp_" + "a".repeat(32),
    "/.well-known/oauth-authorization-server",
    "/oauth/register",
    "/oauth/token",
    "/.well-known/oauth-protected-resource/mcp/mcp_" + "a".repeat(32),
    "/mcp/mcp_" + "a".repeat(32),
    "/oauth/revoke",
    "/mcp/mcp_" + "a".repeat(32),
    "/oauth/token",
  ]);
  assert.equal(JSON.stringify(result).includes(accessToken), false);
  assert.equal(JSON.stringify(result).includes(refreshToken), false);
});

test("fails closed for production hosts, bad resource and missing confirmation", () => {
  for (const diff of [
    { resource: "https://resource.example.test/mcp/mcp_" + "a".repeat(32) },
    { issuer: "https://identity.example.test" },
    { issuer: issuer + "/oauth" },
    { resource: resource + "/unexpected" },
    { confirmation: "" },
    { resource: "http://resource-staging.example.test/mcp/mcp_" + "a".repeat(32) },
  ]) {
    assert.throws(() => checkStagingPkceTarget({ ...config, ...diff }), /Staging/u);
  }
});

test("never registers a client when the Staging issuer does not advertise DCR", async () => {
  const server = fakeIssuer({ dcr: false });
  await assert.rejects(runStagingPkceRevocation(config, {
    fetchImpl: server.fetch, timeoutMs: 500,
    onAuthorizeUrl: () => { throw new Error("Should never open browser"); },
  }), /Staging PKCE E2E/u);
  assert.equal(server.calls.some(call => call.path === "/oauth/register"), false);
});

async function approveSynthetic(authorize) {
  const auth=new URL(authorize),callback=new URL(auth.searchParams.get("redirect_uri"));
  callback.searchParams.set("code",code);
  callback.searchParams.set("state",auth.searchParams.get("state"));
  callback.searchParams.set("iss",issuer);
  assert.equal((await fetch(callback)).status,200);
}
test("measures real protocol requests with bounded read-only benchmark, cross-Space denial and revoked cached call",async()=>{
  const server=fakeIssuer({benchmark:true});
  const result=await runStagingPkceRevocation({...config,benchmarkSamples:3},{
    fetchImpl:server.fetch,timeoutMs:3000,onAuthorizeUrl:approveSynthetic,
  });
  assert.equal(result.benchmark.measurement,"client-end-to-end");
  assert.equal(result.benchmark.toolCount,1);
  for(const item of [result.benchmark.list,result.benchmark.call]){
    assert.equal(item.samples,3);
    assert.ok(item.p50Ms<=item.p90Ms&&item.p90Ms<=item.maxMs);
  }
  assert.equal(result.benchmark.crossSpaceDenied,true);
  assert.equal(result.benchmark.revokedCallHttp,401);
  assert.doesNotMatch(JSON.stringify(result),/spc_synthetic|Synthetic private fixture result|lsp_oat_|lsp_ort_/u);
});
test("benchmark failure revokes the disposable Authorization",async()=>{
  const server=fakeIssuer({benchmark:true,queryFails:true});
  await assert.rejects(runStagingPkceRevocation({...config,benchmarkSamples:3},{
    fetchImpl:server.fetch,timeoutMs:3000,onAuthorizeUrl:approveSynthetic,
  }),/benchmark Task query failed/u);
  assert.equal(server.calls.filter(call=>call.path==="/oauth/revoke").length,1);
});
test("invalid benchmark count fails before registration",async()=>{
  const server=fakeIssuer();
  await assert.rejects(runStagingPkceRevocation({...config,benchmarkSamples:46},{
    fetchImpl:server.fetch,timeoutMs:3000,onAuthorizeUrl:approveSynthetic,
  }),/benchmark sample count/u);
  assert.equal(server.calls.length,0);
});
