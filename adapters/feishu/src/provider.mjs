// Feishu Bitable provider for LifeSpace External Adapter contract v1.
// Source-of-truth for authority, bindings and field keys remains LifeSpace Core.
export class ProviderError extends Error {
  constructor(code, status = 503, retrySafe = false) {
    super(code);
    this.code = code; this.status = status; this.retrySafe = retrySafe;
  }
}
const bad = (code = "EXTERNAL_VALIDATION_FAILED", status = 422) => { throw new ProviderError(code, status, true); };
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const only = (v, allowed) => {
  if (!object(v) || Object.keys(v).some(k => !allowed.includes(k))) bad();
};
const tokenId = v => typeof v === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(v);
export function parseResource(value) {
  if (typeof value !== "string" || value.split(":").length !== 2) bad();
  const [base, table] = value.split(":");
  if (!tokenId(base) || !/^tbl[A-Za-z0-9_-]{5,77}$/.test(table)) bad();
  return { base, table };
}
const pathFor = (r) => "/bitable/v1/apps/" + encodeURIComponent(r.base) + "/tables/" + encodeURIComponent(r.table);
const iso = v => {
  if (v === undefined || v === null) return undefined;
  const date = new Date(typeof v === "number" || /^\d{13}$/.test(String(v)) ? Number(v) : v);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
};
async function hash(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
export const resourceNamespace = async resource => (await hash("feishu:bitable:" + resource)).slice(0, 32);
export async function publicRecordId(resource, providerRowId) {
  if (!tokenId(providerRowId)) bad("EXTERNAL_CONTRACT_INVALID", 502);
  return "rec_external_" + await resourceNamespace(resource) + "_" + providerRowId;
}
export async function providerRecordId(resource, publicId) {
  const prefix = "rec_external_" + await resourceNamespace(resource) + "_";
  if (typeof publicId !== "string" || !publicId.startsWith(prefix) || !tokenId(publicId.slice(prefix.length))) {
    bad("EXTERNAL_RESOURCE_UNAVAILABLE", 404);
  }
  return publicId.slice(prefix.length);
}
const baseUrl = "https://open.feishu.cn/open-apis";
function codeError(status, code, mutating) {
  if (status === 429 || code === 1254290 || code === 1254291) return new ProviderError("EXTERNAL_RATE_LIMITED", 429, !mutating);
  if (status === 401 || status === 403 || code === 99991663 || code === 99991668 || code === 1254302) return new ProviderError("EXTERNAL_ACCESS_DENIED", 503, true);
  if (status === 404 || [1254040, 1254041, 1254043].includes(code)) return new ProviderError("EXTERNAL_RESOURCE_UNAVAILABLE", 404, true);
  if ([1254003, 1254004, 1254005, 1254009, 1254015].includes(code)) return new ProviderError("EXTERNAL_SCHEMA_CHANGED", 409, true);
  if (status >= 500 || code === 1255001 || code === 1255040) return new ProviderError(mutating ? "EXTERNAL_WRITE_UNKNOWN" : "EXTERNAL_UNAVAILABLE", mutating ? 502 : 503, false);
  return new ProviderError("EXTERNAL_VALIDATION_FAILED", 422, true);
}
export function createFeishuProvider({ fetch: fetcher = fetch } = {}) {
  async function accessToken(connection) {
    let response;
    try {
      response = await fetcher("https://accounts.feishu.cn/oauth/v3/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant_type: "client_credentials", client_id: connection.appId, client_secret: connection.appSecret }),
        signal: AbortSignal.timeout(15000),
      });
    } catch { throw new ProviderError("EXTERNAL_UNAVAILABLE", 503, true); }
    const payload = await response.json().catch(() => null);
    if (!response.ok || !object(payload) || typeof payload.access_token !== "string" || !payload.access_token) {
      throw codeError(response.status, payload?.code, false);
    }
    return payload.access_token;
  }
  async function api(token, method, path, body) {
    const mutating = method !== "GET";
    let response;
    try {
      response = await fetcher(baseUrl + path, {
        method,
        headers: { authorization: "Bearer " + token, "content-type": "application/json; charset=utf-8" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
      });
    } catch { throw new ProviderError(mutating ? "EXTERNAL_WRITE_UNKNOWN" : "EXTERNAL_UNAVAILABLE", mutating ? 502 : 503, false); }
    const payload = await response.json().catch(() => null);
    if (!object(payload)) throw new ProviderError(mutating ? "EXTERNAL_WRITE_UNKNOWN" : "EXTERNAL_CONTRACT_INVALID", 502, false);
    if (!response.ok || payload.code !== 0) throw codeError(response.status, payload.code, mutating);
    if (!object(payload.data)) throw new ProviderError(mutating ? "EXTERNAL_WRITE_UNKNOWN" : "EXTERNAL_CONTRACT_INVALID", 502, false);
    return payload.data;
  }
  async function tables(token, base, pageSize = 50, cursor = null) {
    const q = new URLSearchParams({ page_size: String(pageSize) });
    if (cursor) q.set("page_token", cursor);
    return api(token, "GET", "/bitable/v1/apps/" + encodeURIComponent(base) + "/tables?" + q);
  }
  async function listConnectionResources(connection, input = {}) {
    only(input, ["limit", "cursor", "query"]);
    const limit = input.limit ?? 50;
    const cursor = input.cursor ?? null;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (cursor !== null && (typeof cursor !== "string" || cursor.length > 2048))) bad();
    if (input.query !== undefined && input.query !== "") bad("EXTERNAL_QUERY_UNSUPPORTED");
    const token = await accessToken(connection);
    const data = await tables(token, connection.base, limit, cursor);
    if (!Array.isArray(data.items)) bad("EXTERNAL_CONTRACT_INVALID", 502);
    return {
      items: data.items.map(row => {
        if (!tokenId(row.table_id)) bad("EXTERNAL_CONTRACT_INVALID", 502);
        return { id: connection.base + ":" + row.table_id, type: "table", displayName: String(row.name ?? "Untitled table").slice(0, 200) };
      }),
      nextCursor: data.has_more === true && typeof data.page_token === "string" ? data.page_token : null,
    };
  }
  async function validateConnectionCredential(connection) {
    const token = await accessToken(connection);
    const result = await tables(token, connection.base, 1);
    if (!Array.isArray(result.items)) bad("EXTERNAL_CONTRACT_INVALID", 502);
    return { read: true, write: connection.write === true };
  }
  const mapping = new Map([
    [1, ["text", true]], [2, ["number", true]], [3, ["enum", true]],
    [4, ["enum_list", true]], [7, ["boolean", true]],
  ]);
  async function projectSchema(token, resource, connection) {
    const r = parseResource(resource);
    if (r.base !== connection.base) bad("EXTERNAL_RESOURCE_UNAVAILABLE", 404);
    const meta = await tables(token, r.base, 100);
    const entry = Array.isArray(meta.items) ? meta.items.find(x => x.table_id === r.table) : null;
    if (!entry) bad("EXTERNAL_RESOURCE_UNAVAILABLE", 404);
    let cursor = null, iterations = 0;
    const rawFields = [];
    do {
      if (++iterations > 5) bad("EXTERNAL_CONTRACT_INVALID", 502);
      const q = new URLSearchParams({ page_size: "100" });
      if (cursor) q.set("page_token", cursor);
      const page = await api(token, "GET", pathFor(r) + "/fields?" + q);
      if (!Array.isArray(page.items)) bad("EXTERNAL_CONTRACT_INVALID", 502);
      rawFields.push(...page.items);
      cursor = page.has_more === true ? page.page_token : null;
      if (cursor !== null && (typeof cursor !== "string" || cursor.length > 2048)) bad("EXTERNAL_CONTRACT_INVALID", 502);
    } while (cursor);
    const fields = [], codecs = {};
    for (const raw of rawFields) {
      const spec = mapping.get(raw.type);
      if (!spec || !tokenId(raw.field_id) || typeof raw.field_name !== "string" || !raw.field_name) continue;
      const [type, providerWritable] = spec;
      let values;
      if (type === "enum" || type === "enum_list") {
        values = raw.property?.options?.map(x => x.name);
        if (!Array.isArray(values) || !values.length || values.length > 50 || values.some(v => typeof v !== "string" || !v || v.length > 256) || new Set(values).size !== values.length) continue;
      }
      const sourceFieldId = raw.field_id;
      const key = "field" + (await hash("feishu:field:" + sourceFieldId)).slice(0, 12);
      fields.push({
        key, sourceFieldId, title: raw.field_name,
        type, nullable: type !== "boolean" && type !== "enum_list",
        readable: true, writable: providerWritable && connection.write === true,
        operators: [], sortable: false, ...(values ? { values } : {}),
      });
      codecs[sourceFieldId] = { id: sourceFieldId, name: raw.field_name, type: raw.type };
    }
    if (fields.length > 100 || !fields.length || new Set(fields.map(f => f.title)).size !== fields.length) bad("EXTERNAL_CONTRACT_INVALID", 502);
    fields.sort((a, b) => a.key.localeCompare(b.key));
    return {
      resourceId: resource, displayName: String(entry.name ?? "Bitable table").slice(0, 200),
      fields,
      capabilities: { get: true, query: true, create: connection.write, update: connection.write, delete: connection.write,
        batchWrite: connection.write, atomicBatch: false, transaction: false, versionedWrite: false,
        actions: false, relationTargetResolution: false },
      queryLimits: { maxDepth: 1, maxNodes: 1, maxSort: 1, maxPageSize: 100 },
      adapterState: { codecs },
    };
  }
  function codecFor(snapshot, field) {
    const codec = snapshot.adapterState?.codecs?.[field.sourceFieldId];
    if (!object(codec) || !tokenId(codec.id) || typeof codec.name !== "string" || !mapping.has(codec.type) ||
        codec.id !== field.sourceFieldId || mapping.get(codec.type)[0] !== field.type) bad("EXTERNAL_CONTRACT_INVALID", 502);
    return codec;
  }
  function textValue(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "string") return v;
    if (Array.isArray(v) && v.every(x => typeof x === "string" || (object(x) && typeof x.text === "string"))) {
      return v.map(x => typeof x === "string" ? x : x.text).join("");
    }
    bad("EXTERNAL_SCHEMA_CHANGED", 409);
  }
  function canonicalValue(field, v) {
    if (field.type === "text") return textValue(v);
    if (field.type === "enum_list") {
      if (v === null || v === undefined) return [];
      if (!Array.isArray(v) || v.some(x => typeof x !== "string" || !field.values?.includes(x))) bad("EXTERNAL_SCHEMA_CHANGED", 409);
      return v;
    }
    if (v === null || v === undefined) return field.type === "boolean" ? false : null;
    if (field.type === "number" && (typeof v !== "number" || !Number.isFinite(v))) bad("EXTERNAL_SCHEMA_CHANGED", 409);
    if (field.type === "boolean" && typeof v !== "boolean") bad("EXTERNAL_SCHEMA_CHANGED", 409);
    if (field.type === "enum" && (typeof v !== "string" || !field.values?.includes(v))) bad("EXTERNAL_SCHEMA_CHANGED", 409);
    return v;
  }
  async function projectRecord(snapshot, row) {
    if (!object(row) || !object(row.fields)) bad("EXTERNAL_CONTRACT_INVALID", 502);
    const data = {};
    for (const field of snapshot.fields) {
      const codec = codecFor(snapshot, field);
      if (!Object.hasOwn(row.fields, codec.name)) bad("EXTERNAL_SCHEMA_CHANGED", 409);
      data[field.key] = canonicalValue(field, row.fields[codec.name]);
    }
    const createdAt = iso(row.created_time), updatedAt = iso(row.last_modified_time);
    return { id: await publicRecordId(snapshot.resourceId, row.record_id), data,
      ...(createdAt ? { createdAt } : {}), ...(updatedAt ? { updatedAt } : {}) };
  }
  function translateWrite(snapshot, input) {
    if (!object(input)) bad();
    const fields = {};
    for (const [key, value] of Object.entries(input)) {
      const field = snapshot.fields.find(x => x.key === key);
      if (!field?.writable) bad();
      const codec = codecFor(snapshot, field);
      if (value === null) { if (!field.nullable) bad(); }
      else if (field.type === "text" && (typeof value !== "string" || value.length > 100000)) bad();
      else if (field.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) bad();
      else if (field.type === "boolean" && typeof value !== "boolean") bad();
      else if (field.type === "enum" && (typeof value !== "string" || !field.values?.includes(value))) bad();
      else if (field.type === "enum_list" &&
        (!Array.isArray(value) || value.some(x => typeof x !== "string" || !field.values?.includes(x)) || new Set(value).size !== value.length)) bad();
      fields[codec.name] = value;
    }
    return fields;
  }
  async function execute(connection, req) {
    only(req, ["contractVersion", "providerKey", "credentialRef", "operation", "resourceId", "snapshot", "input", "recordId"]);
    if (req.contractVersion !== 1 || req.providerKey !== "feishu" || !tokenId(connection.base)) bad("EXTERNAL_CONTRACT_INVALID", 502);
    if (req.operation === "connection") return { read: true, write: connection.write === true };
    const resource = parseResource(req.resourceId);
    if (resource.base !== connection.base) bad("EXTERNAL_RESOURCE_UNAVAILABLE", 404);
    const write = ["create", "update", "delete", "upload"].includes(req.operation);
    if (write && !connection.write) throw new ProviderError("EXTERNAL_ACCESS_DENIED", 503, true);
    const token = await accessToken(connection);
    if (req.operation === "discover") return projectSchema(token, req.resourceId, connection);
    const snapshot = req.snapshot;
    if (!object(snapshot) || snapshot.resourceId !== req.resourceId || !Array.isArray(snapshot.fields) ||
        !object(snapshot.adapterState?.codecs)) bad("EXTERNAL_CONTRACT_INVALID", 502);
    const root = pathFor(resource) + "/records";
    if (req.operation === "query") {
      const input = req.input ?? {};
      only(input, ["filter", "sort", "page"]);
      if (input.filter !== undefined || (input.sort !== undefined && (!Array.isArray(input.sort) || input.sort.length))) bad("EXTERNAL_QUERY_UNSUPPORTED");
      if (input.page !== undefined) only(input.page, ["limit", "cursor"]);
      const limit = input.page?.limit ?? 100, cursor = input.page?.cursor;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (cursor !== undefined && (typeof cursor !== "string" || cursor.length > 2048))) bad("EXTERNAL_QUERY_UNSUPPORTED");
      const qs = new URLSearchParams({ page_size: String(limit) });
      if (cursor) qs.set("page_token", cursor);
      const result = await api(token, "GET", root + "?" + qs);
      if (!Array.isArray(result.items) || result.items.length > limit) bad("EXTERNAL_CONTRACT_INVALID", 502);
      return { items: await Promise.all(result.items.map(row => projectRecord(snapshot, row))),
        nextCursor: result.has_more === true && typeof result.page_token === "string" ? result.page_token : null };
    }
    if (req.operation === "create") {
      const fields = translateWrite(snapshot, req.input ?? {});
      const result = await api(token, "POST", root, { fields });
      try { return await projectRecord(snapshot, result.record); }
      catch { throw new ProviderError("EXTERNAL_WRITE_UNKNOWN", 502, false); }
    }
    if (!["get", "update", "delete"].includes(req.operation)) bad("EXTERNAL_QUERY_UNSUPPORTED");
    const rowId = await providerRecordId(req.resourceId, req.recordId);
    const rowPath = root + "/" + encodeURIComponent(rowId);
    // The table-scoped GET prevents cross-resource use of a recordId before mutation.
    const previous = await api(token, "GET", rowPath);
    if (req.operation === "get") return projectRecord(snapshot, previous.record);
    if (!object(previous.record) || previous.record.record_id !== rowId) bad("EXTERNAL_RESOURCE_UNAVAILABLE", 404);
    if (req.operation === "delete") {
      await api(token, "DELETE", rowPath);
      return { id: req.recordId };
    }
    const fields = translateWrite(snapshot, req.input ?? {});
    const result = await api(token, "PUT", rowPath, { fields });
    try { return await projectRecord(snapshot, result.record); }
    catch { throw new ProviderError("EXTERNAL_WRITE_UNKNOWN", 502, false); }
  }
  return { execute, validateConnectionCredential, listConnectionResources };
}
