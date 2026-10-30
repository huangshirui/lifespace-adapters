import { createFeishuProvider, ProviderError } from "./provider.mjs";

// The single sealed credential contains App ID, App Secret and Base app_token.
// It is transient on creation/rotation, then encrypted at rest per cnx_*.
const KEY = "connection";
const AAD = new TextEncoder().encode("lifespace:feishu-connection-vault:v1");
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const invalid = () => { throw new ProviderError("EXTERNAL_VALIDATION_FAILED", 422, true); };
export function parseCredential(credential) {
  if (!object(credential) || credential.type !== "feishu_app" || typeof credential.token !== "string" ||
      credential.token.length > 800 || credential.token.trim() !== credential.token || /[\r\n]/.test(credential.token)) invalid();
  const parts = credential.token.split("|");
  if (parts.length !== 3) invalid();
  const [appId, appSecret, base] = parts;
  if (!/^cli_[A-Za-z0-9]{8,80}$/.test(appId) || !/^[A-Za-z0-9_-]{8,256}$/.test(appSecret) ||
      !/^[A-Za-z0-9_-]{8,80}$/.test(base)) invalid();
  return { appId, appSecret, base };
}
const validConnection = v => object(v) && /^cli_[A-Za-z0-9]{8,80}$/.test(v.appId) &&
  typeof v.appSecret === "string" && /^[A-Za-z0-9_-]{8,256}$/.test(v.appSecret) &&
  typeof v.base === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(v.base) &&
  v.read === true && typeof v.write === "boolean";
const mode = v => {
  if (v !== "read" && v !== "write") invalid();
  return { read: true, write: v === "write" };
};
function keyBytes(master) {
  if (typeof master !== "string" || !/^[0-9a-fA-F]{64}$/.test(master)) throw new ProviderError("EXTERNAL_UNAVAILABLE", 503);
  return Uint8Array.from({ length: 32 }, (_, i) => Number.parseInt(master.slice(i * 2, i * 2 + 2), 16));
}
async function key(master) {
  return crypto.subtle.importKey("raw", keyBytes(master), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
const encode = bytes => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
function decode(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]+$/.test(text)) throw new Error("invalid");
  const padded = text.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(padded + "=".repeat((4 - padded.length % 4) % 4)), v => v.charCodeAt(0));
}
async function seal(connection, master) {
  if (!validConnection(connection)) invalid();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, await key(master),
    new TextEncoder().encode(JSON.stringify(connection)));
  return { version: 1, algorithm: "AES-GCM", iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
}
async function unseal(envelope, master) {
  try {
    if (!object(envelope) || envelope.version !== 1 || envelope.algorithm !== "AES-GCM") throw new Error("invalid");
    const iv = decode(envelope.iv), bytes = decode(envelope.ciphertext);
    if (iv.length !== 12) throw new Error("invalid");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: AAD }, await key(master), bytes);
    const value = JSON.parse(new TextDecoder().decode(plain));
    if (!validConnection(value)) throw new Error("invalid");
    return value;
  } catch { throw new ProviderError("EXTERNAL_UNAVAILABLE", 503, false); }
}
export class FeishuConnectionVault {
  constructor(state, env) {
    this.state = state; this.env = env; this.provider = createFeishuProvider();
  }
  async load() {
    return unseal(await this.state.storage.get(KEY), this.env?.CONNECTION_VAULT_MASTER_KEY);
  }
  async persist(connection) {
    await this.state.storage.put(KEY, await seal(connection, this.env?.CONNECTION_VAULT_MASTER_KEY));
  }
  async fetch(request) {
    if (request.method !== "POST") return Response.json({ error: { code: "EXTERNAL_ACCESS_DENIED" } }, { status: 404 });
    let body;
    try { body = await request.json(); } catch { body = null; }
    if (!object(body) || typeof body.operation !== "string") {
      return Response.json({ error: { code: "EXTERNAL_VALIDATION_FAILED", retrySafe: true } }, { status: 422 });
    }
    try {
      if (body.operation === "create" || body.operation === "configure") {
        const parsed = parseCredential(body.credential);
        const connection = { ...parsed, ...mode(body.access) };
        await this.provider.validateConnectionCredential(connection);
        await this.persist(connection);
        return Response.json({ data: { read: true, write: connection.write } });
      }
      if (body.operation === "update") {
        const current = await this.load(), next = { ...current };
        if (body.access !== undefined) Object.assign(next, mode(body.access));
        if (body.credential !== undefined) {
          const parsed = parseCredential(body.credential);
          // Rotating a credential must not silently re-parent existing bindings.
          if (parsed.base !== current.base) invalid();
          Object.assign(next, parsed);
          await this.provider.validateConnectionCredential(next);
        }
        await this.persist(next);
        return Response.json({ data: { read: true, write: next.write } });
      }
      if (body.operation === "delete") {
        await this.state.storage.deleteAll();
        return Response.json({ data: { deleted: true } });
      }
      const current = await this.load();
      if (body.operation === "listResources") {
        return Response.json({ data: await this.provider.listConnectionResources(current, body.input ?? {}) });
      }
      if (body.operation === "execute") {
        if (!object(body.request)) invalid();
        return Response.json({ data: await this.provider.execute(current, body.request) });
      }
      invalid();
    } catch (error) {
      if (error instanceof ProviderError) {
        return Response.json({ error: { code: error.code, retrySafe: error.retrySafe } }, { status: error.status });
      }
      // A failure after a remote mutation is never represented as retry-safe.
      return Response.json({ error: { code: "EXTERNAL_WRITE_UNKNOWN", retrySafe: false } }, { status: 502 });
    }
  }
}
