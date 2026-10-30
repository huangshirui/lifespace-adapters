import { test } from "node:test";
import assert from "node:assert/strict";
import { createFeishuProvider, publicRecordId, providerRecordId, ProviderError } from "../src/provider.mjs";
import { FeishuConnectionVault } from "../src/connection-vault.mjs";
import { createWorker } from "../src/worker.mjs";

const base = "bascnSyntheticBase01", table = "tblSynthetic01", row = "recSynthetic01";
const resource = base + ":" + table;
const connection = { appId: "cli_synthetic00001", appSecret: "synthetic_secret_00001", base, read: true, write: true };
const credential = { type: "feishu_app", token: connection.appId + "|" + connection.appSecret + "|" + base };
const fields = [
  { field_id: "fldSyntheticName", field_name: "Name", type: 1 },
  { field_id: "fldSyntheticAmount", field_name: "Amount", type: 2 },
  { field_id: "fldSyntheticStatus", field_name: "Status", type: 3, property: { options: [{ name: "Open" }, { name: "Done" }] } },
  { field_id: "fldSyntheticTags", field_name: "Tags", type: 4, property: { options: [{ name: "A" }, { name: "B" }] } },
  { field_id: "fldSyntheticBool", field_name: "Active", type: 7 },
  { field_id: "fldSyntheticPerson", field_name: "Owner", type: 11 },
  { field_id: "fldSyntheticFormula", field_name: "Formula", type: 20 },
];
const feishuRow = { record_id: row, created_time: 1760000000000, last_modified_time: 1760000001000, fields: {
  Name: [{ text: "Synthetic" }], Amount: 4, Status: "Open", Tags: ["A"], Active: true,
} };
const ok = data => Response.json({ code: 0, msg: "success", data });
function makeFetch(log) {
  return async (rawUrl, init = {}) => {
    const url = new URL(rawUrl);
    log.push({ url, init });
    if (url.hostname === "accounts.feishu.cn") {
      assert.equal(init.method, "POST");
      const payload = JSON.parse(init.body);
      assert.equal(payload.grant_type, "client_credentials");
      assert.equal(payload.client_secret, connection.appSecret);
      return Response.json({ access_token: "synthetic-short-lived-token", expires_in: 3600 });
    }
    assert.equal(init.headers.authorization, "Bearer synthetic-short-lived-token");
    if (url.pathname.endsWith("/tables")) return ok({ items: [{ table_id: table, name: "Synthetic Table" }], has_more: false });
    if (url.pathname.endsWith("/fields")) return ok({ items: fields, has_more: false });
    if (url.pathname.endsWith("/records") && init.method === "GET") return ok({ items: [feishuRow], has_more: false });
    if (url.pathname.endsWith("/records") && init.method === "POST") return ok({ record: feishuRow });
    if (url.pathname.endsWith("/records/" + row) && init.method === "GET") return ok({ record: feishuRow });
    if (url.pathname.endsWith("/records/" + row) && init.method === "PUT") return ok({ record: feishuRow });
    if (url.pathname.endsWith("/records/" + row) && init.method === "DELETE") return ok({ deleted: true });
    throw new Error("Unexpected endpoint: " + url.pathname);
  };
}
const command = (operation, extra = {}) => ({
  contractVersion: 1, providerKey: "feishu", credentialRef: "cnx_" + "a".repeat(32),
  resourceId: resource, operation, ...extra,
});
async function discover(p) { return p.execute(connection, command("discover")); }
test("per-table stable IDs never collide and cannot be used in another table", async () => {
  const id = await publicRecordId(resource, row);
  assert.match(id, /^rec_external_[0-9a-f]{32}_recSynthetic01$/);
  assert.equal(await providerRecordId(resource, id), row);
  const other = base + ":tblSynthetic02";
  assert.notEqual(await publicRecordId(other, row), id);
  await assert.rejects(providerRecordId(other, id), { code: "EXTERNAL_RESOURCE_UNAVAILABLE" });
});
test("resource listing and schema projection preserve sourceFieldId, omit unsupported types", async () => {
  const log = [], p = createFeishuProvider({ fetch: makeFetch(log) });
  const listed = await p.listConnectionResources(connection);
  assert.deepEqual(listed, { items: [{ id: resource, type: "table", displayName: "Synthetic Table" }], nextCursor: null });
  const s = await discover(p);
  assert.equal(s.fields.length, 5);
  assert(s.fields.every(x => x.operators.length === 0 && x.sortable === false));
  assert(s.fields.every(x => x.sourceFieldId.startsWith("fld")));
  assert.equal(s.capabilities.atomicBatch, false);
  assert.equal(s.capabilities.versionedWrite, false);
  assert.equal(s.fields.find(x => x.title === "Tags").nullable, false);
  assert.equal(s.fields.find(x => x.title === "Status").type, "enum");
  assert.equal(log.some(x => x.url.pathname.endsWith("/fields")), true);
});
test("read, pagination, create, update and delete use table-scoped API with canonical keys", async () => {
  const log = [], p = createFeishuProvider({ fetch: makeFetch(log) });
  const snapshot = await discover(p);
  const result = await p.execute(connection, command("query", { snapshot, input: { page: { limit: 30 } } }));
  assert.equal(result.items.length, 1);
  assert.equal(result.nextCursor, null);
  const id = result.items[0].id;
  assert.equal(result.items[0].data[snapshot.fields.find(x => x.title === "Name").key], "Synthetic");
  assert.deepEqual(result.items[0].data[snapshot.fields.find(x => x.title === "Tags").key], ["A"]);
  assert.equal("version" in result.items[0], false);
  assert.equal((await p.execute(connection, command("get", { snapshot, recordId: id }))).id, id);
  const amount = snapshot.fields.find(x => x.title === "Amount");
  assert.equal((await p.execute(connection, command("create", { snapshot, input: { [amount.key]: 8 } }))).id, id);
  assert.equal((await p.execute(connection, command("update", { snapshot, recordId: id, input: { [amount.key]: 9 } }))).id, id);
  assert.deepEqual(await p.execute(connection, command("delete", { snapshot, recordId: id })), { id });
  const creates = log.filter(x => x.init.method === "POST" && x.url.pathname.endsWith("/records"));
  assert.deepEqual(JSON.parse(creates[0].init.body), { fields: { Amount: 8 } });
  assert.equal(log.some(x => x.init.method === "DELETE" && x.url.pathname.endsWith("/records/" + row)), true);
});
test("wrong base, unsupported filters, invalid enum writes and read-only writes fail closed", async () => {
  const log = [], p = createFeishuProvider({ fetch: makeFetch(log) });
  const snapshot = await discover(p);
  await assert.rejects(p.execute(connection, command("query", { snapshot, input: { filter: { field: "x", op: "eq", value: 1 } } })), { code: "EXTERNAL_QUERY_UNSUPPORTED" });
  const status = snapshot.fields.find(x => x.title === "Status");
  await assert.rejects(p.execute(connection, command("create", { snapshot, input: { [status.key]: "Unknown" } })), ProviderError);
  await assert.rejects(p.execute({ ...connection, write: false }, command("create", { snapshot, input: {} })), { code: "EXTERNAL_ACCESS_DENIED" });
  const before = log.length;
  await assert.rejects(p.execute(connection, command("discover", { resourceId: "bascnOtherBase01:" + table })), { code: "EXTERNAL_RESOURCE_UNAVAILABLE" });
  assert.equal(log.length, before);
});
test("transport/timeouts after a write are never reported retry-safe", async () => {
  const p = createFeishuProvider({ fetch: async (url, init) => {
    if (String(url).includes("oauth")) return Response.json({ access_token: "short-term", expires_in: 10 });
    if (init.method === "POST") throw Error("synthetic network ambiguity");
    return ok({ items: [] });
  } });
  await assert.rejects(p.execute(connection, command("create", { snapshot: {
    resourceId: resource, fields: [], adapterState: { codecs: {} },
  }, input: {} })), { code: "EXTERNAL_WRITE_UNKNOWN", retrySafe: false });
});
function memoryState() {
  const map = new Map();
  return { map, state: { storage: {
    get: async key => map.get(key), put: async (key, value) => map.set(key, value),
    deleteAll: async () => map.clear(),
  } } };
}
const vaultReq = body => new Request("https://vault.internal/", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
test("vault stores encrypted envelope, rejects bad key and cannot rotate across bases", async () => {
  const globalFetch = globalThis.fetch;
  globalThis.fetch = makeFetch([]);
  try {
    const { map, state } = memoryState();
    const vault = new FeishuConnectionVault(state, { CONNECTION_VAULT_MASTER_KEY: "11".repeat(32) });
    const created = await vault.fetch(vaultReq({ operation: "create", credential, access: "write" }));
    assert.equal(created.status, 200);
    const stored = map.get("connection");
    assert.deepEqual(Object.keys(stored).sort(), ["algorithm", "ciphertext", "iv", "version"]);
    assert(!JSON.stringify(stored).includes(connection.appSecret));
    const updated = await vault.fetch(vaultReq({ operation: "update",
      credential: { type: "feishu_app", token: connection.appId + "|" + connection.appSecret + "|bascnDifferentBase1" } }));
    assert.equal(updated.status, 422);
    assert.equal((await vault.fetch(vaultReq({ operation: "execute", request: command("connection") }))).status, 200);
    const wrong = new FeishuConnectionVault(state, { CONNECTION_VAULT_MASTER_KEY: "22".repeat(32) });
    assert.equal((await wrong.fetch(vaultReq({ operation: "execute", request: command("connection") }))).status, 503);
    assert.equal((await vault.fetch(vaultReq({ operation: "delete" }))).status, 200);
    assert.equal(map.size, 0);
  } finally { globalThis.fetch = globalFetch; }
});
test("private worker requires Core secret and never sends credential to output", async () => {
  const seen = [];
  const env = {
    EXTERNAL_ADAPTER_SHARED_SECRET: "s".repeat(40),
    CONNECTIONS: { idFromName: id => id, get: id => ({ fetch: async (_url, init) => {
      seen.push({ id, body: JSON.parse(init.body) });
      return Response.json({ data: { read: true, write: false } });
    } }) },
  };
  const worker = createWorker(), ref = "cnx_" + "b".repeat(32);
  const url = "https://private.internal/internal/v1/external-connections";
  const message = { contractVersion: 1, providerKey: "feishu", credentialRef: ref, operation: "create", credential, access: "read" };
  const denied = await worker.fetch(new Request(url, { method: "POST", body: JSON.stringify(message) }), env);
  assert.equal(denied.status, 401);
  const authorized = await worker.fetch(new Request(url, {
    method: "POST", headers: { "x-lifespace-internal-secret": env.EXTERNAL_ADAPTER_SHARED_SECRET }, body: JSON.stringify(message),
  }), env);
  assert.equal(authorized.status, 200);
  assert(!(await authorized.text()).includes(connection.appSecret));
  assert.equal(seen[0].id, ref);
});


test("Feishu omitted empty cells map to null, [] and false without schema-change errors", async () => {
  const p = createFeishuProvider({ fetch: async (url, init) => {
    const address = String(url);
    if (address.includes("/oauth/v3/token")) return Response.json({ access_token: "mock-token" });
    if (address.endsWith("/tables?page_size=100")) return ok({ items: [{ table_id: table, name: "Synthetic Table" }] });
    if (address.includes("/fields?")) return ok({ items: fields, has_more: false });
    if (address.includes("/records?")) {
      return ok({ items: [{ record_id: row, fields: { Name: "Only Name" } }], has_more: false });
    }
    throw Error("unrecognized synthetic request: " + address);
  } });
  const snapshot = await discover(p);
  const result = await p.execute(connection, command("query", { snapshot }));
  const values = result.items[0].data;
  for (const field of snapshot.fields) {
    const expected = field.type === "enum_list" ? [] : field.type === "boolean" ? false : field.type === "text" ? "Only Name" : null;
    assert.deepEqual(values[field.key], expected);
  }
});
