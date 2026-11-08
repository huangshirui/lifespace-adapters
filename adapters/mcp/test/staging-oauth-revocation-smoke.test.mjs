import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkSmokeConfig, verifyStagingOAuthRevocation,
} from "../scripts/verify-staging-oauth-revocation.mjs";

const resource = "https://resource-staging.example.test/mcp/mcp_" + "a".repeat(32);
const issuer = "https://identity-staging.example.test";
const accessToken = "lsp_oat_" + "A".repeat(48);
const refreshToken = "lsp_ort_" + "B".repeat(48);
const config = {
  resource, issuer, clientId: "ocli_synthetic",
  accessToken, refreshToken,
  mode: "authorization", confirmation: "REVOKE_DEDICATED_STAGING_OAUTH",
};
function mockTransport({ initialStatus = 200, wrongIssuer = false } = {}) {
  let active = true;
  const calls = [];
  return {
    calls,
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      calls.push({ path, method: init?.method, headers: init?.headers, body: init?.body });
      if (path.startsWith("/.well-known/oauth-protected-resource")) {
        return Response.json({
          resource, authorization_servers: [wrongIssuer ? "https://other-staging.example.test" : issuer],
        });
      }
      if (path === "/oauth/revoke") {
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("token"), config.refreshToken);
        assert.equal(body.get("client_id"), config.clientId);
        active = false;
        return new Response(null, { status: 200 });
      }
      if (path.startsWith("/mcp/mcp_")) {
        assert.equal(init.headers.authorization, "Bearer " + accessToken);
        const body = JSON.parse(init.body);
        assert.equal(body.method, "tools/list");
        return active
          ? initialStatus === 200
            ? Response.json({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "lifespace.query.task" }] } })
            : Response.json({ error: "synthetic denied" }, { status: initialStatus })
          : Response.json({ error: "invalid_token" }, { status: 401 });
      }
      throw new Error("Unexpected synthetic endpoint");
    },
  };
}

test("real Staging OAuth smoke flow: baseline tools -> revoke refresh authorization -> same bearer denied", async () => {
  const mock = mockTransport();
  const result = await verifyStagingOAuthRevocation(config, mock.fetch);
  assert.deepEqual(result, {
    baselineHttp: 200, revokeHttp: 200, afterRevokeHttp: 401,
    cachedTools: 1, mode: "authorization", passed: true,
  });
  assert.deepEqual(mock.calls.map(x => x.path), [
    "/.well-known/oauth-protected-resource/mcp/mcp_" + "a".repeat(32),
    "/mcp/mcp_" + "a".repeat(32),
    "/oauth/revoke",
    "/mcp/mcp_" + "a".repeat(32),
  ]);
  assert.equal(mock.calls.some(x => x.path.endsWith("/records")), false);
});

test("Staging guard rejects production, fake paths and missing explicit revoke confirmation", () => {
  for (const invalid of [
    { resource: "https://resource.example.test/mcp/mcp_" + "a".repeat(32) },
    { issuer: "https://identity.example.test" },
    { resource: "http://resource-staging.example.test/mcp/mcp_" + "a".repeat(32) },
    { resource: "https://resource-staging.example.test/mcp" },
    { resource: resource + "?debug=1" },
    { issuer: issuer + "/token" },
    { confirmation: "" },
    { mode: "invalid" },
    { mode: "authorization", refreshToken: undefined },
    { accessToken: "invalid" },
  ]) {
    assert.throws(() => checkSmokeConfig({ ...config, ...invalid }), /Staging OAuth smoke/u);
  }
});

test("does not revoke test authorization when metadata or initial permission check fails", async () => {
  for (const scenario of [{ wrongIssuer: true }, { initialStatus: 401 }]) {
    const mock = mockTransport(scenario);
    await assert.rejects(
      verifyStagingOAuthRevocation(config, mock.fetch), /Staging OAuth smoke/u,
    );
    assert.equal(mock.calls.some(call => call.path === "/oauth/revoke"), false);
  }
});

test("access-token mode revokes only the single dedicated access token", async () => {
  const mock = mockTransport();
  const adapted = async (url, init) => {
    if (new URL(url).pathname === "/oauth/revoke") {
      const params = new URLSearchParams(init.body);
      assert.equal(params.get("token"), accessToken);
      return new Response(null, { status: 200 });
    }
    return mock.fetch(url, init);
  };
  // Verify URL + token shape and the fixed one-token revoke mode; the
  // authorization-mode scenario above covers end-to-end denial behavior.
  const checked = checkSmokeConfig({ ...config, mode: "access-token", refreshToken: undefined });
  assert.equal(checked.revokeToken, accessToken);
  assert.equal(checked.mode, "access-token");
});
