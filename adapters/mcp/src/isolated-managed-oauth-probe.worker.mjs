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

// A minimal, synthetic-only Streamable HTTP MCP surface lets ChatGPT/Claude
// finish their real OAuth handshake and invoke a no-data diagnostic tool.
const MCP_PATH = /^\/mcp\/(?:calendar|tasks)\/conn_(?:alpha|beta)$/u;
const TOOL = "inspect_managed_oauth_context";

async function mcp(request, env) {
  const url = new URL(request.url);
  if (!MCP_PATH.test(url.pathname)) return response(404, { error: "Not found" });
  if (env?.OAUTH_PROBE_ENABLED !== "true") return response(404, { error: "Not found" });
  if (request.method === "GET") return response(405, { error: "Only POST is supported" });
  if (request.method !== "POST") return response(405, { error: "Method not allowed" });
  const origin = request.headers.get("origin");
  if (origin && !["https://chatgpt.com", "https://claude.ai", "https://claude.com"].includes(origin))
    return response(403, { error: "Origin not allowed" });
  const assertion = assertionClaims(request.headers.get("cf-access-jwt-assertion"));
  if (!assertion) return response(401, { error: "Cloudflare Access required" });
  if (typeof env.OAUTH_ACCESS_AUD !== "string" || ![].concat(assertion.aud ?? []).includes(env.OAUTH_ACCESS_AUD))
    return response(403, { error: "Unexpected Access audience" });

  const raw = await request.text();
  if (raw.length > 16000) return response(413, { error: "Oversized test request" });
  let input;
  try { input = JSON.parse(raw); } catch { return response(400, { error: "Malformed JSON" }); }
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      input.jsonrpc !== "2.0" || typeof input.method !== "string")
    return response(400, { error: "Invalid JSON RPC request" });
  if (input.method === "notifications/initialized") return new Response(null, { status: 202 });
  if (typeof input.id !== "string" && typeof input.id !== "number")
    return response(400, { error: "Invalid JSON RPC ID" });

  let result;
  switch (input.method) {
    case "initialize":
      result = { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "isolated-oauth-transport-probe", version: "0.0.1" } };
      break;
    case "ping":
      result = {};
      break;
    case "tools/list":
      result = { tools: [{ name: TOOL,
        title: "Inspect Cloudflare Managed OAuth transport (synthetic)",
        description: "Reports only opaque claim presence/fingerprints and synthetic Connection path. No LifeSpace data or action.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false } }] };
      break;
    case "tools/call": {
      if (input.params?.name !== TOOL ||
          !input.params?.arguments || Object.keys(input.params.arguments).length !== 0) {
        return response(200, { jsonrpc: "2.0", id: input.id,
          error: { code: -32602, message: "Unknown diagnostic tool or arguments" } });
      }
      const testRequest = new Request(url.href + "/__oauth_probe", {
        method: "POST", headers: { "cf-access-jwt-assertion": request.headers.get("cf-access-jwt-assertion") ?? "" },
      });
      const probe = await handle(testRequest, env);
      if (probe.status !== 200) return response(probe.status, { error: "Access probe denied" });
      result = { content: [{ type: "text", text: JSON.stringify(await probe.json()) }], isError: false };
      break;
    }
    default:
      return response(200, { jsonrpc: "2.0", id: input.id,
        error: { code: -32601, message: "Unsupported synthetic MCP method" } });
  }
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: input.id, result }), {
    status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export default { fetch(request, env) {
  return MCP_PATH.test(new URL(request.url).pathname) ? mcp(request, env) : handle(request, env);
} };

