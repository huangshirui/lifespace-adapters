import { loadSelectedModelSemantics } from "./progressive-discovery.mjs";
import { buildLifeSpaceQueryRequest, projectSelectedModelsToMcp } from "./projection.mjs";

// New Identity-owned OAuth MCP Resource Server. Not the retired Access
// Managed OAuth Preview. This layer never exchanges CF Access assertions,
// forwards public OAuth access tokens to Core, or grants User delegation.
const MCP_PATH_PATTERN = /^\/mcp\/mcp_[a-f0-9]{32}$/u;
const META_PATH = "/.well-known/oauth-protected-resource";
const MAX_BODY_BYTES = 65536;
const MAX_RESULT_BYTES = 131072;
const MAX_DISCOVERED_MODELS = 32;
const MAX_TOKEN_LENGTH = 1024;
const VERSION = "2025-11-25";
const MODERN_VERSION = "2026-07-28";
const SUPPORTED_VERSIONS = [MODERN_VERSION, VERSION];
const SERVER_INFO = Object.freeze({ name: "lifespace-identity-oauth-mcp", version: "0.3.0-candidate" });

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store", ...headers },
  });
}

function validHttpsOrigin(value) {
  if (typeof value !== "string" || value.length > 512) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.hash
      || u.search || u.pathname !== "/" || u.hostname.includes("*")) return null;
    return u.origin;
  } catch { return null; }
}

export function oauthResourceConfig(env, requestUrl) {
  const issuer = validHttpsOrigin(env?.MCP_OAUTH_ISSUER);
  if (!issuer) return null;
  // One private Adapter Worker can serve every Core-issued mcp_* Server through
  // Core's verified same-origin ingress. The Resource is the exact request path,
  // never a Client-supplied header/body parameter or untrusted hostname.
  const dynamicOrigin = env?.MCP_RESOURCE_ORIGIN === undefined
    ? null : validHttpsOrigin(env.MCP_RESOURCE_ORIGIN);
  if (env?.MCP_RESOURCE_ORIGIN !== undefined) {
    if (!dynamicOrigin || env.MCP_RESOURCE_URI !== undefined || !requestUrl) return null;
    let incoming;
    try { incoming = new URL(requestUrl); } catch { return null; }
    if (incoming.origin !== dynamicOrigin || incoming.username || incoming.password
      || incoming.hash || incoming.search) return null;
    const path = incoming.pathname.startsWith(META_PATH + "/mcp/")
      ? incoming.pathname.slice(META_PATH.length) : incoming.pathname;
    if (!MCP_PATH_PATTERN.test(path)) return null;
    return {
      issuer, resource: dynamicOrigin + path, origin: dynamicOrigin, path,
      metadata: dynamicOrigin + META_PATH + path,
    };
  }
  // Legacy single-resource candidate remains available only for isolated
  // synthetic tests; production-style multi-Server routing uses the above.
  const resource = typeof env?.MCP_RESOURCE_URI === "string" ? env.MCP_RESOURCE_URI : "";
  let resourceUrl;
  try { resourceUrl = new URL(resource); } catch { return null; }
  if (resource.length > 1024 || resourceUrl.protocol !== "https:"
    || resourceUrl.username || resourceUrl.password || resourceUrl.hash || resourceUrl.search
    || !MCP_PATH_PATTERN.test(resourceUrl.pathname) || resourceUrl.href !== resource
    || resourceUrl.hostname.includes("*")) return null;
  return { issuer, resource, origin: resourceUrl.origin, path: resourceUrl.pathname,
    metadata: resourceUrl.origin + META_PATH + resourceUrl.pathname };
}

function challenge(config, extra = "") {
  return "Bearer resource_metadata=\"" + config.metadata
    + "\", scope=\"resources:read\"" + extra;
}

function authFailure(config, error = "invalid_token") {
  return json({ error: "OAuth authorization required" }, 401, {
    "www-authenticate": challenge(config, ", error=\"" + error + "\""),
  });
}

function insufficientScope(config) {
  return json({ error: "insufficient_scope" }, 403, {
    "www-authenticate": challenge(config, ", error=\"insufficient_scope\""),
  });
}

export function validateIntrospection(data, config) {
  if (!data || data.active !== true) return { error: "invalid_token" };
  if (data.resource !== config.resource || !Number.isSafeInteger(data.exp)
    || data.exp <= Math.floor(Date.now() / 1000)) return { error: "invalid_token" };
  if (!/^ocli_[a-zA-Z0-9_-]+$/u.test(data.client_id || "")
    || !/^oaz_[a-zA-Z0-9_-]+$/u.test(data.authorization_id || "")
    || !/^usr_[a-zA-Z0-9_-]+$/u.test(data.sub || "")
    || !/^app_[a-zA-Z0-9_-]+$/u.test(data.application_id || "")
    || !/^spc_[a-zA-Z0-9_-]+$/u.test(data.space_id || "")
    || !/^agt_[a-zA-Z0-9_-]+$/u.test(data.agent_id || "")) return { error: "invalid_token" };
  if (typeof data.scope !== "string" || data.scope.length > 500) return { error: "invalid_token" };
  const scopes = data.scope.split(/\s+/u).filter(Boolean);
  if (new Set(scopes).size !== scopes.length || scopes.some(s => ![
    "resources:read", "resources:write", "resources:manage",
  ].includes(s))) return { error: "invalid_token" };
  if (!scopes.includes("resources:read")) return { error: "insufficient_scope" };
  if (typeof data.allow_user_authorization !== "boolean") return { error: "invalid_token" };
  return {
    // This is context, not Core authority. It must never be turned into a
    // trusted Principal, Actor or Delegation without an Identity/Core bridge.
    context: Object.freeze({
      clientId: data.client_id, authorizationId: data.authorization_id,
      userId: data.sub, applicationId: data.application_id,
      spaceId: data.space_id, agentId: data.agent_id, scopes: Object.freeze(scopes),
      mayRequestDelegation: data.allow_user_authorization,
    }),
  };
}

async function verifyOAuthToken(request, config, env) {
  const header = request.headers.get("authorization") || "";
  if (!/^Bearer lsp_oat_[A-Za-z0-9_-]+$/u.test(header)
    || header.length > MAX_TOKEN_LENGTH + 7) return { error: "invalid_token" };
  const secret = env?.OAUTH_RESOURCE_SERVER_SECRET;
  if (typeof secret !== "string" || secret.length < 32
    || !env?.IDENTITY || typeof env.IDENTITY.fetch !== "function") {
    return { error: "resource_unavailable" };
  }
  let response;
  try {
    response = await env.IDENTITY.fetch("https://identity.internal/oauth/introspect", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-lifespace-resource-secret": secret,
      },
      body: new URLSearchParams({
        token: header.slice(7), resource: config.resource,
      }),
    });
  } catch {
    return { error: "resource_unavailable" };
  }
  if (response.status !== 200) return { error: "resource_unavailable" };
  const payload = await response.json().catch(() => null);
  return validateIntrospection(payload, config);
}

async function coreExecution(authorized, request, config, env) {
  if (!env?.CORE || typeof env.CORE.fetch !== "function"
    || !env?.IDENTITY || typeof env.IDENTITY.fetch !== "function") {
    return { error: "CORE_EXECUTION_NOT_CONFIGURED" };
  }
  // Only Identity owns OAuth → Core Agent execution translation. The public
  // OAuth token is sent solely to Identity, never to Core or browser JS.
  const secret = env.OAUTH_RESOURCE_SERVER_SECRET;
  const token = request.headers.get("authorization").slice(7);
  let response;
  try {
    response = await env.IDENTITY.fetch("https://identity.internal/oauth/execution-tokens", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-lifespace-resource-secret": secret,
      },
      body: JSON.stringify({ token, resource: config.resource }),
    });
  } catch { return { error: "IDENTITY_EXECUTION_UNAVAILABLE" }; }
  if (response.status !== 200) return { error: "IDENTITY_EXECUTION_DENIED" };
  const result = await response.json().catch(() => null);
  const data = result?.data;
  if (data?.tokenType !== "Bearer"
    || typeof data.accessToken !== "string"
    || data.accessToken.length > 5000
    || !/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(data.accessToken)
    || data.scope !== "resources:read"
    || !Number.isSafeInteger(data.expiresIn) || data.expiresIn < 1 || data.expiresIn > 60
    || data.applicationId !== authorized.context.applicationId
    || data.agentId !== authorized.context.agentId
    || data.spaceId !== authorized.context.spaceId) {
    return { error: "IDENTITY_EXECUTION_INVALID_RESPONSE" };
  }
  return { token: data.accessToken };
}

async function coreJson(env, coreToken, path, method = "GET", body) {
  if (!/^\/api\/v1\/(me\/_discovery\/inventory|spaces\/spc_[A-Za-z0-9_-]+\/(?:_discovery\/models\/(?:batch|[a-z][a-z0-9_-]*)|models\/[a-z][a-z0-9_-]*\/records\/query))$/u.test(path)) {
    return { error: "CORE_PATH_REJECTED" };
  }
  let response;
  try {
    response = await env.CORE.fetch("https://core.internal" + path, {
      method, headers: {
        authorization: "Bearer " + coreToken,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch { return { error: "CORE_UNAVAILABLE" }; }
  if (!response.ok) {
    return { error: response.status === 401 || response.status === 403
      ? "CORE_PERMISSION_DENIED" : "CORE_UNAVAILABLE" };
  }
  let raw;
  try { raw = await response.text(); } catch { return { error: "CORE_UNAVAILABLE" }; }
  if (new TextEncoder().encode(raw).length > MAX_RESULT_BYTES) {
    return { error: "CORE_RESULT_TOO_LARGE" };
  }
  let payload;
  try { payload = JSON.parse(raw); } catch { return { error: "CORE_INVALID_RESPONSE" }; }
  return { payload };
}

async function currentToolProjection(env, coreToken, selectedSpace) {
  const first = await coreJson(env, coreToken, "/api/v1/me/_discovery/inventory");
  if (first.error) return first;
  const inventory = first.payload?.data;
  if (!Array.isArray(inventory?.models) || !Array.isArray(inventory?.spaces)
    || inventory.spaces.some(space => space?.spaceId !== selectedSpace)) {
    return { error: "CORE_UNSCOPED_DISCOVERY" };
  }
  const keys = [...new Set(inventory.spaces.flatMap(space => (space.models ?? [])
    .filter(entry => entry?.access?.includes("read"))
    .map(entry => entry.modelKey)
    .filter(key => typeof key === "string" && /^[a-z][a-z0-9_]{1,62}$/u.test(key))))]
    .sort();
  // Do not silently drop configured Models: either project the entire
  // authorized exposure or fail closed with an explicit capacity error.
  if (keys.length > MAX_DISCOVERED_MODELS) return { error: "CORE_DISCOVERY_MODEL_LIMIT" };
  if (!keys.length) return { projected: { tools: [], bindings: {} } };
  // One Core invocation returns all selected semantics; Core still checks
  // every Model Grant, current Server Tool Policy and selected Space.
  // This avoids exceeding Cloudflare's 32 Worker invocations per MCP request.
  const batchPath = "/api/v1/spaces/" + encodeURIComponent(selectedSpace)
    + "/_discovery/models/batch";
  const batch = await coreJson(env, coreToken, batchPath, "POST", { modelKeys: keys });
  if (batch.error) return batch;
  const rawDetails = batch.payload?.data?.models;
  if (!Array.isArray(rawDetails) || rawDetails.length !== keys.length) {
    return { error: "CORE_DISCOVERY_INVALID_BATCH" };
  }
  const details = new Map();
  for (const item of rawDetails) {
    if (!item || !keys.includes(item.modelKey) || details.has(item.modelKey)
      || !item.detail || typeof item.detail !== "object" || Array.isArray(item.detail)) {
      return { error: "CORE_DISCOVERY_INVALID_BATCH" };
    }
    details.set(item.modelKey, { data: item.detail });
  }
  const detailPrefix = "/api/v1/spaces/" + encodeURIComponent(selectedSpace)
    + "/_discovery/models/";
  const fetchJson = async path => {
    if (!path.startsWith(detailPrefix)) {
      throw new Error("Core semantic batch path escaped authorized Space");
    }
    const modelKey = path.slice(detailPrefix.length);
    if (!details.has(modelKey)) throw new Error("No current Core semantic detail");
    return details.get(modelKey);
  };
  try {
    const selection = await loadSelectedModelSemantics({
      selectedModelKeys: keys, inventoryResponse: first.payload, fetchJson,
    });
    // A signed OAuth execution JWT is restricted to the one consented Space.
    if (selection.models.some(item =>
      !item.spaces.every(space => space.spaceId === selectedSpace))) {
      return { error: "CORE_UNSCOPED_SEMANTICS" };
    }
    return { projected: projectSelectedModelsToMcp(selection) };
  } catch { return { error: "CORE_DISCOVERY_UNAVAILABLE" }; }
}

function validOrigin(request, config) {
  const header = request.headers.get("origin");
  return header === null || header === config.origin;
}

function rpcResult(id, result, modern = false) {
  return json({ jsonrpc: "2.0", id, result: modern
    ? {
      resultType: "complete", ...result,
      _meta: { ...result._meta, "io.modelcontextprotocol/serverInfo": SERVER_INFO },
    }
    : result });
}

function rpcError(id, code, message, status = 200, data) {
  return json({ jsonrpc: "2.0", id, error: {
    code, message, ...(data === undefined ? {} : { data }),
  } }, status);
}

function decodeMcpName(raw) {
  if (typeof raw !== "string") return null;
  const encoded = /^=\\?base64\\?([A-Za-z0-9+/]+={0,2})\\?=$/u.exec(raw);
  if (encoded) {
    try {
      return new TextDecoder("utf-8", { fatal: true })
        .decode(Uint8Array.from(atob(encoded[1]), x => x.charCodeAt(0)));
    } catch { return null; }
  }
  if (!/^[\\x20-\\x7e]+$/u.test(raw) || raw.trim() !== raw
    || (raw.startsWith("=?base64?") && raw.endsWith("?="))) return null;
  return raw;
}

function modernRequestError(request, message) {
  const version = request.headers.get("mcp-protocol-version");
  const params = message.params;
  const meta = params && typeof params === "object" && !Array.isArray(params) ? params._meta : null;
  const bodyVersion = meta && typeof meta === "object" ? meta["io.modelcontextprotocol/protocolVersion"] : null;
  const modern = version === MODERN_VERSION || bodyVersion === MODERN_VERSION;
  if (version && !SUPPORTED_VERSIONS.includes(version)) {
    return { modern: false, error: rpcError(message.id, -32022, "Unsupported protocol version", 400, {
      supported: SUPPORTED_VERSIONS, requested: version,
    }) };
  }
  if (!modern) return { modern: false };
  // 2026-07-28 has no session; every RPC carries its capabilities and
  // matching HTTP routing headers. Missing/mismatched metadata fails closed.
  if (version !== MODERN_VERSION || bodyVersion !== MODERN_VERSION
    || request.headers.get("mcp-method") !== message.method
    || !meta || typeof meta !== "object" || Array.isArray(meta)
    || !meta["io.modelcontextprotocol/clientCapabilities"]
    || typeof meta["io.modelcontextprotocol/clientCapabilities"] !== "object"
    || Array.isArray(meta["io.modelcontextprotocol/clientCapabilities"])) {
    return { modern: true, error: rpcError(message.id, -32020, "Header mismatch or missing modern request metadata", 400) };
  }
  if (message.method === "tools/call") {
    if (decodeMcpName(request.headers.get("mcp-name")) !== params?.name) {
      return { modern: true, error: rpcError(message.id, -32020, "Mcp-Name header mismatch", 400) };
    }
  }
  return { modern: true };
}

export async function handleIdentityOAuthMcp(request, env) {
  const url = new URL(request.url);
  if (env?.MCP_RESOURCE_ORIGIN !== undefined) {
    // An unrelated URL is not a resource, even in the private Worker.
    const path = url.pathname.startsWith(META_PATH + "/mcp/")
      ? url.pathname.slice(META_PATH.length) : url.pathname;
    if (!MCP_PATH_PATTERN.test(path)) return json({ error: "Not found" }, 404);
  }
  const config = oauthResourceConfig(env, request.url);
  if (!config) return json({ error: "Resource server unavailable" }, 503);
  if (url.origin !== config.origin) return json({ error: "Invalid resource host" }, 403);

  if ((url.pathname === META_PATH || url.pathname === META_PATH + config.path) && request.method === "GET") {
    return json({
      resource: config.resource,
      authorization_servers: [config.issuer],
      scopes_supported: ["resources:read"],
      bearer_methods_supported: ["header"],
    }, 200, { "cache-control": "public, max-age=300" });
  }
  if (url.pathname !== config.path || url.search) return json({ error: "Not found" }, 404);
  if (!validOrigin(request, config)) return json({ error: "Invalid origin" }, 403);
  if (request.method !== "POST") return json({ error: "MCP requires POST" }, 405, { allow: "POST" });

  const authorized = await verifyOAuthToken(request, config, env);
  if (authorized.error === "resource_unavailable") return json({ error: "Resource authentication unavailable" }, 503);
  if (authorized.error === "insufficient_scope") return insufficientScope(config);
  if (authorized.error) return authFailure(config);

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "Expected application/json" }, 415);
  }
  const accept = request.headers.get("accept") || "";
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
    return json({ error: "MCP Accept header is required" }, 406);
  }
  const declared = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(declared) || declared > MAX_BODY_BYTES) return json({ error: "Request too large" }, 413);
  const body = await request.text();
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) return json({ error: "Request too large" }, 413);
  let message;
  try { message = JSON.parse(body); } catch { return rpcError(null, -32700, "Parse error", 400); }
  if (!message || typeof message !== "object" || Array.isArray(message)
    || message.jsonrpc !== "2.0" || typeof message.method !== "string"
    || (message.id !== undefined && !(
      (typeof message.id === "string" && message.id.length <= 128)
      || (typeof message.id === "number" && Number.isFinite(message.id))
    ))) return rpcError(null, -32600, "Invalid request", 400);

  const checked = modernRequestError(request, message);
  if (checked.error) return checked.error;
  const modern = checked.modern;
  if (modern && message.id !== undefined && message.method === "server/discover") {
    return rpcResult(message.id, {
      supportedVersions: SUPPORTED_VERSIONS,
      capabilities: { tools: { listChanged: false } },
      ttlMs: 0, cacheScope: "private",
    }, true);
  }
  if (!modern && message.method === "notifications/initialized" && message.id === undefined) {
    return new Response(null, { status: 202 });
  }
  if (message.id === undefined) return rpcError(null, -32600, "Unexpected notification", 400);
  if (!modern && message.method === "initialize") {
    return rpcResult(message.id, {
      protocolVersion: VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
    });
  }
  if (!modern && message.method === "ping") return rpcResult(message.id, {});

  if (message.method !== "tools/list" && message.method !== "tools/call") {
    return rpcError(message.id, -32601, "Method not found", modern ? 404 : 200);
  }
  const execution = await coreExecution(authorized, request, config, env);
  if (execution.error) return json({ error: execution.error }, 503);

  const current = await currentToolProjection(env, execution.token, authorized.context.spaceId);
  if (current.error) return json({ error: current.error }, 503);
  if (message.method === "tools/list") {
    if (message.params && (typeof message.params !== "object" || Array.isArray(message.params)
      || Object.keys(message.params).some(key => key !== "cursor" && !(modern && key === "_meta")) || message.params.cursor)) {
      return rpcError(message.id, -32602, "Unsupported pagination parameters");
    }
    return rpcResult(message.id, { tools: current.projected.tools, ...(modern ? { ttlMs: 0, cacheScope: "private" } : {}) }, modern);
  }

  if (!message.params || typeof message.params !== "object" || Array.isArray(message.params)
    || typeof message.params.name !== "string"
    || !message.params.arguments || typeof message.params.arguments !== "object"
    || Array.isArray(message.params.arguments)) {
    return rpcError(message.id, -32602, "Invalid tool invocation");
  }
  const binding = current.projected.bindings[message.params.name];
  if (!binding) return rpcError(message.id, -32602, "Tool is not in the currently authorized projection");
  let operation;
  try {
    operation = buildLifeSpaceQueryRequest(binding, message.params.arguments);
  } catch { return rpcError(message.id, -32602, "Invalid arguments for current model semantics"); }
  if (!operation.path.startsWith("/api/v1/spaces/"
    + encodeURIComponent(authorized.context.spaceId) + "/")) {
    return rpcError(message.id, -32602, "Selected Space mismatch");
  }
  const result = await coreJson(env, execution.token, operation.path, operation.method, operation.body);
  if (result.error) return rpcResult(message.id, {
    isError: true, content: [{ type: "text", text: result.error }],
  }, modern);
  return rpcResult(message.id, {
    content: [{ type: "text", text: JSON.stringify(result.payload?.data ?? result.payload) }],
  }, modern);
}

export default { fetch: handleIdentityOAuthMcp };
