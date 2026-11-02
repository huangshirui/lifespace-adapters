// Opt-in, Staging-only diagnostic for Cloudflare Managed OAuth transport.
// This module is not a LifeSpace capability, a credential validator, or a
// source of client identity. It MUST NOT be enabled for business runtime.
const PATH = /^\/mcp\/[a-z][a-z0-9_-]{0,63}\/conn_[A-Za-z0-9_-]+\/__oauth_probe$/u;
const CLAIM_NAMES = ["client_id", "oauth_client_id", "azp", "grant_id", "authorization_id"];

function noStoreJson(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function matchesStagingOAuthProbe(pathname) {
  return PATH.test(pathname);
}

function verifiedClaimPresence(assertion) {
  // Identity must have *already* successfully exchanged this same exact
  // assertion, validating its issuer, signature, audience and expiration.
  // Decoding alone is NEVER authentication evidence.
  const parts = assertion.split(".");
  if (parts.length !== 3) return {};
  try {
    const encoded = parts[1].replace(/-/gu, "+").replace(/_/gu, "/");
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  } catch {
    return {};
  }
}

async function fingerprint(secret, key, value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 1024) return null;
  const encoder = new TextEncoder();
  const signingKey = await crypto.subtle.importKey("raw", encoder.encode(secret), {
    name: "HMAC", hash: "SHA-256",
  }, false, ["sign"]);
  const hash = await crypto.subtle.sign("HMAC", signingKey, encoder.encode(key + ":" + value));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

export async function handleStagingOAuthProbe(request, env, exchangeAssertion) {
  // Guard in the handler itself; the caller also routes by exact path.
  if (env.MCP_OAUTH_PROBE_ENABLED !== "true" ||
      typeof env.MCP_OAUTH_PROBE_KEY !== "string" ||
      env.MCP_OAUTH_PROBE_KEY.length < 32) {
    return noStoreJson({ error: "Not found" }, 404);
  }
  if (!matchesStagingOAuthProbe(new URL(request.url).pathname)) {
    return noStoreJson({ error: "Not found" }, 404);
  }
  if (request.method !== "POST") return noStoreJson({ error: "Method not allowed" }, 405);
  const assertion = request.headers.get("cf-access-jwt-assertion");
  if (!assertion || assertion.length < 32 || assertion.length > 32768) {
    return noStoreJson({ error: "Access authentication required" }, 401);
  }

  // The existing Identity path must independently validate the Access JWT.
  let verified;
  try { verified = await exchangeAssertion(assertion); }
  catch { return noStoreJson({ error: "Identity unavailable" }, 503); }
  if (verified.error) return noStoreJson({ error: "Identity denied" }, verified.status ?? 403);

  const claims = verifiedClaimPresence(assertion);
  const fields = {};
  for (const name of CLAIM_NAMES) {
    fields[name] = {
      present: typeof claims[name] === "string" && claims[name].length > 0,
      fingerprint: await fingerprint(env.MCP_OAUTH_PROBE_KEY, name, claims[name]),
    };
  }
  return noStoreJson({
    diagnostic: "managed-oauth-staging-probe",
    // No raw claim values, tokens, user IDs, credentials or backend data.
    signedAssertionAcceptedByIdentity: true,
    claimPresence: fields,
    limitations: "Claim presence is not vendor verification. Probe success does not prove path-specific OAuth resource isolation.",
  }, 200);
}
