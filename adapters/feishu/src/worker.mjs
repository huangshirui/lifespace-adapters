import { ProviderError } from "./provider.mjs";
export { FeishuConnectionVault } from "./connection-vault.mjs";

const validRef = value => typeof value === "string" && /^cnx_[a-f0-9]{32}$/.test(value);
const descriptor = {
  key: "feishu",
  displayName: "Feishu Bitable / 飞书多维表格",
  credential: { type: "feishu_app", displayName: "App ID | App Secret | Base app_token" },
  resource: { type: "table", displayName: "Bitable table / 数据表" },
  access: ["read", "write"],
};
const error = (code, status, retrySafe = false) =>
  Response.json({ contractVersion: 1, error: { code, retrySafe } }, { status });

async function sameSecret(supplied, expected) {
  if (typeof supplied !== "string" || typeof expected !== "string" || expected.length < 32) return false;
  const digest = value => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)).then(x => new Uint8Array(x));
  const [a, b] = await Promise.all([digest(supplied), digest(expected)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
async function callVault(env, ref, body) {
  if (!validRef(ref)) throw new ProviderError("EXTERNAL_VALIDATION_FAILED", 422, true);
  if (!env?.CONNECTIONS) throw new ProviderError("EXTERNAL_UNAVAILABLE", 503, true);
  const stub = env.CONNECTIONS.get(env.CONNECTIONS.idFromName(ref));
  const response = await stub.fetch("https://feishu-connection.internal/", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!result || typeof result !== "object") throw new ProviderError("EXTERNAL_CONTRACT_INVALID", 502);
  if (!response.ok || result.error) {
    throw new ProviderError(result.error?.code ?? "EXTERNAL_UNAVAILABLE", response.status, result.error?.retrySafe === true);
  }
  return result.data;
}
export function createWorker() {
  return {
    async fetch(request, env) {
      if (!(await sameSecret(request.headers.get("x-lifespace-internal-secret"), env?.EXTERNAL_ADAPTER_SHARED_SECRET))) {
        return error("EXTERNAL_ACCESS_DENIED", 401);
      }
      const pathname = new URL(request.url).pathname;
      if (request.method !== "POST" || !["/internal/v1/external-connections", "/internal/v1/external-models"].includes(pathname)) {
        return error("EXTERNAL_ACCESS_DENIED", 404);
      }
      try {
        const raw = await request.text();
        if (raw.length > 256000) throw new ProviderError("EXTERNAL_VALIDATION_FAILED", 422, true);
        const body = JSON.parse(raw);
        if (!body || typeof body !== "object" || Array.isArray(body) || body.contractVersion !== 1) {
          throw new ProviderError("EXTERNAL_CONTRACT_INVALID", 502, true);
        }
        if (pathname === "/internal/v1/external-connections" && body.operation === "describe") {
          return Response.json({ contractVersion: 1, data: descriptor });
        }
        if (body.providerKey !== "feishu") throw new ProviderError("EXTERNAL_CONTRACT_INVALID", 502, true);
        const payload = pathname === "/internal/v1/external-connections"
          ? {
              operation: body.operation,
              ...(body.credential === undefined ? {} : { credential: body.credential }),
              ...(body.access === undefined ? {} : { access: body.access }),
              ...(body.input === undefined ? {} : { input: body.input }),
            }
          : { operation: "execute", request: body };
        const data = await callVault(env, body.credentialRef, payload);
        return Response.json({ contractVersion: 1, data });
      } catch (cause) {
        if (cause instanceof ProviderError) return error(cause.code, cause.status, cause.retrySafe);
        return error("EXTERNAL_WRITE_UNKNOWN", 502, false);
      }
    },
  };
}
export default createWorker();
