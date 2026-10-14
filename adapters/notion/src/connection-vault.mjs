import { createNotionProvider, NOTION_VERSION, ProviderError, uuid } from "./provider.mjs";

const CONFIG_KEY = "connection";
const MAX_TOKEN_BYTES = 8192;
const MAX_QUERY = 200;
const VAULT_FORMAT_VERSION = 1;
const VAULT_ALGORITHM = "AES-GCM";
const VAULT_AAD = new TextEncoder().encode("lifespace:notion-connection-vault:v1");

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
function validToken(value) {
  return typeof value === "string"
    && value.length > 0
    && value === value.trim()
    && !/[\r\n]/u.test(value)
    && new TextEncoder().encode(value).length <= MAX_TOKEN_BYTES;
}
function validConnection(value) {
  return object(value) && validToken(value.token) && value.read === true && typeof value.write === "boolean";
}
function accessMode(value) {
  if (value !== "read" && value !== "write") throw new ProviderError("EXTERNAL_VALIDATION_FAILED", 422, true);
  return { read: true, write: value === "write" };
}
function title(value) {
  if (!Array.isArray(value)) return "";
  return value.map((part) => part?.plain_text ?? part?.text?.content ?? "").join("").trim();
}
function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
function base64UrlToBytes(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("invalid base64url");
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
function masterKeyBytes(secret) {
  if (typeof secret !== "string" || !/^[0-9a-fA-F]{64}$/u.test(secret)) {
    throw new ProviderError("EXTERNAL_UNAVAILABLE", 503, false);
  }
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(secret.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}
async function importVaultKey(secret) {
  return crypto.subtle.importKey("raw", masterKeyBytes(secret), { name: VAULT_ALGORITHM }, false, ["encrypt", "decrypt"]);
}
function encryptedEnvelope(value) {
  return object(value)
    && value.version === VAULT_FORMAT_VERSION
    && value.algorithm === VAULT_ALGORITHM
    && typeof value.iv === "string"
    && typeof value.ciphertext === "string";
}
async function encryptConnection(connection, secret) {
  if (!validConnection(connection)) throw new ProviderError("EXTERNAL_VALIDATION_FAILED", 422, true);
  const key = await importVaultKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(connection));
  const ciphertext = await crypto.subtle.encrypt({ name: VAULT_ALGORITHM, iv, additionalData: VAULT_AAD }, key, plaintext);
  return {
    version: VAULT_FORMAT_VERSION,
    algorithm: VAULT_ALGORITHM,
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
  };
}
async function decryptConnection(envelope, secret) {
  try {
    if (!encryptedEnvelope(envelope)) throw new Error("invalid envelope");
    const key = await importVaultKey(secret);
    const iv = base64UrlToBytes(envelope.iv);
    if (iv.length !== 12) throw new Error("invalid iv");
    const ciphertext = base64UrlToBytes(envelope.ciphertext);
    const plaintext = await crypto.subtle.decrypt({ name: VAULT_ALGORITHM, iv, additionalData: VAULT_AAD }, key, ciphertext);
    const value = JSON.parse(new TextDecoder().decode(plaintext));
    if (!validConnection(value)) throw new Error("invalid connection");
    return value;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("EXTERNAL_UNAVAILABLE", 503, false);
  }
}

async function notionRead(connection, path, body) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response;
    try {
      response = await fetch(`https://api.notion.com/v1${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: `Bearer ${connection.token}`,
          "Notion-Version": NOTION_VERSION,
          "Notion-Beta": "status-group-filters-2026-10-06",
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      if (attempt < 2) continue;
      throw new ProviderError("EXTERNAL_UNAVAILABLE", 503, true);
    }
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Math.min(10, Math.max(0, Number(response.headers.get("retry-after") ?? 1)));
      await response.body?.cancel();
      if (attempt < 2 && Number.isFinite(retryAfter)) {
        await new Promise((resolve) => setTimeout(resolve, Math.max(250 * 2 ** attempt, retryAfter * 1000)));
        continue;
      }
      throw new ProviderError(response.status === 429 ? "EXTERNAL_RATE_LIMITED" : "EXTERNAL_UNAVAILABLE", response.status === 429 ? 429 : 503, true);
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) throw new ProviderError("EXTERNAL_ACCESS_DENIED", 503, true);
      throw new ProviderError(response.status === 404 ? "EXTERNAL_RESOURCE_UNAVAILABLE" : "EXTERNAL_VALIDATION_FAILED", response.status === 404 ? 404 : 422, true);
    }
    const parsed = await response.json().catch(() => null);
    if (!object(parsed)) throw new ProviderError("EXTERNAL_CONTRACT_INVALID", 502, true);
    return parsed;
  }
  throw new ProviderError("EXTERNAL_UNAVAILABLE", 503, true);
}

export async function validateConnectionCredential(connection) {
  await notionRead(connection, "/users/me");
  return { read: true, write: connection.write === true };
}

export async function listConnectionResources(connection, input = {}) {
  if (!object(input)) throw new ProviderError("EXTERNAL_VALIDATION_FAILED", 422, true);
  const limit = input.limit === undefined ? 50 : Number(input.limit);
  const cursor = input.cursor ?? null;
  const query = input.query ?? "";
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ProviderError("EXTERNAL_VALIDATION_FAILED", 422, true);
  if (cursor !== null && (typeof cursor !== "string" || cursor.length > 2048)) throw new ProviderError("EXTERNAL_VALIDATION_FAILED", 422, true);
  if (typeof query !== "string" || query.length > MAX_QUERY) throw new ProviderError("EXTERNAL_VALIDATION_FAILED", 422, true);
  const raw = await notionRead(connection, "/search", {
    page_size: limit,
    filter: { property: "object", value: "data_source" },
    sort: { direction: "descending", timestamp: "last_edited_time" },
    ...(cursor ? { start_cursor: cursor } : {}),
    ...(query.trim() ? { query: query.trim() } : {}),
  });
  if (!Array.isArray(raw.results)) throw new ProviderError("EXTERNAL_CONTRACT_INVALID", 502, true);
  const items = raw.results
    .filter((entry) => entry?.object === "data_source" && typeof entry.id === "string")
    .slice(0, limit)
    .map((entry) => ({
      id: uuid(entry.id),
      type: "data_source",
      displayName: title(entry.title) || "Untitled data source",
    }));
  return { items, nextCursor: raw.has_more === true && typeof raw.next_cursor === "string" ? raw.next_cursor : null };
}

export class NotionConnectionVault {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.provider = createNotionProvider();
    this.cachedConnection = undefined;
  }

  async persist(connection) {
    const envelope = await encryptConnection(connection, this.env?.CONNECTION_VAULT_MASTER_KEY);
    await this.state.storage.put(CONFIG_KEY, envelope);
    this.cachedConnection = connection;
  }

  async load() {
    if (this.cachedConnection) return this.cachedConnection;
    const stored = await this.state.storage.get(CONFIG_KEY);
    if (encryptedEnvelope(stored)) {
      this.cachedConnection = await decryptConnection(stored, this.env?.CONNECTION_VAULT_MASTER_KEY);
      return this.cachedConnection;
    }
    // One-way lazy migration from the pre-encryption format. The plaintext is
    // accepted only when it exactly matches the legacy connection projection,
    // then immediately replaced by the AES-GCM envelope before use continues.
    if (validConnection(stored)) {
      const legacy = { token: stored.token, read: true, write: stored.write };
      await this.persist(legacy);
      return legacy;
    }
    throw new ProviderError("EXTERNAL_ACCESS_DENIED", 503, true);
  }

  async fetch(request) {
    if (request.method !== "POST") return Response.json({ error: "not_found" }, { status: 404 });
    let body;
    try { body = await request.json(); } catch { body = null; }
    if (!object(body) || typeof body.operation !== "string") return Response.json({ error: "invalid" }, { status: 422 });
    try {
      if (body.operation === "create" || body.operation === "configure") {
        if (!object(body.credential) || body.credential.type !== "bearer_token" || !validToken(body.credential.token)) {
          throw new ProviderError("EXTERNAL_VALIDATION_FAILED", 422, true);
        }
        const access = accessMode(body.access);
        const connection = { token: body.credential.token, ...access };
        await validateConnectionCredential(connection);
        await this.persist(connection);
        return Response.json({ data: { read: true, write: connection.write } });
      }
      if (body.operation === "update") {
        const current = await this.load();
        const next = { ...current };
        if (body.access !== undefined) Object.assign(next, accessMode(body.access));
        if (body.credential !== undefined) {
          if (!object(body.credential) || body.credential.type !== "bearer_token" || !validToken(body.credential.token)) {
            throw new ProviderError("EXTERNAL_VALIDATION_FAILED", 422, true);
          }
          next.token = body.credential.token;
        }
        if (body.credential !== undefined) await validateConnectionCredential(next);
        await this.persist(next);
        return Response.json({ data: { read: true, write: next.write } });
      }
      if (body.operation === "delete") {
        await this.state.storage.deleteAll();
        this.cachedConnection = undefined;
        return Response.json({ data: { deleted: true } });
      }
      const connection = await this.load();
      if (body.operation === "listResources") return Response.json({ data: await listConnectionResources(connection, body.input ?? {}) });
      if (body.operation === "execute") {
        if (!object(body.request)) throw new ProviderError("EXTERNAL_VALIDATION_FAILED", 422, true);
        return Response.json({ data: await this.provider.execute(connection, body.request) });
      }
      throw new ProviderError("EXTERNAL_VALIDATION_FAILED", 422, true);
    } catch (error) {
      if (error instanceof ProviderError) return Response.json({ error: { code: error.code, retrySafe: error.retrySafe } }, { status: error.status });
      return Response.json({ error: { code: "EXTERNAL_UNAVAILABLE", retrySafe: false } }, { status: 503 });
    }
  }
}
