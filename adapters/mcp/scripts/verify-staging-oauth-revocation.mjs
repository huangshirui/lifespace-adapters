// Dedicated Staging-only OAuth revocation smoke test.
// This never accepts a production hostname, prints token values or edits D1.
// Run only with a throwaway OAuth Client/Authorization.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const CONFIRM = "REVOKE_DEDICATED_STAGING_OAUTH";
const ACCESS = /^lsp_oat_[A-Za-z0-9_-]{32,256}$/u;
const REFRESH = /^lsp_ort_[A-Za-z0-9_-]{32,256}$/u;
const MCP_RESOURCE = /^\/mcp\/mcp_[a-f0-9]{32}$/u;

function fail(message) { throw new Error("Staging OAuth smoke: " + message); }
export function stageOrigin(raw) {
  let url;
  try { url = new URL(raw); } catch { fail("invalid staging URL"); }
  if (url.protocol !== "https:" || !/^[a-z0-9-]+-staging\.[a-z0-9.-]+$/u.test(url.hostname)
    || url.username || url.password || url.search || url.hash || url.port) {
    fail("requires an exact HTTPS *-staging hostname, without credentials, query or port");
  }
  return url;
}
export function checkSmokeConfig(input) {
  if (input?.confirmation !== CONFIRM) fail("explicit dedicated-test-token confirmation is required");
  const resource = stageOrigin(input.resource);
  const issuer = stageOrigin(input.issuer);
  if (issuer.pathname !== "/" || resource.pathname === "/" || !MCP_RESOURCE.test(resource.pathname)) {
    fail("issuer must be an origin and resource must be an exact /mcp/mcp_* URI");
  }
  if (resource.origin === issuer.origin) fail("resource and issuer must be separate Staging origins");
  if (typeof input.clientId !== "string" || !input.clientId || input.clientId.length > 256) {
    fail("dedicated OAuth Client ID required");
  }
  if (!ACCESS.test(input.accessToken || "")) fail("dedicated OAuth access token required");
  if (!["access-token", "authorization"].includes(input.mode)) fail("revocation mode required");
  if (input.mode === "authorization" && !REFRESH.test(input.refreshToken || "")) {
    fail("authorization revocation requires the dedicated OAuth refresh token");
  }
  return {
    resource: resource.href, issuer: issuer.origin, clientId: input.clientId,
    accessToken: input.accessToken,
    revokeToken: input.mode === "authorization" ? input.refreshToken : input.accessToken,
    mode: input.mode, metadata: resource.origin
      + "/.well-known/oauth-protected-resource" + resource.pathname,
  };
}

async function request(fetchImpl, url, init) {
  try { return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(12000) }); }
  catch { fail("network request unavailable"); }
}
function toolRequest(token, method) {
  return {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {} }),
  };
}
export async function verifyStagingOAuthRevocation(input, fetchImpl = fetch) {
  const config = checkSmokeConfig(input);
  // Verify the exact Resource → Issuer relationship before any irreversible action.
  const metadata = await request(fetchImpl, config.metadata, { method: "GET" });
  if (metadata.status !== 200) fail("Resource metadata unavailable");
  const document = await metadata.json().catch(() => null);
  if (document?.resource !== config.resource
    || !Array.isArray(document.authorization_servers)
    || !document.authorization_servers.includes(config.issuer)) {
    fail("Resource metadata does not match requested issuer and Resource");
  }

  const before = await request(fetchImpl, config.resource, toolRequest(config.accessToken, "tools/list"));
  if (before.status !== 200) fail("baseline authorized tools/list did not return HTTP 200");
  const baseline = await before.json().catch(() => null);
  if (!Array.isArray(baseline?.result?.tools) || !baseline.result.tools.length) {
    fail("baseline contains no authorized test tools; no token was revoked");
  }

  // A dedicated test token, never ChatGPT's existing connection.
  const revoked = await request(fetchImpl, config.issuer + "/oauth/revoke", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: config.revokeToken, client_id: config.clientId }),
  });
  if (revoked.status !== 200) fail("standard OAuth revoke endpoint rejected the request");

  // Reuse the same public OAuth bearer and cached tool knowledge, without refresh.
  const after = await request(fetchImpl, config.resource, toolRequest(config.accessToken, "tools/list"));
  if (after.status !== 401) fail("revoked OAuth token was not rejected immediately");
  return { baselineHttp: before.status, revokeHttp: revoked.status,
    afterRevokeHttp: after.status, cachedTools: baseline.result.tools.length,
    mode: config.mode, passed: true };
}

function tokenFromFile(file, label) {
  if (typeof file !== "string" || !file.trim()) fail(label + " token file path required");
  let value;
  try { value = readFileSync(file, "utf8").trim(); }
  catch { fail(label + " token file cannot be read"); }
  return value;
}
async function main() {
  const e = process.env;
  const config = {
    resource: e.MCP_STAGING_RESOURCE_URI, issuer: e.MCP_STAGING_OAUTH_ISSUER,
    clientId: e.MCP_STAGING_CLIENT_ID, mode: e.MCP_STAGING_REVOKE_MODE,
    confirmation: e.MCP_STAGING_REVOKE_CONFIRM,
    accessToken: tokenFromFile(e.MCP_STAGING_ACCESS_TOKEN_FILE, "access"),
    ...(e.MCP_STAGING_REVOKE_MODE === "authorization"
      ? { refreshToken: tokenFromFile(e.MCP_STAGING_REFRESH_TOKEN_FILE, "refresh") } : {}),
  };
  const result = await verifyStagingOAuthRevocation(config);
  // Status codes and count only. Never print responses, Authorization or credentials.
  process.stdout.write(JSON.stringify(result) + "\n");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write((error instanceof Error ? error.message : "Staging OAuth smoke failed") + "\n");
    process.exitCode = 1;
  });
}
