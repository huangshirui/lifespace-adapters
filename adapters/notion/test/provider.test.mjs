import { test } from "node:test";
import assert from "node:assert/strict";
import {
  projectSchema,
  translateQuery,
  translateWrite,
  projectRecord,
  createNotionProvider,
  ProviderError,
} from "../src/provider.mjs";
import { createWorker } from "../src/worker.mjs";
const resource = "10000000000000000000000000000001",
  page = "20000000000000000000000000000001";
const connection = { token: "synthetic-test-only", read: true, write: true };
const schema = {
  id: resource,
  title: [{ plain_text: "Synthetic records" }],
  properties: {
    Name: { id: "title", name: "Name", type: "title", description: "Primary label" },
    Amount: { id: "num", name: "Amount", type: "number" },
    Formula: { id: "formula", name: "Hidden formula", type: "formula" },
    Files: { id: "files", name: "Attachments", type: "files" },
    Person: { id: "people", name: "Hidden people", type: "people" },
    When: { id: "date", name: "Start Date", type: "date" },
  },
};
const record = {
  object: "page",
  id: page,
  parent: { type: "data_source_id", data_source_id: resource },
  properties: {
    Name: { id: "title", type: "title", title: [{ plain_text: "One" }] },
    Amount: { id: "num", type: "number", number: 4 },
    Files: { id: "files", type: "files", files: [] },
    When: { id: "date", type: "date", date: null },
  },
  created_time: "2026-01-01T00:00:00Z",
  last_edited_time: "2026-01-01T00:00:00Z",
};
const reply = (body, status = 200, headers = {}) =>
  Response.json(body, { status, headers });
const input = (operation, snapshot, extra = {}) => ({
  contractVersion: 1,
  providerKey: "notion",
  credentialRef: "test_ref",
  resourceId: resource,
  operation,
  ...(snapshot ? { snapshot } : {}),
  ...extra,
});
test("only supported types survive and source identity remains stable across provider rename/type changes", async () => {
  const first = await projectSchema(schema, connection);
  assert.equal(first.fields.length, 4);
  assert.equal(first.fields.some((field) => field.sourceFieldId === "formula"), false);
  assert.equal(first.fields.some((field) => field.sourceFieldId === "people"), false);
  assert.equal(first.fields.find((field) => field.sourceFieldId === "title").description, "Primary label");
  const changed = structuredClone(schema);
  changed.properties.Amount.name = "Renamed";
  changed.properties.Amount.type = "rich_text";
  const next = await projectSchema(changed, connection);
  const a = first.fields.find((f) => f.sourceFieldId === "num"),
    b = next.fields.find((f) => f.sourceFieldId === "num");
  assert.equal(a.key, b.key);
  assert.equal(b.type, "text");
  assert.equal(b.title, "Renamed");
  assert.equal(next.capabilities.atomicBatch, false);
});
test("enum projection follows the canonical 50-value bound", async () => {
  const withSelect = structuredClone(schema);
  withSelect.properties.Status = {
    id: "status",
    name: "Status",
    type: "select",
    select: { options: Array.from({ length: 50 }, (_, index) => ({ name: `v${index}` })) },
  };
  const accepted = await projectSchema(withSelect, connection);
  assert(accepted.fields.some((field) => field.sourceFieldId === "status"));
  withSelect.properties.Status.select.options.push({ name: "v50" });
  const rejected = await projectSchema(withSelect, connection);
  assert.equal(rejected.fields.some((field) => field.sourceFieldId === "status"), false);
});
test("Notion date is a Start Date projection for point, time and range values", async () => {
  const s = await projectSchema(schema, connection);
  const date = s.fields.find((field) => field.sourceFieldId === "date");
  assert.equal(date.type, "date");
  assert.deepEqual(date.operators, ["eq", "lt", "lte", "gt", "gte", "isNull", "isNotNull"]);
  assert.equal(date.sortable, true);

  for (const raw of [
    { start: "2026-10-17", end: null },
    { start: "2026-10-17T23:30:00-07:00", end: null },
    { start: "2026-10-17", end: "2026-10-20" },
    { start: "2026-10-17T14:30:00+08:00", end: "2026-10-20T18:00:00+08:00" },
  ]) {
    const pageValue = structuredClone(record);
    pageValue.properties.When.date = raw;
    assert.equal(projectRecord(s, pageValue).data[date.key], "2026-10-17");
  }

  assert.deepEqual(translateWrite(s, { [date.key]: "2026-10-18" }), {
    date: { date: { start: "2026-10-18", end: null } },
  });
  assert.deepEqual(
    translateQuery(s, {
      filter: { field: date.key, op: "gte", value: "2026-10-18" },
      sort: [{ field: date.key, direction: "asc" }],
    }),
    {
      page_size: 100,
      filter: { property: "date", date: { on_or_after: "2026-10-18" } },
      sorts: [{ property: "date", direction: "ascending" }],
    },
  );
});
test("unsupported projected values become null instead of failing the whole record", async () => {
  const s = await projectSchema(schema, connection);
  const date = s.fields.find((field) => field.sourceFieldId === "date");
  const malformed = structuredClone(record);
  malformed.properties.When.date = { start: "not-a-date", end: null };
  assert.equal(projectRecord(s, malformed).data[date.key], null);
});
test("multi_select maps to a non-nullable enum_list and files remain provider-hosted references", async () => {
  const expanded = structuredClone(schema);
  expanded.properties.Tags = {
    id: "tags",
    name: "Tags",
    type: "multi_select",
    multi_select: { options: [{ name: "A" }, { name: "B" }] },
  };
  expanded.properties.Sequence = {
    id: "uid",
    name: "Sequence",
    type: "unique_id",
    unique_id: { prefix: "DOC" },
  };
  const s = await projectSchema(expanded, connection);
  const tags = s.fields.find((field) => field.sourceFieldId === "tags");
  const files = s.fields.find((field) => field.sourceFieldId === "files");
  const uid = s.fields.find((field) => field.sourceFieldId === "uid");
  assert.equal(tags.type, "enum_list");
  assert.equal(tags.nullable, false);
  assert.deepEqual(tags.values, ["A", "B"]);
  assert.deepEqual(tags.operators, ["contains"]);
  assert.equal(tags.sortable, false);
  assert.equal(files.type, "file_ref_list");
  assert.equal(files.writable, false);
  assert.equal(files.sortable, false);
  assert.equal(uid.readOnly, true);

  const pageValue = structuredClone(record);
  pageValue.properties.Tags = {
    id: "tags",
    type: "multi_select",
    multi_select: [{ id: "1", name: "A", color: "red" }, { id: "2", name: "B", color: "blue" }],
  };
  pageValue.properties.Sequence = {
    id: "uid",
    type: "unique_id",
    unique_id: { prefix: "DOC", number: 42 },
  };
  pageValue.properties.Files.files = [
    { name: "external.pdf", type: "external", external: { url: "https://example.com/external.pdf" } },
    {
      name: "notion.pdf",
      type: "file",
      file: {
        url: "https://signed.example.com/notion.pdf?token=x",
        expiry_time: "2026-10-17T05:30:00Z",
      },
    },
  ];
  const projected = projectRecord(s, pageValue).data;
  assert.deepEqual(projected[tags.key], ["A", "B"]);
  assert.equal(projected[uid.key], "DOC-42");
  assert.deepEqual(projected[files.key], [
    { name: "external.pdf", url: "https://example.com/external.pdf" },
    {
      name: "notion.pdf",
      url: "https://signed.example.com/notion.pdf?token=x",
      expiresAt: "2026-10-17T05:30:00Z",
    },
  ]);
  assert.deepEqual(translateWrite(s, { [tags.key]: ["B", "A"] }), {
    tags: { multi_select: [{ name: "B" }, { name: "A" }] },
  });
  assert.throws(() => translateWrite(s, { [tags.key]: null }), ProviderError);
  const unavailableTags = structuredClone(pageValue);
  unavailableTags.properties.Tags.multi_select = null;
  assert.deepEqual(projectRecord(s, unavailableTags).data[tags.key], []);
  assert.deepEqual(
    translateQuery(s, { filter: { field: tags.key, op: "contains", value: "A" } }).filter,
    { property: "tags", multi_select: { contains: "A" } },
  );
  assert.throws(() => translateWrite(s, { [files.key]: [] }), ProviderError);
});
test("typed filters/sort push down by property ID; wrong types and hidden fields fail closed", async () => {
  const s = await projectSchema(schema, connection),
    number = s.fields.find((f) => f.type === "number");
  assert.deepEqual(
    translateQuery(s, {
      filter: { field: number.key, op: "gt", value: 3 },
      sort: [{ field: number.key, direction: "desc" }],
      page: { limit: 20, cursor: "opaque" },
    }),
    {
      page_size: 20,
      start_cursor: "opaque",
      filter: { property: "num", number: { greater_than: 3 } },
      sorts: [{ property: "num", direction: "descending" }],
    },
  );
  assert.throws(
    () =>
      translateQuery(s, {
        filter: { field: number.key, op: "gt", value: "3" },
      }),
    ProviderError,
  );
  assert.throws(() => translateWrite(s, { unknown: "x" }), ProviderError);
  assert.throws(
    () => translateQuery(s, { search: { text: "x" } }),
    ProviderError,
  );
  assert.deepEqual(translateWrite(s, { [number.key]: 8 }), {
    num: { number: 8 },
  });
});
test("record parent is checked; stable identity includes source; no fabricated version or unsupported payload", async () => {
  const s = await projectSchema(schema, connection);
  const r = projectRecord(s, record);
  assert.equal(r.id, "rec_external_" + resource + "_" + page);
  assert.equal("version" in r, false);
  const outside = structuredClone(record);
  outside.parent.data_source_id = "10000000000000000000000000000002";
  assert.throws(
    () => projectRecord(s, outside),
    (e) => e.code === "EXTERNAL_RESOURCE_UNAVAILABLE",
  );
});
test("Get and Query are one provider call with no schema preflight", async () => {
  const s = await projectSchema(schema, connection);
  let calls = 0;
  const p = createNotionProvider({
    fetch: async (url) => {
      calls++;
      return url.endsWith("/query")
        ? reply({ results: [record], has_more: false, next_cursor: null })
        : reply(record);
    },
    sleep: async () => {},
    spacingMs: 0,
  });
  await p.execute(
    connection,
    input("get", s, { recordId: "rec_external_" + resource + "_" + page }),
  );
  assert.equal(calls, 1);
  await p.execute(
    connection,
    input("query", s, { input: { page: { limit: 20 } } }),
  );
  assert.equal(calls, 2);
});
test("update refuses foreign source before PATCH and delete uses trash", async () => {
  const s = await projectSchema(schema, connection);
  let calls = [];
  const p = createNotionProvider({
    fetch: async (url, init) => {
      calls.push({ url, ...init });
      return reply(record);
    },
    sleep: async () => {},
    spacingMs: 0,
  });
  await p.execute(
    connection,
    input("delete", s, { recordId: "rec_external_" + resource + "_" + page }),
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1].body), { in_trash: true });
  const foreign = structuredClone(record);
  foreign.parent.data_source_id = "10000000000000000000000000000002";
  calls = [];
  const q = createNotionProvider({
    fetch: async () => {
      calls.push(1);
      return reply(foreign);
    },
    sleep: async () => {},
    spacingMs: 0,
  });
  await assert.rejects(
    q.execute(
      connection,
      input("update", s, {
        recordId: "rec_external_" + resource + "_" + page,
        input: {},
      }),
    ),
    (e) => e.code === "EXTERNAL_RESOURCE_UNAVAILABLE",
  );
  assert.equal(calls.length, 1);
});
test("429 respects bounded Retry-After; long delays return rate-limit without early retry", async () => {
  const s = await projectSchema(schema, connection);
  let n = 0,
    t = 0;
  const waits = [];
  const p = createNotionProvider({
    fetch: async () =>
      ++n === 1 ? reply({}, 429, { "retry-after": "2" }) : reply(record),
    sleep: async (ms) => {
      waits.push(ms);
      t += ms;
    },
    now: () => t,
    spacingMs: 0,
  });
  await p.execute(
    connection,
    input("get", s, { recordId: "rec_external_" + resource + "_" + page }),
  );
  assert.equal(n, 2);
  assert(waits.includes(2000));
  n = 0;
  const q = createNotionProvider({
    fetch: async () => {
      n++;
      return reply({}, 429, { "retry-after": "20" });
    },
    sleep: async () => {},
    spacingMs: 0,
  });
  await assert.rejects(
    q.execute(
      connection,
      input("get", s, { recordId: "rec_external_" + resource + "_" + page }),
    ),
    (e) => e.code === "EXTERNAL_RATE_LIMITED",
  );
  assert.equal(n, 1);
});
test("uncertain create is not retried, including schema mismatch in a successful write response", async () => {
  const s = await projectSchema(schema, connection);
  let n = 0;
  const p = createNotionProvider({
    fetch: async () => {
      n++;
      return reply({}, 503);
    },
    sleep: async () => {},
    spacingMs: 0,
  });
  await assert.rejects(
    p.execute(connection, input("create", s, { input: {} })),
    (e) => e.code === "EXTERNAL_WRITE_UNKNOWN" && !e.retrySafe,
  );
  assert.equal(n, 1);
  const wrong = structuredClone(record);
  wrong.properties.Amount.type = "rich_text";
  n = 0;
  const q = createNotionProvider({
    fetch: async () => {
      n++;
      return reply(wrong);
    },
    sleep: async () => {},
    spacingMs: 0,
  });
  await assert.rejects(
    q.execute(connection, input("create", s, { input: {} })),
    (e) => e.code === "EXTERNAL_WRITE_UNKNOWN" && !e.retrySafe,
  );
  assert.equal(n, 1);
});
test("connection read ceiling and internal authentication fail closed; static references are rejected", async () => {
  const s = await projectSchema(schema, connection);
  const p = createNotionProvider({
    fetch: async () => {
      throw Error("must not call");
    },
  });
  await assert.rejects(
    p.execute(
      { ...connection, write: false },
      input("create", s, { input: {} }),
    ),
    (e) => e.code === "EXTERNAL_ACCESS_DENIED",
  );
  const worker = createWorker(p),
    env = {
      EXTERNAL_ADAPTER_SHARED_SECRET:
        "synthetic-shared-secret-at-least-32-characters",
    };
  const response = await worker.fetch(
    new Request("https://example.com/internal/v1/external-models", {
      method: "POST",
      body: JSON.stringify(input("get", s)),
    }),
    env,
  );
  assert.equal(response.status, 401);
  assert(!(await response.text()).includes(connection.token));
  const rejected = await worker.fetch(
    new Request("https://example.com/internal/v1/external-models", {
      method: "POST",
      headers: {
        "x-lifespace-internal-secret": env.EXTERNAL_ADAPTER_SHARED_SECRET,
      },
      body: JSON.stringify(input("get", s, { credentialRef: "legacy_static_ref" })),
    }),
    env,
  );
  assert.equal(rejected.status, 422);
  assert.equal((await rejected.json()).error.code, "EXTERNAL_VALIDATION_FAILED");
});
test("multi-source database requires explicit source selection", async () => {
  const p = createNotionProvider({
    fetch: async (url) =>
      url.includes("/data_sources/")
        ? reply({}, 404)
        : reply({
            data_sources: [
              { id: resource },
              { id: "10000000000000000000000000000002" },
            ],
          }),
    sleep: async () => {},
    spacingMs: 0,
  });
  await assert.rejects(
    p.execute(connection, input("discover")),
    (e) => e.code === "EXTERNAL_VALIDATION_FAILED",
  );
});

test("timestamp filters use provider timestamp shape and unsupported deep nesting is rejected before HTTP", async () => {
  const changed = structuredClone(schema);
  changed.properties.Created = {
    id: "created",
    name: "Created",
    type: "created_time",
  };
  const s = await projectSchema(changed, connection),
    f = s.fields.find((x) => x.type === "instant");
  assert.deepEqual(
    translateQuery(s, {
      filter: { field: f.key, op: "gt", value: "2026-01-01T00:00:00Z" },
    }).filter,
    {
      timestamp: "created_time",
      created_time: { after: "2026-01-01T00:00:00Z" },
    },
  );
  const number = s.fields.find((x) => x.type === "number");
  assert.throws(
    () =>
      translateQuery(s, {
        filter: {
          and: [{ or: [{ and: [{ field: number.key, op: "gt", value: 1 }] }] }],
        },
      }),
    (e) => e.code === "EXTERNAL_QUERY_UNSUPPORTED",
  );
});
