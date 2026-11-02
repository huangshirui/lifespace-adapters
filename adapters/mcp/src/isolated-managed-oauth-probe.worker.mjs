// Synthetic, isolated Cloudflare Managed OAuth transport probe.
// This is NOT a LifeSpace MCP execution endpoint and NEVER reads user data.
// Deploy only behind a dedicated Access Preview policy on a disposable Worker.
const PATH = /^\/mcp\/(?:calendar|tasks)\/conn_(?:alpha|beta)\/__oauth_probe$/u;
const CLAIMS = ["client_id", "oauth_client_id", "azp", "grant_id", "authorization_id"];

function response(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function assertionClaims(assertion) {
  if (typeof assertion !== "string" || assertion.length < 32 || assertion.length > 32768) return null;
  const parts = assertion.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/gu, "+").replace(/_/gu, "/");
    const decoded = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(b64), char => char.charCodeAt(0)),
    ));
    return decoded && typeof decoded === "object" && !Array.isArray(decoded) ? decoded : null;
  } catch { return null; }
}

async function keyedFingerprint(key, field, value) {
  if (typeof key !== "string" || key.length < 32 || typeof value !== "string" ||
      value.length === 0 || value.length > 1024) return null;
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey("raw", encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(field + ":" + value));
  return [...new Uint8Array(signed)].slice(0, 12).map(x => x.toString(16).padStart(2, "0")).join("");
}

export async function handle(request, env) {
  if (env?.OAUTH_PROBE_ENABLED !== "true" ||
      typeof env?.OAUTH_PROBE_KEY !== "string" || env.OAUTH_PROBE_KEY.length < 32)
    return response(404, { error: "Not found" });

  const url = new URL(request.url);
  if (!PATH.test(url.pathname)) return response(404, { error: "Not found" });
  if (request.method !== "POST") return response(405, { error: "Method not allowed" });

  // Protected Preview must be validated by Cloudflare Access *before*
  // forwarding the assertion. Raw header parsing is NOT cryptographic JWT
  // validation and must never be used as permission proof.
  const claims = assertionClaims(request.headers.get("cf-access-jwt-assertion"));
  if (!claims) return response(401, { error: "Cloudflare Access required" });
  if (typeof env.OAUTH_ACCESS_AUD !== "string" || env.OAUTH_ACCESS_AUD.length < 8 ||
      ![].concat(claims.aud ?? []).includes(env.OAUTH_ACCESS_AUD))
    return response(403, { error: "Unexpected Access audience" });

  const fields = {};
  for (const name of CLAIMS) {
    fields[name] = {
      present: typeof claims[name] === "string" && claims[name].length > 0,
      fingerprint: await keyedFingerprint(env.OAUTH_PROBE_KEY, name, claims[name]),
    };
  }
  return response(200, {
    syntheticDiagnostic: true,
    resourcePath: url.pathname,
    fields,
    warning: "A URL is not permission proof. Claim decoding is not signature validation. Production must verify token-to-Connection binding.",
  });
}

export default { fetch: handle };
