// Disposable Staging-only PKCE + DCR + OAuth authorization-revocation E2E.
// A person approves Account Consent in their own browser; no bearer is
// copied to a chat, persisted to disk, forwarded to Core or printed.
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { stageOrigin, verifyStagingOAuthRevocation } from "./verify-staging-oauth-revocation.mjs";

const MCP_PATH = /^\/mcp\/mcp_[a-f0-9]{32}$/u;
const ACK = "REVOKE_DEDICATED_STAGING_OAUTH";
const ACCESS = /^lsp_oat_[A-Za-z0-9_-]{32,256}$/u;
const REFRESH = /^lsp_ort_[A-Za-z0-9_-]{32,256}$/u;
const CODE = /^lsp_oac_[A-Za-z0-9._~-]{32,256}$/u;
function fail(message) { throw new Error("Staging PKCE E2E: " + message); }
export function checkStagingPkceTarget(input) {
  if (input?.confirmation !== ACK) fail("explicit dedicated Staging revocation confirmation required");
  const resource = stageOrigin(input.resource);
  const issuer = stageOrigin(input.issuer);
  if (!MCP_PATH.test(resource.pathname) || resource.href !== input.resource
    || issuer.pathname !== "/" || issuer.origin !== input.issuer
    || resource.origin === issuer.origin
    || resource.hostname.split(".").slice(-2).join(".")
      !== issuer.hostname.split(".").slice(-2).join(".")) {
    fail("exact same-domain Staging MCP resource and separate issuer origin required");
  }
  return { resource: resource.href, issuer: issuer.origin,
    metadataUrl: resource.origin + "/.well-known/oauth-protected-resource" + resource.pathname };
}
async function safeFetch(fetchImpl, url, init) {
  try { return await fetchImpl(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(12000) }); }
  catch { fail("network request unavailable"); }
}
async function jsonResponse(response, requiredStatus, label) {
  if (response.status !== requiredStatus) fail(label + " returned unexpected HTTP status " + response.status);
  const data = await response.json().catch(() => null);
  if (!data || typeof data !== "object" || Array.isArray(data)) fail(label + " returned invalid JSON");
  return data;
}
function benchmarkCount(value) {
  if (value === undefined || value === "") return 0;
  if (typeof value !== "number" && (typeof value !== "string" || !/^[0-9]{1,2}$/u.test(value))) fail("invalid benchmark sample count");
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0 || count > 45) fail("benchmark sample count must be 0–45");
  return count;
}
function latencySummary(samples) {
  const sorted = [...samples].sort((a,b)=>a-b);
  const at = p => Math.round(sorted[Math.ceil(sorted.length*p)-1]);
  return {samples:sorted.length,p50Ms:at(.5),p90Ms:at(.9),maxMs:at(1)};
}
// Only an explicitly selected, current read-only Task query from Core's
// catalog. Never print the Space, data, token, schemas or request body.
async function benchmarkReadOnly(config, token, count, fetchImpl) {
  const rpc = async (method, params = {}) => {
    const start = performance.now();
    const response = await safeFetch(fetchImpl, config.resource, {
      method:"POST", headers:{authorization:"Bearer "+token,
        "content-type":"application/json",accept:"application/json, text/event-stream"},
      body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),
    });
    let payload = null;
    if (response.status === 200) payload = await response.json().catch(()=>null);
    else await response.body?.cancel().catch(()=>undefined);
    return {status:response.status,payload,ms:performance.now()-start};
  };
  const list = async () => {
    const result = await rpc("tools/list");
    if(result.status!==200||!Array.isArray(result.payload?.result?.tools))fail("benchmark tools/list failed");
    const tools=result.payload.result.tools;
    const task=tools.find(tool=>tool?.name==="lifespace.query.task");
    const space=task?.inputSchema?.properties?.spaceId?.enum;
    if(!Array.isArray(space)||space.length!==1||!/^spc_[A-Za-z0-9_-]+$/u.test(space[0]||""))
      fail("benchmark requires a currently authorized Task query in the selected test Space");
    return {ms:result.ms,space:space[0],toolCount:tools.length};
  };
  const initial=await list();
  const args=spaceId=>({name:"lifespace.query.task",arguments:{spaceId,data:{page:{limit:1}}}});
  const call=async spaceId=>{
    const result=await rpc("tools/call",args(spaceId));
    if(result.status!==200||result.payload?.error||!result.payload?.result
      ||result.payload.result.isError===true
      ||!Array.isArray(result.payload.result.content))fail("benchmark Task query failed");
    return result.ms;
  };
  await call(initial.space); // warm-up, not included in measured samples
  const lists=[],calls=[];
  for(let i=0;i<count;i++){
    const current=await list();
    if(current.space!==initial.space||current.toolCount!==initial.toolCount)fail("benchmark catalog changed during sampling");
    lists.push(current.ms);
    calls.push(await call(initial.space));
  }
  const wrongSpace="spc_benchmark_denied_"+randomBytes(16).toString("hex");
  const denied=await rpc("tools/call",args(wrongSpace));
  if(![400,403,404].includes(denied.status)
    &&!(denied.status===200&&(denied.payload?.error||denied.payload?.result?.isError===true)))
    fail("benchmark cross-Space call was not denied");
  return {evidence:{measurement:"client-end-to-end",toolCount:initial.toolCount,
    list:latencySummary(lists),call:latencySummary(calls),crossSpaceDenied:true},
    verifyRevoked:async()=>{
      const revoked=await rpc("tools/call",args(initial.space));
      if(revoked.status!==401)fail("revoked cached tool call did not return HTTP 401");
      return revoked.status;
    }};
}

export async function runStagingPkceRevocation(input, {
  fetchImpl = fetch,
  onAuthorizeUrl = url => { process.stdout.write("Open this Staging authorization URL in your browser:\n" + url + "\n"); },
  timeoutMs = 8 * 60 * 1000,
} = {}) {
  const config = checkStagingPkceTarget(input);
  const count = benchmarkCount(input.benchmarkSamples);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10 * 60 * 1000) fail("invalid timeout");
  const metadata = await jsonResponse(await safeFetch(fetchImpl, config.metadataUrl, { method: "GET" }),
    200, "MCP resource metadata");
  if (metadata.resource !== config.resource
    || !Array.isArray(metadata.authorization_servers)
    || !metadata.authorization_servers.includes(config.issuer)) {
    fail("MCP resource metadata is not bound to the selected issuer");
  }
  const as = await jsonResponse(await safeFetch(fetchImpl,
    config.issuer + "/.well-known/oauth-authorization-server", { method: "GET" }),
  200, "authorization-server metadata");
  if (as.issuer !== config.issuer
    || as.authorization_endpoint !== config.issuer + "/oauth/authorize"
    || as.token_endpoint !== config.issuer + "/oauth/token"
    || as.revocation_endpoint !== config.issuer + "/oauth/revoke"
    || as.registration_endpoint !== config.issuer + "/oauth/register"
    || !Array.isArray(as.code_challenge_methods_supported)
    || !as.code_challenge_methods_supported.includes("S256")) {
    fail("Staging DCR + PKCE S256 are not advertised by the expected issuer");
  }

  // Only local loopback; no public listening socket or account cookie handling.
  let handleCallback = (_request, response) => {
    response.writeHead(404, { "cache-control": "no-store" });
    response.end();
  };
  const server = createServer((request, response) => handleCallback(request, response));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  let timer;
  let refreshToken = null;
  let clientId = null;
  let cleaned = false;
  try {
    const callback = "http://127.0.0.1:" + server.address().port + "/oauth/callback";
    const registered = await jsonResponse(await safeFetch(fetchImpl,
      config.issuer + "/oauth/register", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          client_name: "LifeSpace Staging OAuth Acceptance",
          redirect_uris: [callback],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        }),
      }), 201, "dedicated DCR registration");
    clientId = registered.client_id;
    if (typeof clientId !== "string" || !/^ocli_[A-Za-z0-9_-]+$/u.test(clientId)
      || !Array.isArray(registered.redirect_uris) || !registered.redirect_uris.includes(callback)) {
      fail("DCR returned an invalid client or unregistered callback");
    }

    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = randomBytes(24).toString("base64url");
    const codePromise = new Promise((resolve, reject) => {
      handleCallback = (request, response) => {
        const url = new URL(request.url || "/", "http://127.0.0.1");
        if (request.method !== "GET" || url.pathname !== "/oauth/callback") {
          response.writeHead(404, { "cache-control": "no-store" });
          response.end(); return;
        }
        if (url.searchParams.get("state") !== state) {
          // Ignore unsolicited callbacks without ending the legitimate flow.
          response.writeHead(400, { "cache-control": "no-store" });
          response.end("State mismatch"); return;
        }
        if (url.searchParams.get("iss") !== config.issuer) {
          response.writeHead(400, { "cache-control": "no-store" });
          response.end("Issuer mismatch");
          reject(new Error("Staging PKCE E2E: OAuth issuer mismatch"));
          return;
        }
        const code = url.searchParams.get("code");
        if (!CODE.test(code || "")) {
          response.writeHead(400, { "cache-control": "no-store" });
          response.end("Authorization denied");
          reject(new Error("Staging PKCE E2E: approval was denied or code was invalid"));
          return;
        }
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
        response.end("Staging OAuth authorization received. You may close this browser tab.");
        resolve(code);
      };
    });
    // Avoid a pending unhandled rejection if the operator closes the script.
    codePromise.catch(() => undefined);
    const authUrl = new URL(as.authorization_endpoint);
    for (const [key, value] of Object.entries({
      response_type: "code", client_id: clientId, redirect_uri: callback,
      resource: config.resource, scope: "resources:read", state,
      code_challenge: challenge, code_challenge_method: "S256",
    })) authUrl.searchParams.set(key, value);
    await onAuthorizeUrl(authUrl.href);
    // The timer races the callback without logging auth codes or tokens.
    const code = await Promise.race([
      codePromise,
      new Promise((_resolve, reject) => {
        clearTimeout(timer);
        timer = setTimeout(() => reject(new Error("Staging PKCE E2E: browser consent timed out")), timeoutMs);
      }),
    ]);
    clearTimeout(timer);
    timer = undefined;
    const tokens = await jsonResponse(await safeFetch(fetchImpl,
      config.issuer + "/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code", client_id: clientId, code,
          redirect_uri: callback, code_verifier: verifier, resource: config.resource,
        }),
      }), 200, "PKCE token exchange");
    if (tokens.token_type !== "Bearer" || !ACCESS.test(tokens.access_token || "")
      || !REFRESH.test(tokens.refresh_token || "") || tokens.resource !== config.resource
      || typeof tokens.scope !== "string" || !tokens.scope.split(/\s+/u).includes("resources:read")) {
      fail("PKCE response lacks the expected bounded Staging bearer");
    }
    refreshToken = tokens.refresh_token;
    const benchmark=count?await benchmarkReadOnly(config,tokens.access_token,count,fetchImpl):null;
    const revoked = await verifyStagingOAuthRevocation({
      resource: config.resource, issuer: config.issuer, clientId,
      accessToken: tokens.access_token, refreshToken, mode: "authorization",
      confirmation: ACK,
    }, fetchImpl);
    cleaned = true;
    const revokedCallHttp=benchmark?await benchmark.verifyRevoked():undefined;

    const replay = await safeFetch(fetchImpl, config.issuer + "/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token", refresh_token: refreshToken,
        client_id: clientId, resource: config.resource,
      }),
    });
    if (replay.status !== 400) fail("revoked refresh token did not fail with HTTP 400");
    return { dcrRegistered: true, consentCodeExchanged: true,
      revokeAuthorizationHttp: revoked.revokeHttp,
      oldBearerHttp: revoked.afterRevokeHttp, refreshReplayHttp: replay.status,
      cachedTools: revoked.cachedTools,
      ...(benchmark?{benchmark:{...benchmark.evidence,revokedCallHttp}}:{}),
      passed: true };
  } finally {
    if (timer) clearTimeout(timer);
    // On partial failure, best-effort revoke any already issued test Authorization.
    if (refreshToken && clientId && !cleaned) {
      try {
        await safeFetch(fetchImpl, config.issuer + "/oauth/revoke", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: refreshToken, client_id: clientId }),
        });
      } catch { /* original failure wins */ }
    }
    await new Promise(resolve => server.close(resolve));
  }
}
async function main() {
  const input = {
    resource: process.env.MCP_STAGING_RESOURCE_URI,
    issuer: process.env.MCP_STAGING_OAUTH_ISSUER,
    confirmation: process.env.MCP_STAGING_REVOKE_CONFIRM,
    benchmarkSamples: process.env.MCP_STAGING_BENCHMARK_SAMPLES,
  };
  const result = await runStagingPkceRevocation(input);
  // No token, Authorization Code, user identity, record or raw HTTP body output.
  process.stdout.write(JSON.stringify(result) + "\n");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write((error instanceof Error ? error.message : "Staging PKCE E2E failed") + "\n");
    process.exitCode = 1;
  });
}
