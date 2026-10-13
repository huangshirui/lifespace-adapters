import { createNotionProvider, ProviderError } from "./provider.mjs";
const configurations = new Map();
function connection(env, ref) {
  if (typeof ref !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(ref))
    return null;
  // Cache only injected configuration; revocation/rotation changes the Secret value.
  let parsed = configurations.get(env.NOTION_CONNECTIONS);
  if (!parsed) {
    try {
      parsed = JSON.parse(env.NOTION_CONNECTIONS ?? "{}");
    } catch {
      return null;
    }
    configurations.clear();
    configurations.set(env.NOTION_CONNECTIONS, parsed);
  }
  if (!Object.hasOwn(parsed, ref)) return null;
  const c = parsed[ref];
  if (!c || typeof c.token !== "string" || !c.token || c.disabled === true)
    return null;
  return c;
}
async function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || b.length < 32)
    return false;
  const hash = async (v) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)),
    );
  const [x, y] = await Promise.all([hash(a), hash(b)]);
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i];
  return difference === 0;
}
export function createWorker(provider = createNotionProvider()) {
  return {
    async fetch(request, env) {
      const error = (code, status, retrySafe = false) =>
        Response.json(
          { contractVersion: 1, error: { code, retrySafe } },
          { status },
        );
      if (
        !(await sameSecret(
          request.headers.get("x-lifespace-internal-secret"),
          env.EXTERNAL_ADAPTER_SHARED_SECRET,
        ))
      )
        return error("EXTERNAL_ACCESS_DENIED", 401);
      if (
        request.method !== "POST" ||
        new URL(request.url).pathname !== "/internal/v1/external-models"
      )
        return error("EXTERNAL_ACCESS_DENIED", 404);
      try {
        const text = await request.text();
        if (text.length > 256000)
          throw new ProviderError("EXTERNAL_VALIDATION_FAILED", 422, true);
        const body = JSON.parse(text);
        const c = connection(env, body.credentialRef);
        if (!c) return error("EXTERNAL_ACCESS_DENIED", 503, true);
        return Response.json({
          contractVersion: 1,
          data: await provider.execute(c, body),
        });
      } catch (e) {
        if (e instanceof ProviderError)
          return error(e.code, e.status, e.retrySafe);
        // Unknown exceptions may occur after a provider mutation: never mark retry-safe.
        return error("EXTERNAL_WRITE_UNKNOWN", 502, false);
      }
    },
  };
}
export default createWorker();
