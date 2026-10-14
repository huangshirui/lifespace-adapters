import test from "node:test";
import assert from "node:assert/strict";
import { NotionConnectionVault, listConnectionResources, validateConnectionCredential } from "../src/connection-vault.mjs";
import { createWorker } from "../src/worker.mjs";

const connection = { token: "synthetic_notion_token", read: true, write: true };
const vaultEnv = { CONNECTION_VAULT_MASTER_KEY: "11".repeat(32) };

function withFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve(run()).finally(() => { globalThis.fetch = original; });
}
function memoryState(initial) {
  const storage = new Map(initial === undefined ? [] : [["connection", initial]]);
  return {
    storage,
    state: {
      storage: {
        get: async (key) => storage.get(key),
        put: async (key, value) => { storage.set(key, value); },
        deleteAll: async () => { storage.clear(); },
      },
    },
  };
}
function request(body) {
  return new Request("https://vault.internal/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("credential validation and resource discovery keep token in Authorization only", async () => {
  const calls = [];
  await withFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/users/me")) return Response.json({ object: "user", id: "bot" });
    return Response.json({
      object: "list",
      results: [
        { object: "data_source", id: "12345678-1234-1234-1234-1234567890ab", title: [{ plain_text: "Health Documents" }] },
      ],
      has_more: false,
      next_cursor: null,
    });
  }, async () => {
    assert.deepEqual(await validateConnectionCredential(connection), { read: true, write: true });
    const resources = await listConnectionResources(connection, { limit: 20, query: "Health" });
    assert.deepEqual(resources, {
      items: [{ id: "123456781234123412341234567890ab", type: "data_source", displayName: "Health Documents" }],
      nextCursor: null,
    });
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers.authorization, `Bearer ${connection.token}`);
  assert.equal(calls[1].init.headers.authorization, `Bearer ${connection.token}`);
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    page_size: 20,
    filter: { property: "object", value: "data_source" },
    sort: { direction: "descending", timestamp: "last_edited_time" },
    query: "Health",
  });
});

test("Durable Object encrypts dynamic credential at rest and never returns plaintext", async () => {
  const { storage, state } = memoryState();
  const vault = new NotionConnectionVault(state, vaultEnv);
  await withFetch(async () => Response.json({ object: "user", id: "bot" }), async () => {
    const configured = await vault.fetch(request({ operation: "configure", credential: { type: "bearer_token", token: connection.token }, access: "write" }));
    assert.equal(configured.status, 200);
    assert.equal((await configured.text()).includes(connection.token), false);
  });
  const stored = storage.get("connection");
  assert.deepEqual(Object.keys(stored).sort(), ["algorithm", "ciphertext", "iv", "version"]);
  assert.equal(stored.version, 1);
  assert.equal(stored.algorithm, "AES-GCM");
  assert.equal(JSON.stringify(stored).includes(connection.token), false);
  assert.match(stored.iv, /^[A-Za-z0-9_-]+$/u);
  assert.match(stored.ciphertext, /^[A-Za-z0-9_-]+$/u);

  const projected = await vault.fetch(request({ operation: "execute", request: { contractVersion: 1, providerKey: "notion", credentialRef: "cnx_" + "a".repeat(32), operation: "connection", resourceId: "connection" } }));
  assert.deepEqual(await projected.json(), { data: { read: true, write: true } });
  const deleted = await vault.fetch(request({ operation: "delete" }));
  assert.equal(deleted.status, 200);
  assert.equal(storage.size, 0);
});

test("legacy plaintext Durable Object state is lazily migrated to AES-GCM before continuing", async () => {
  const { storage, state } = memoryState({ ...connection });
  const vault = new NotionConnectionVault(state, vaultEnv);
  const projected = await vault.fetch(request({ operation: "execute", request: { contractVersion: 1, providerKey: "notion", credentialRef: "cnx_" + "c".repeat(32), operation: "connection", resourceId: "connection" } }));
  assert.deepEqual(await projected.json(), { data: { read: true, write: true } });
  const migrated = storage.get("connection");
  assert.equal(migrated.version, 1);
  assert.equal(migrated.algorithm, "AES-GCM");
  assert.equal(JSON.stringify(migrated).includes(connection.token), false);
});

test("missing or invalid vault master key fails closed without persisting plaintext", async () => {
  for (const env of [{}, { CONNECTION_VAULT_MASTER_KEY: "too-short" }]) {
    const { storage, state } = memoryState();
    const vault = new NotionConnectionVault(state, env);
    await withFetch(async () => Response.json({ object: "user", id: "bot" }), async () => {
      const response = await vault.fetch(request({ operation: "create", credential: { type: "bearer_token", token: connection.token }, access: "read" }));
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: { code: "EXTERNAL_UNAVAILABLE", retrySafe: false } });
    });
    assert.equal(storage.size, 0);
  }
});

test("private Worker routes cnx_* management and runtime to the matching Durable Object", async () => {
  const seen = [];
  const env = {
    EXTERNAL_ADAPTER_SHARED_SECRET: "s".repeat(40),
    NOTION_CONNECTIONS: "{}",
    CONNECTIONS: {
      idFromName: (name) => name,
      get: (id) => ({
        fetch: async (_url, init) => {
          const body = JSON.parse(init.body);
          seen.push({ id, body });
          if (body.operation === "execute") return Response.json({ data: { read: true, write: false } });
          return Response.json({ data: { read: true, write: true } });
        },
      }),
    },
  };
  const worker = createWorker();
  const ref = "cnx_" + "b".repeat(32);
  const headers = { "content-type": "application/json", "x-lifespace-internal-secret": env.EXTERNAL_ADAPTER_SHARED_SECRET };
  const management = await worker.fetch(new Request("https://adapter.internal/internal/v1/external-connections", {
    method: "POST", headers, body: JSON.stringify({ contractVersion: 1, providerKey: "notion", credentialRef: ref, operation: "create", credential: { type: "bearer_token", token: "never-log" }, access: "write" }),
  }), env);
  assert.equal(management.status, 200);
  assert.equal((await management.text()).includes("never-log"), false);
  const runtime = await worker.fetch(new Request("https://adapter.internal/internal/v1/external-models", {
    method: "POST", headers, body: JSON.stringify({ contractVersion: 1, providerKey: "notion", credentialRef: ref, operation: "connection", resourceId: "connection" }),
  }), env);
  assert.deepEqual(await runtime.json(), { contractVersion: 1, data: { read: true, write: false } });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].id, ref);
  assert.equal(seen[0].body.operation, "create");
  assert.equal(seen[1].body.operation, "execute");
});
