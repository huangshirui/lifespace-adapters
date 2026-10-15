import { createNotionProvider, ProviderError } from "./provider.mjs";
export { NotionConnectionVault } from "./connection-vault.mjs";

const dynamicRef = (ref) => typeof ref === "string" && /^cnx_[a-f0-9]{32}$/u.test(ref);
const providerDescriptor = {
  key: "notion",
  displayName: "Notion",
  credential: { type: "bearer_token", displayName: "Integration token" },
  resource: { type: "data_source", displayName: "Data source" },
  access: ["read", "write"],
};

async function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || b.length < 32) return false;
  const hash = async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [left, right] = await Promise.all([hash(a), hash(b)]);
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left[i] ^ right[i];
  return difference === 0;
}

function errorResponse(code, status, retrySafe = false) {
  return Response.json({ contractVersion: 1, error: { code, retrySafe } }, { status });
}

async function callVault(env, ref, body) {
  if (!dynamicRef(ref)) throw new ProviderError("EXTERNAL_VALIDATION_FAILED", 422, true);
  if (!env.CONNECTIONS) throw new ProviderError("EXTERNAL_UNAVAILABLE", 503, true);
  const id = env.CONNECTIONS.idFromName(ref);
  const stub = env.CONNECTIONS.get(id);
  const response = await stub.fetch("https://connection-vault.internal/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object") throw new ProviderError("EXTERNAL_CONTRACT_INVALID", 502, false);
  if (!response.ok || payload.error) {
    const code = payload.error?.code ?? "EXTERNAL_UNAVAILABLE";
    throw new ProviderError(code, response.status >= 400 && response.status <= 599 ? response.status : 503, payload.error?.retrySafe === true);
  }
  return payload.data;
}

export function createWorker(provider = createNotionProvider()) {
  return {
    async fetch(request, env) {
      if (!(await sameSecret(request.headers.get("x-lifespace-internal-secret"), env.EXTERNAL_ADAPTER_SHARED_SECRET))) {
        return errorResponse("EXTERNAL_ACCESS_DENIED", 401);
      }
      const url = new URL(request.url);
      if (request.method !== "POST" || !["/internal/v1/external-models", "/internal/v1/external-connections"].includes(url.pathname)) {
        return errorResponse("EXTERNAL_ACCESS_DENIED", 404);
      }
      try {
        const text = await request.text();
        if (text.length > 256000) throw new ProviderError("EXTERNAL_VALIDATION_FAILED", 422, true);
        const body = JSON.parse(text);
        if (!body || typeof body !== "object" || Array.isArray(body) || body.contractVersion !== 1) {
          throw new ProviderError("EXTERNAL_CONTRACT_INVALID", 502, true);
        }
        if (url.pathname === "/internal/v1/external-connections" && body.operation === "describe") {
          return Response.json({ contractVersion: 1, data: providerDescriptor });
        }
        if (body.providerKey !== "notion") throw new ProviderError("EXTERNAL_CONTRACT_INVALID", 502, true);
        if (url.pathname === "/internal/v1/external-connections") {
          const data = await callVault(env, body.credentialRef, {
            operation: body.operation,
            ...(body.credential === undefined ? {} : { credential: body.credential }),
            ...(body.access === undefined ? {} : { access: body.access }),
            ...(body.input === undefined ? {} : { input: body.input }),
          });
          return Response.json({ contractVersion: 1, data });
        }
        const data = await callVault(env, body.credentialRef, { operation: "execute", request: body });
        return Response.json({ contractVersion: 1, data });
      } catch (error) {
        if (error instanceof ProviderError) return errorResponse(error.code, error.status, error.retrySafe);
        // Unknown exceptions may occur after a provider mutation: never mark retry-safe.
        return errorResponse("EXTERNAL_WRITE_UNKNOWN", 502, false);
      }
    },
  };
}

export default createWorker();
