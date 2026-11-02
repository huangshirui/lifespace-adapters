import assert from "node:assert/strict";
import test from "node:test";
import { handleMcpRequest } from "../src/worker.mjs";

const SECRET = "synthetic-probe-key-not-for-live-use-000000000000";
const baseEnv = Object.freeze({
  MCP_OAUTH_PROBE_ENABLED: "true",
  MCP_OAUTH_PROBE_KEY: SECRET,
  IDENTITY_BASE_URL: "https://identity.example.com",
  CORE_BASE_URL: "https://core.example.com",
  LIFESPACE_APPLICATION_CREDENTIAL: "lsa_synthetic-probe-only",
  MCP_MODEL_KEYS: "task",
});

function syntheticAssertion(claims) {
  // The fake Identity backend below stands in for JWT verification. This is
  // NOT a signed token, and tests do not claim that client_id is authenticated
  // by Cloudflare or identifies an official product.
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  return [encode({ alg: "RS256", typ: "JWT" }), encode({
    iss: "https://access.example.com", sub: "synthetic-user", aud: "synthetic-access",
    ...claims,
  }), "synthetic-signature"].join(".");
}

function request(assertion, path = "/mcp/calendar/conn_alpha/__oauth_probe", headers = {}) {
  return new Request("https://mcp.example.com" + path, {
    method: "POST",
    headers: { ...(assertion ? { "cf-access-jwt-assertion": assertion } : {}), ...headers },
  });
}

function fakeIdentity(status = 200) {
  const requests = [];
  const fetcher = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url: url.href, method: init.method, body: init.body });
    assert.equal(url.host, "identity.example.com", "diagnostic MUST NOT call Core");
    assert.equal(url.pathname, "/internal/v1/access/tokens");
    return Response.json(status === 200
      ? { data: { accessToken: "synthetic-token-not-real", tokenType: "Bearer", scope: "resources:read" } }
      : { error: "synthetic denied" }, { status });
  };
  return { fetcher, requests };
}

test("probe is disabled by default and never exchanges tokens", async () => {
  const backend = fakeIdentity();
  const response = await handleMcpRequest(
    request(syntheticAssertion({ client_id: "synthetic-client-A" })),
    { ...baseEnv, MCP_OAUTH_PROBE_ENABLED: undefined },
    backend.fetcher,
  );
  assert.equal(response.status, 404);
  assert.equal(backend.requests.length, 0);
});

test("probe requires its own secret config and exact path", async () => {
  const backend = fakeIdentity();
  const enabledWithoutKey = await handleMcpRequest(request(syntheticAssertion({})), {
    ...baseEnv, MCP_OAUTH_PROBE_KEY: "",
  }, backend.fetcher);
  assert.equal(enabledWithoutKey.status, 404);
  for (const wrongPath of [
    "/mcp/calendar/no-connection/__oauth_probe",
    "/mcp/calendar/conn_alpha/not-probe",
    "/mcp/calendar/conn_alpha/__oauth_probe/anything",
  ]) {
    const res = await handleMcpRequest(request(syntheticAssertion({}), wrongPath), baseEnv, backend.fetcher);
    assert.equal(res.status, 404);
  }
  assert.equal(backend.requests.length, 0);
});

test("only Identity-accepted Access assertion can show redacted claim presence", async () => {
  const assertion = syntheticAssertion({ client_id: "synthetic-client-A", azp: "synthetic-authorized-party" });
  const backend = fakeIdentity();
  const response = await handleMcpRequest(request(assertion), baseEnv, backend.fetcher);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.signedAssertionAcceptedByIdentity, true);
  assert.equal(body.claimPresence.client_id.present, true);
  assert.equal(body.claimPresence.oauth_client_id.present, false);
  assert.equal(body.claimPresence.azp.present, true);
  assert.match(body.claimPresence.client_id.fingerprint, /^[a-f0-9]{24}$/u);
  const raw = JSON.stringify(body);
  for (const forbidden of [assertion, "synthetic-client-A", "synthetic-user", "synthetic-token-not-real"]) {
    assert(!raw.includes(forbidden), "diagnostic must not reveal raw identity or token values");
  }
  assert.equal(backend.requests.length, 1);
});

test("same claimed client is stable, a different claimed client yields a different fingerprint", async () => {
  const backend = fakeIdentity();
  async function fp(clientId, path = "/mcp/calendar/conn_alpha/__oauth_probe") {
    const response = await handleMcpRequest(request(syntheticAssertion({ client_id: clientId }), path),
      baseEnv, backend.fetcher);
    assert.equal(response.status, 200);
    return (await response.json()).claimPresence.client_id.fingerprint;
  }
  const first = await fp("synthetic-client-A");
  assert.equal(await fp("synthetic-client-A"), first);
  assert.notEqual(await fp("synthetic-client-B"), first);
  // This is a *negative security finding* for the mock only: route and JWT
  // alone do not bind an OAuth token to a particular resource. Staging must
  // test that Cloudflare rejects cross-path replay before release.
  assert.equal(await fp("synthetic-client-A", "/mcp/tasks/conn_beta/__oauth_probe"), first);
});

test("missing Access or denied Identity never returns probe data", async () => {
  const backend = fakeIdentity();
  const noAssertion = await handleMcpRequest(request(null), baseEnv, backend.fetcher);
  assert.equal(noAssertion.status, 401);
  assert.equal(backend.requests.length, 0);

  const denied = fakeIdentity(403);
  const response = await handleMcpRequest(request(syntheticAssertion({ client_id: "synthetic-client-A" })),
    baseEnv, denied.fetcher);
  assert.equal(response.status, 403);
  assert(!JSON.stringify(await response.json()).includes("client_id"));
  assert.equal(denied.requests.length, 1);
});

test("untrusted caller headers never provide client identity or bypass exact Origin guard", async () => {
  const backend = fakeIdentity();
  const response = await handleMcpRequest(request(syntheticAssertion({}), undefined, {
    "x-oauth-client-id": "untrusted-client-spoof",
  }), baseEnv, backend.fetcher);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).claimPresence.client_id.present, false);
  const blocked = await handleMcpRequest(request(syntheticAssertion({}), undefined, {
    origin: "https://untrusted.example.com",
  }), baseEnv, backend.fetcher);
  assert.equal(blocked.status, 403);
});
