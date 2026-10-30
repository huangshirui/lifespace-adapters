import { loadSelectedModelSemantics } from "./progressive-discovery.mjs";
import { buildLifeSpaceQueryRequest, projectSelectedModelsToMcp } from "./projection.mjs";

// MVP: Cloudflare Access Managed OAuth is the OAuth Authorization Server.
// This Worker is only an MCP Resource Server. Identity independently verifies
// the original Access assertion and issues a short-lived, read-only User token.
const MCP_PATH = "/mcp";
const MCP_VERSION = "2025-06-18";
const READ_SCOPES = ["resources:read"];
const MAX_BODY_BYTES = 65536;
const MAX_RESULT_BYTES = 131072;

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function rpcResult(id, result) {
  return json({ jsonrpc: "2.0", id, result });
}

function rpcError(id, code, message, status = 200) {
  return json({ jsonrpc: "2.0", id, error: { code, message } }, status);
}

function reject(status, message) {
  return json({ error: message }, status);
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allow = String(env.MCP_ALLOWED_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean);
  return origin === new URL(request.url).origin || allow.includes(origin);
}

function selectedModelKeys(env) {
  const keys = String(env.MCP_MODEL_KEYS || "").split(",").map(x => x.trim()).filter(Boolean);
  if (keys.length < 1 || keys.length > 16 || keys.some(key => !/^[a-z][a-z0-9_-]{0,63}$/u.test(key))) {
    throw new Error("Invalid MCP model selection configuration");
  }
  return [...new Set(keys)];
}

function upstreamUrl(base, path) {
  if (typeof base !== "string" || !/^https:\/\//u.test(base)) throw new Error("Invalid upstream configuration");
  const url = new URL(path, base);
  if (url.origin !== new URL(base).origin) throw new Error("Upstream origin changed");
  return url;
}

async function internalFetch(env, kind, path, options, fetcher) {
  const binding = env[kind];
  if (binding && typeof binding.fetch === "function") {
    // Service Bindings are preferred: no public origin or Access browser policy involved.
    return binding.fetch("https://internal.example.com" + path, options);
  }
  const base = kind === "IDENTITY" ? env.IDENTITY_BASE_URL : env.CORE_BASE_URL;
  return fetcher(upstreamUrl(base, path), options);
}

async function exchangeUserToken(assertion, env, fetcher) {
  if (!env.LIFESPACE_APPLICATION_CREDENTIAL || !String(env.LIFESPACE_APPLICATION_CREDENTIAL).startsWith("lsa_")) {
    throw new Error("MCP trusted application credential is not configured");
  }
  const response = await internalFetch(env, "IDENTITY", "/internal/v1/access/tokens", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": "Bearer " + env.LIFESPACE_APPLICATION_CREDENTIAL,
    },
    body: JSON.stringify({ accessAssertion: assertion, requestedScopes: READ_SCOPES }),
  }, fetcher);
  if (!response.ok) {
    // Never expose provider error details, raw assertions, identifiers or credentials.
    if (response.status === 409) return { error: "ACCOUNT_LINK_REQUIRED", status: 403 };
    if (response.status === 401 || response.status === 403) return { error: "IDENTITY_DENIED", status: 403 };
    return { error: "IDENTITY_UNAVAILABLE", status: 502 };
  }
  const payload = await response.json().catch(() => null);
  const data = payload?.data;
  if (typeof data?.accessToken !== "string" || data.tokenType !== "Bearer"
    || typeof data.scope !== "string" || !data.scope.split(/\s+/u).includes("resources:read")) {
    return { error: "IDENTITY_INVALID_RESPONSE", status: 502 };
  }
  return { token: data.accessToken };
}

async function coreJson(env, token, path, method, body, fetcher) {
  const response = await internalFetch(env, "CORE", path, {
    method,
    headers: {
      "authorization": "Bearer " + token,
      "accept": "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, fetcher);
  if (!response.ok) {
    return { error: response.status === 401 || response.status === 403 ? "LIFESPACE_DENIED" : "LIFESPACE_UNAVAILABLE",
      status: response.status === 401 || response.status === 403 ? 403 : 502 };
  }
  // Do not silently truncate business data. Tool results are bounded.
  const raw = await response.text();
  if (new TextEncoder().encode(raw).length > MAX_RESULT_BYTES) {
    return { error: "RESULT_TOO_LARGE", status: 502 };
  }
  let payload;
  try { payload = JSON.parse(raw); } catch { return { error: "LIFESPACE_INVALID_RESPONSE", status: 502 }; }
  return { payload };
}

function isValidId(id) {
  return (typeof id === "string" && id.length <= 128) || (typeof id === "number" && Number.isFinite(id));
}

export async function handleMcpRequest(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  if (url.pathname !== MCP_PATH) return reject(404, "Not found");
  if (!allowedOrigin(request, env)) return reject(403, "Origin is not allowed");
  if (request.method === "GET" || request.method === "DELETE") return reject(405, "MCP is stateless and POST-only");
  if (request.method !== "POST") return reject(405, "Method not allowed");
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return reject(415, "Expected application/json");
  const accept = request.headers.get("accept") || "";
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) return reject(406, "MCP Accept header is required");

  // A caller-supplied userId/email/sub/header is never authoritative.
  // Identity validates RS256 signature, issuer, audience, expiry and global mapping.
  const assertion = request.headers.get("cf-access-jwt-assertion");
  if (!assertion || assertion.length < 32 || assertion.length > 32768) return reject(401, "Access authentication required");

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return reject(413, "Request too large");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return reject(413, "Request too large");
  let message;
  try { message = JSON.parse(text); } catch { return rpcError(null, -32700, "Parse error", 400); }
  if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0" ||
      typeof message.method !== "string" || (message.id !== undefined && !isValidId(message.id))) {
    return rpcError(null, -32600, "Invalid request", 400);
  }
  if (message.id === undefined && message.method !== "notifications/initialized") {
    return rpcError(null, -32600, "Unexpected notification", 400);
  }

  let auth;
  try { auth = await exchangeUserToken(assertion, env, fetcher); }
  catch { return reject(503, "LifeSpace identity transport unavailable"); }
  if (auth.error) return reject(auth.status, auth.error);

  if (message.method === "notifications/initialized") return new Response(null, { status: 202 });
  if (message.method === "initialize") {
    return rpcResult(message.id, {
      protocolVersion: MCP_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "lifespace-mcp", version: "0.1.0" },
    });
  }
  if (message.method === "ping") return rpcResult(message.id, {});
  if (message.method !== "tools/list" && message.method !== "tools/call") {
    return rpcError(message.id, -32601, "Method not found");
  }

  try {
    const modelKeys = selectedModelKeys(env);
    const fetchJson = async (path) => {
      const result = await coreJson(env, auth.token, path, "GET", undefined, fetcher);
      if (result.error) throw new Error(result.error);
      return result.payload;
    };
    // First inventory filters configured model choices by *current* effective visibility.
    // An inaccessible model disappears from tools/list rather than breaking the entire list.
    const inventoryResponse = await fetchJson("/api/v1/me/_discovery/inventory");
    const visibleKeys = new Set(
      (inventoryResponse?.data?.spaces ?? []).flatMap(space =>
        (space.models ?? []).filter(model => model.access?.includes("read")).map(model => model.modelKey)
      )
    );
    const selectedVisible = modelKeys.filter(key => visibleKeys.has(key));
    const selection = selectedVisible.length
      ? await loadSelectedModelSemantics({ fetchJson, selectedModelKeys: selectedVisible, inventoryResponse })
      : { models: [] };
    const projected = projectSelectedModelsToMcp(selection);
    if (message.method === "tools/list") {
      if (message.params && (typeof message.params !== "object" || Object.keys(message.params).some(k => k !== "cursor"))) {
        return rpcError(message.id, -32602, "Invalid params");
      }
      if (message.params?.cursor) return rpcError(message.id, -32602, "Unsupported cursor");
      return rpcResult(message.id, { tools: projected.tools });
    }
    if (!message.params || typeof message.params !== "object" || Array.isArray(message.params)
      || typeof message.params.name !== "string" || !message.params.arguments
      || typeof message.params.arguments !== "object" || Array.isArray(message.params.arguments)) {
      return rpcError(message.id, -32602, "Invalid params");
    }
    const binding = projected.bindings[message.params.name];
    if (!binding) return rpcError(message.id, -32602, "Tool is unavailable");
    let operation;
    try { operation = buildLifeSpaceQueryRequest(binding, message.params.arguments); }
    catch { return rpcError(message.id, -32602, "Invalid tool arguments"); }
    const result = await coreJson(env, auth.token, operation.path, operation.method, operation.body, fetcher);
    if (result.error) return rpcResult(message.id, { isError: true, content: [{ type: "text", text: result.error }] });
    return rpcResult(message.id, { content: [{ type: "text", text: JSON.stringify(result.payload.data ?? result.payload) }] });
  } catch {
    return rpcError(message.id, -32603, "LifeSpace discovery unavailable");
  }
}

export default {
  fetch(request, env) {
    return handleMcpRequest(request, env);
  },
};
