// Consumes LifeSpace external-adapter contract v1. No LifeSpace ACL/storage.
export const NOTION_VERSION = "2025-09-03";
export class ProviderError extends Error {
  constructor(code, status = 503, retrySafe = false) {
    super(code);
    this.code = code;
    this.status = status;
    this.retrySafe = retrySafe;
  }
}
const fail = (code = "EXTERNAL_VALIDATION_FAILED", status = 422) => {
  throw new ProviderError(code, status, true);
};
const object = (v) => v && typeof v === "object" && !Array.isArray(v);
function keys(v, allowed) {
  if (!object(v) || Object.keys(v).some((k) => !allowed.includes(k))) fail();
}
export function uuid(value) {
  if (
    typeof value !== "string" ||
    !/^([a-fA-F0-9]{32}|[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})$/.test(
      value,
    )
  )
    fail();
  return value.replaceAll("-", "").toLowerCase();
}
const recordId = (resource, id) => `rec_external_${resource}_${uuid(id)}`;
function pageId(id, resource) {
  if (
    typeof id !== "string" ||
    !/^rec_external_[a-f0-9]{32}_[a-f0-9]{32}$/.test(id)
  )
    fail();
  if (id.slice(13, 45) !== resource) fail("EXTERNAL_RESOURCE_UNAVAILABLE", 404);
  return id.slice(46);
}
const text = (v) =>
  (v ?? []).map((x) => x.plain_text ?? x.text?.content ?? "").join("");
async function fieldKey(id) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id));
  return (
    "f_" +
    Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 32)
  );
}
const supported = {
  title: ["string", true, "eq", "ne", "contains", "isNull", "isNotNull"],
  rich_text: ["text", true, "eq", "ne", "contains", "isNull", "isNotNull"],
  number: [
    "number",
    true,
    "eq",
    "ne",
    "lt",
    "lte",
    "gt",
    "gte",
    "isNull",
    "isNotNull",
  ],
  checkbox: ["boolean", true, "eq", "ne"],
  select: ["enum", true, "eq", "ne", "isNull", "isNotNull"],
  status: ["enum", true, "eq", "ne", "isNull", "isNotNull"],
  url: ["string", true, "eq", "ne", "contains", "isNull", "isNotNull"],
  email: ["string", true, "eq", "ne", "contains", "isNull", "isNotNull"],
  phone_number: ["string", true, "eq", "ne", "contains", "isNull", "isNotNull"],
  created_time: ["instant", false, "eq", "lt", "lte", "gt", "gte"],
  last_edited_time: ["instant", false, "eq", "lt", "lte", "gt", "gte"],
};
export async function projectSchema(schema, connection) {
  const fields = [],
    codecs = {};
  for (const p of Object.values(schema.properties ?? {})) {
    const config = supported[p.type];
    if (
      !config ||
      typeof p.id !== "string" ||
      typeof p.name !== "string" ||
      !p.name.length
    )
      continue;
    const [type, writable, ...operators] = config;
    let values;
    if (type === "enum") {
      values = (p[p.type]?.options ?? []).map((o) => o.name);
      if (
        !values.length ||
        values.length > 50 ||
        values.some((v) => typeof v !== "string" || !v.length || v.length > 256)
      )
        continue;
    }
    const key = await fieldKey(p.id);
    fields.push({
      key,
      sourceFieldId: p.id,
      title: p.name,
      type,
      nullable: p.type !== "checkbox",
      readable: true,
      writable: writable && connection.write === true,
      operators,
      sortable: true,
      ...(values ? { values } : {}),
    });
    codecs[key] = { id: p.id, type: p.type };
  }
  fields.sort((a, b) => a.key.localeCompare(b.key));
  if (fields.length > 100) fail("EXTERNAL_CONTRACT_INVALID", 502);
  return {
    resourceId: uuid(schema.id),
    displayName: text(schema.title) || "External Data Source",
    fields,
    capabilities: {
      get: connection.read === true,
      query: connection.read === true,
      create: connection.write === true,
      update: connection.write === true,
      delete: connection.write === true,
      batchWrite: connection.write === true,
      atomicBatch: false,
      transaction: false,
      versionedWrite: false,
      actions: false,
      relationTargetResolution: false,
    },
    queryLimits: { maxDepth: 2, maxNodes: 100, maxSort: 8, maxPageSize: 100 },
    adapterState: { codecs },
  };
}
function validateValue(field, value) {
  if (value === null) {
    if (!field.nullable) fail();
    return;
  }
  if (field.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) fail();
    return;
  }
  if (field.type === "boolean") {
    if (typeof value !== "boolean") fail();
    return;
  }
  if (typeof value !== "string" || value.length > 200000) fail();
  if (field.type === "enum" && !field.values?.includes(value)) fail();
  if (
    field.type === "instant" &&
    (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      Number.isNaN(Date.parse(value)))
  )
    fail();
}
export function translateWrite(snapshot, input) {
  if (!object(input)) fail();
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    const f = snapshot.fields.find((x) => x.key === key);
    const codec = snapshot.adapterState.codecs[key];
    if (!f?.writable || !codec || !supported[codec.type]) fail();
    validateValue(f, value);
    let translated = value;
    if (codec.type === "title" || codec.type === "rich_text") {
      const s = value ?? "";
      translated = [];
      for (let i = 0; i < s.length; i += 2000)
        translated.push({
          type: "text",
          text: { content: s.slice(i, i + 2000) },
        });
    } else if (codec.type === "select" || codec.type === "status")
      translated = value === null ? null : { name: value };
    result[codec.id] = { [codec.type]: translated };
  }
  return result;
}
export function projectRecord(snapshot, page) {
  if (page.object !== "page" || page.in_trash || page.archived)
    fail("EXTERNAL_RESOURCE_UNAVAILABLE", 404);
  if (
    page.parent?.type !== "data_source_id" ||
    uuid(page.parent.data_source_id) !== snapshot.resourceId
  )
    fail("EXTERNAL_RESOURCE_UNAVAILABLE", 404);
  const byId = new Map(
    Object.values(page.properties ?? {}).map((p) => [p.id, p]),
  );
  const data = {};
  for (const field of snapshot.fields) {
    const codec = snapshot.adapterState.codecs[field.key];
    const p = byId.get(codec.id);
    if (!p || p.type !== codec.type)
      throw new ProviderError("EXTERNAL_SCHEMA_CHANGED", 409, true);
    const raw = p[p.type];
    let value;
    if (p.type === "title" || p.type === "rich_text") value = text(raw);
    else if (p.type === "select" || p.type === "status")
      value = raw?.name ?? null;
    else value = raw ?? null;
    try {
      validateValue(field, value);
    } catch {
      throw new ProviderError(
        field.type === "enum"
          ? "EXTERNAL_SCHEMA_CHANGED"
          : "EXTERNAL_CONTRACT_INVALID",
        field.type === "enum" ? 409 : 502,
        field.type === "enum",
      );
    }
    data[field.key] = value;
  }
  return {
    id: recordId(snapshot.resourceId, page.id),
    data,
    createdAt: page.created_time,
    updatedAt: page.last_edited_time,
  };
}
const opMap = {
  eq: "equals",
  ne: "does_not_equal",
  lt: "less_than",
  lte: "less_than_or_equal_to",
  gt: "greater_than",
  gte: "greater_than_or_equal_to",
  contains: "contains",
  isNull: "is_empty",
  isNotNull: "is_not_empty",
};
export function translateQuery(snapshot, input) {
  keys(input, ["filter", "sort", "page"]);
  const result = { page_size: input.page?.limit ?? 100 };
  if (
    !Number.isInteger(result.page_size) ||
    result.page_size < 1 ||
    result.page_size > 100
  )
    fail("EXTERNAL_QUERY_UNSUPPORTED");
  if (input.page !== undefined) {
    keys(input.page, ["limit", "cursor"]);
    if (input.page.cursor !== undefined) {
      if (
        typeof input.page.cursor !== "string" ||
        input.page.cursor.length > 2048
      )
        fail();
      result.start_cursor = input.page.cursor;
    }
  }
  let nodes = 0;
  function filter(v, depth = 0) {
    if (++nodes > 100 || depth > 2) fail("EXTERNAL_QUERY_UNSUPPORTED");
    if (object(v) && ("and" in v || "or" in v)) {
      if (depth >= 2) fail("EXTERNAL_QUERY_UNSUPPORTED");
      const mode = "and" in v ? "and" : "or";
      keys(v, [mode]);
      if (!Array.isArray(v[mode]) || v[mode].length < 1 || v[mode].length > 100)
        fail();
      return { [mode]: v[mode].map((x) => filter(x, depth + 1)) };
    }
    keys(v, ["field", "op", "value"]);
    const f = snapshot.fields.find((x) => x.key === v.field);
    const codec = snapshot.adapterState.codecs[v.field];
    if (!f || !f.operators.includes(v.op) || !codec)
      fail("EXTERNAL_QUERY_UNSUPPORTED");
    const isNull = v.op === "isNull" || v.op === "isNotNull";
    if (!isNull) {
      if (v.value === null) fail("EXTERNAL_QUERY_UNSUPPORTED");
      validateValue(f, v.value);
    } else if ("value" in v) fail();
    const isTime = ["created_time", "last_edited_time"].includes(codec.type);
    let op = opMap[v.op];
    if (isTime)
      op = {
        eq: "equals",
        ne: "does_not_equal",
        lt: "before",
        lte: "on_or_before",
        gt: "after",
        gte: "on_or_after",
      }[v.op];
    if (isTime)
      return { timestamp: codec.type, [codec.type]: { [op]: v.value } };
    return {
      property: codec.id,
      [codec.type]: { [op]: isNull ? true : v.value },
    };
  }
  if (input.filter !== undefined) result.filter = filter(input.filter);
  if (input.sort !== undefined) {
    if (!Array.isArray(input.sort) || input.sort.length > 8)
      fail("EXTERNAL_QUERY_UNSUPPORTED");
    result.sorts = input.sort.map((s) => {
      keys(s, ["field", "direction"]);
      const f = snapshot.fields.find((x) => x.key === s.field);
      const codec = snapshot.adapterState.codecs[s.field];
      if (!f?.sortable || !["asc", "desc"].includes(s.direction) || !codec)
        fail("EXTERNAL_QUERY_UNSUPPORTED");
      return {
        property: codec.id,
        direction: s.direction === "asc" ? "ascending" : "descending",
      };
    });
  }
  return result;
}
export function createNotionProvider({
  fetch: fetcher = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
  spacingMs = 350,
} = {}) {
  const lanes = new WeakMap();
  async function request(connection, method, path, body) {
    const lane = lanes.get(connection) ?? {
      next: 0,
      failures: 0,
      openUntil: 0,
      pending: 0,
    };
    lanes.set(connection, lane);
    if (lane.openUntil > now() || lane.pending >= 50)
      throw new ProviderError("EXTERNAL_UNAVAILABLE");
    lane.pending++;
    const read = method === "GET" || path.endsWith("/query");
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const at = Math.max(now(), lane.next);
        lane.next = at + spacingMs;
        await sleep(Math.max(0, at - now()));
        let response;
        try {
          response = await fetcher("https://api.notion.com/v1" + path, {
            method,
            headers: {
              authorization: "Bearer " + connection.token,
              "Notion-Version": NOTION_VERSION,
              "Notion-Beta": "status-group-filters-2026-10-06",
              "content-type": "application/json",
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(15000),
          });
        } catch {
          lane.failures++;
          if (lane.failures >= 5) lane.openUntil = now() + 30000;
          throw new ProviderError(
            read ? "EXTERNAL_UNAVAILABLE" : "EXTERNAL_WRITE_UNKNOWN",
            read ? 503 : 502,
          );
        }
        if (response.status === 429) {
          await response.body?.cancel();
          const seconds = Number(response.headers.get("retry-after") ?? 1);
          if (
            attempt === 2 ||
            !Number.isFinite(seconds) ||
            seconds < 0 ||
            seconds > 10
          )
            throw new ProviderError("EXTERNAL_RATE_LIMITED", 429, true);
          lane.next = Math.max(lane.next, now() + seconds * 1000);
          continue;
        }
        if (response.status >= 500) {
          await response.body?.cancel();
          lane.failures++;
          if (lane.failures >= 5) lane.openUntil = now() + 30000;
          if (read && attempt < 2) {
            await sleep(250 * 2 ** attempt);
            continue;
          }
          throw new ProviderError(
            read ? "EXTERNAL_UNAVAILABLE" : "EXTERNAL_WRITE_UNKNOWN",
            read ? 503 : 502,
          );
        }
        if (!response.ok) {
          const raw = await response.json().catch(() => ({}));
          if (response.status === 401 || response.status === 403)
            throw new ProviderError("EXTERNAL_ACCESS_DENIED", 503, true);
          if (response.status === 404)
            throw new ProviderError("EXTERNAL_RESOURCE_UNAVAILABLE", 404, true);
          if (response.status === 400 && raw.code === "validation_error")
            throw new ProviderError("EXTERNAL_SCHEMA_CHANGED", 409, true);
          throw new ProviderError("EXTERNAL_VALIDATION_FAILED", 422, true);
        }
        lane.failures = 0;
        const raw = await response.json().catch(() => null);
        if (!object(raw))
          throw new ProviderError(
            read ? "EXTERNAL_CONTRACT_INVALID" : "EXTERNAL_WRITE_UNKNOWN",
            502,
          );
        return raw;
      }
    } finally {
      lane.pending--;
    }
  }
  return {
    async execute(connection, requestInput) {
      keys(requestInput, [
        "contractVersion",
        "providerKey",
        "credentialRef",
        "operation",
        "resourceId",
        "snapshot",
        "input",
        "recordId",
      ]);
      if (
        requestInput.contractVersion !== 1 ||
        requestInput.providerKey !== "notion"
      )
        fail("EXTERNAL_CONTRACT_INVALID", 502);
      const { operation, snapshot, input = {}, recordId: id } = requestInput;
      if (operation === "connection")
        return {
          read: connection.read === true,
          write: connection.write === true,
        };
      const resource = uuid(requestInput.resourceId);
      const write = ["create", "update", "delete"].includes(operation);
      if (!connection.read || (write && !connection.write))
        throw new ProviderError("EXTERNAL_ACCESS_DENIED", 503, true);
      if (operation === "discover") {
        let schema;
        try {
          schema = await request(
            connection,
            "GET",
            "/data_sources/" + resource,
          );
        } catch (error) {
          if (error.code !== "EXTERNAL_RESOURCE_UNAVAILABLE") throw error;
          const db = await request(connection, "GET", "/databases/" + resource);
          if (!Array.isArray(db.data_sources) || db.data_sources.length !== 1)
            fail();
          schema = await request(
            connection,
            "GET",
            "/data_sources/" + uuid(db.data_sources[0].id),
          );
        }
        return projectSchema(schema, connection);
      }
      if (
        !object(snapshot) ||
        snapshot.resourceId !== resource ||
        !Array.isArray(snapshot.fields) ||
        !object(snapshot.adapterState?.codecs)
      )
        fail("EXTERNAL_CONTRACT_INVALID", 502);
      if (operation === "query") {
        const result = await request(
          connection,
          "POST",
          "/data_sources/" + resource + "/query",
          translateQuery(snapshot, input),
        );
        if (!Array.isArray(result.results) || result.results.length > 100)
          fail("EXTERNAL_CONTRACT_INVALID", 502);
        return {
          items: result.results.map((p) => projectRecord(snapshot, p)),
          nextCursor: result.has_more ? result.next_cursor : null,
        };
      }
      if (operation === "create") {
        const raw = await request(connection, "POST", "/pages", {
          parent: { type: "data_source_id", data_source_id: resource },
          properties: translateWrite(snapshot, input),
        });
        try {
          return projectRecord(snapshot, raw);
        } catch {
          throw new ProviderError("EXTERNAL_WRITE_UNKNOWN", 502, false);
        }
      }
      if (!["get", "update", "delete"].includes(operation)) fail();
      const page = await request(
        connection,
        "GET",
        "/pages/" + pageId(id, resource),
      );
      if (operation === "get") return projectRecord(snapshot, page);
      // Verify source membership before PATCH, without interpreting stale scalar codecs.
      if (
        page.in_trash ||
        page.archived ||
        page.parent?.type !== "data_source_id" ||
        uuid(page.parent.data_source_id) !== resource
      )
        fail("EXTERNAL_RESOURCE_UNAVAILABLE", 404);
      if (operation === "delete") {
        await request(connection, "PATCH", "/pages/" + pageId(id, resource), {
          in_trash: true,
        });
        return { id };
      }
      const updated = await request(
        connection,
        "PATCH",
        "/pages/" + pageId(id, resource),
        { properties: translateWrite(snapshot, input) },
      );
      try {
        return projectRecord(snapshot, updated);
      } catch {
        throw new ProviderError("EXTERNAL_WRITE_UNKNOWN", 502, false);
      }
    },
  };
}
