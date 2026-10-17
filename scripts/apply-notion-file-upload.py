from pathlib import Path


def replace(path, old, new, count=1):
    p = Path(path)
    text = p.read_text()
    if text.count(old) < count:
        raise SystemExit(f"{path}: anchor not found: {old[:120]!r}")
    p.write_text(text.replace(old, new, count))

provider = "adapters/notion/src/provider.mjs"

replace(provider, "const supported = {", '''const NOTION_DIRECT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

function validStagingUrl(value) {
  if (typeof value !== "string" || value.length > 8192) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && /^[a-f0-9]{32}\\.r2\\.cloudflarestorage\\.com$/u.test(url.hostname)
      && url.searchParams.has("X-Amz-Signature");
  } catch {
    return false;
  }
}

function preservedFiles(raw) {
  if (!Array.isArray(raw) || raw.length > 100) fail("EXTERNAL_CONTRACT_INVALID", 502);
  return raw.map((entry) => {
    if (!object(entry) || typeof entry.name !== "string" || !entry.name.trim() || entry.name.trim().length > 512) {
      fail("EXTERNAL_CONTRACT_INVALID", 502);
    }
    if (entry.type === "external" && object(entry.external) && validHttpUrl(entry.external.url)) {
      return { name: entry.name.trim(), type: "external", external: { url: entry.external.url } };
    }
    if (entry.type === "file" && object(entry.file) && validHttpUrl(entry.file.url)) {
      const expiry = entry.file.expiry_time;
      if (expiry !== undefined && expiry !== null && !absoluteInstant(expiry)) fail("EXTERNAL_CONTRACT_INVALID", 502);
      return {
        name: entry.name.trim(),
        type: "file",
        file: {
          url: entry.file.url,
          ...(typeof expiry === "string" ? { expiry_time: expiry } : {}),
        },
      };
    }
    fail("EXTERNAL_CONTRACT_INVALID", 502);
  });
}

const supported = {''')

replace(provider, '''      sortable: !["unique_id", "multi_select", "files"].includes(p.type),
      ...(values ? { values } : {}),''', '''      sortable: !["unique_id", "multi_select", "files"].includes(p.type),
      ...(p.type === "files" && connection.write === true
        ? { upload: { supported: true, maxBytes: NOTION_DIRECT_UPLOAD_MAX_BYTES } }
        : {}),
      ...(values ? { values } : {}),''')

replace(provider, '  async function request(connection, method, path, body) {', '  async function request(connection, method, path, body, bodyMode = "json") {')
replace(provider, '''            headers: {
              authorization: "Bearer " + connection.token,
              "Notion-Version": NOTION_VERSION,
              "Notion-Beta": "status-group-filters-2026-10-06",
              "content-type": "application/json",
            },
            ...(body ? { body: JSON.stringify(body) } : {}),''', '''            headers: {
              authorization: "Bearer " + connection.token,
              "Notion-Version": NOTION_VERSION,
              "Notion-Beta": "status-group-filters-2026-10-06",
              ...(bodyMode === "multipart" ? {} : { "content-type": "application/json" }),
            },
            ...(body === undefined ? {} : { body: bodyMode === "multipart" ? body : JSON.stringify(body) }),''')

replace(provider, '''      const write = ["create", "update", "delete"].includes(operation);''', '''      const write = ["create", "update", "delete", "upload"].includes(operation);''')

upload_block = r'''      if (operation === "upload") {
        keys(input, ["fieldKey", "sourceUrl", "name", "contentType", "size"]);
        const field = snapshot.fields.find((candidate) => candidate.key === input.fieldKey);
        const codec = field ? codecFor(snapshot, field) : undefined;
        if (
          !field
          || field.type !== "file_ref_list"
          || field.upload?.supported !== true
          || !codec
          || codec.type !== "files"
          || typeof input.name !== "string"
          || !input.name.trim()
          || input.name.trim().length > 512
          || typeof input.contentType !== "string"
          || !input.contentType.trim()
          || input.contentType.length > 255
          || !Number.isInteger(input.size)
          || input.size < 1
          || input.size > Math.min(field.upload.maxBytes, NOTION_DIRECT_UPLOAD_MAX_BYTES)
          || !validStagingUrl(input.sourceUrl)
        )
          fail();

        const providerPageId = pageId(id, resource);
        const page = await request(connection, "GET", "/pages/" + providerPageId);
        if (
          page.in_trash
          || page.archived
          || page.parent?.type !== "data_source_id"
          || uuid(page.parent.data_source_id) !== resource
        )
          fail("EXTERNAL_RESOURCE_UNAVAILABLE", 404);
        const property = Object.values(page.properties ?? {}).find((candidate) => candidate?.id === codec.id);
        if (!object(property) || property.type !== "files" || !Array.isArray(property.files)) {
          throw new ProviderError("EXTERNAL_SCHEMA_CHANGED", 409, true);
        }
        const existing = preservedFiles(property.files);
        if (existing.length >= 100) fail("EXTERNAL_VALIDATION_FAILED", 422);

        let source;
        try {
          source = await fetcher(input.sourceUrl, { method: "GET", signal: AbortSignal.timeout(15000) });
        } catch {
          throw new ProviderError("EXTERNAL_UNAVAILABLE", 503, true);
        }
        if (!source.ok) {
          await source.body?.cancel();
          throw new ProviderError("EXTERNAL_UNAVAILABLE", 503, true);
        }
        const declaredLength = source.headers.get("content-length");
        if (declaredLength !== null && Number(declaredLength) !== input.size) {
          await source.body?.cancel();
          fail();
        }
        const bytes = await source.arrayBuffer();
        if (bytes.byteLength !== input.size || bytes.byteLength > NOTION_DIRECT_UPLOAD_MAX_BYTES) fail();

        const created = await request(connection, "POST", "/file_uploads", {
          mode: "single_part",
          filename: input.name.trim(),
          content_type: input.contentType.trim().toLowerCase(),
        });
        if (created.object !== "file_upload" || typeof created.id !== "string" || !created.id) {
          throw new ProviderError("EXTERNAL_WRITE_UNKNOWN", 502, false);
        }
        const form = new FormData();
        form.append("file", new Blob([bytes], { type: input.contentType.trim().toLowerCase() }), input.name.trim());
        const sent = await request(connection, "POST", `/file_uploads/${created.id}/send`, form, "multipart");
        if (sent.object !== "file_upload" || sent.id !== created.id || sent.status !== "uploaded") {
          throw new ProviderError("EXTERNAL_WRITE_UNKNOWN", 502, false);
        }

        const updated = await request(connection, "PATCH", "/pages/" + providerPageId, {
          properties: {
            [codec.id]: {
              files: [
                ...existing,
                { type: "file_upload", file_upload: { id: created.id }, name: input.name.trim() },
              ],
            },
          },
        });
        try {
          return projectRecord(snapshot, updated);
        } catch {
          throw new ProviderError("EXTERNAL_WRITE_UNKNOWN", 502, false);
        }
      }
'''
replace(provider, '''      if (operation === "create") {''', upload_block + '''      if (operation === "create") {''')

# Tests.
test_path = Path("adapters/notion/test/provider.test.mjs")
tests = test_path.read_text()
extra = r'''

test("files advertise separate upload capability only under a write connection", async () => {
  const writable = await projectSchema(schema, connection);
  const fileField = writable.fields.find((field) => field.sourceFieldId === "files");
  assert.equal(fileField.readOnly, true);
  assert.equal(fileField.writable, false);
  assert.deepEqual(fileField.upload, { supported: true, maxBytes: 20 * 1024 * 1024 });
  const readOnly = await projectSchema(schema, { token: "synthetic-test-only", read: true, write: false });
  assert.equal(readOnly.fields.find((field) => field.sourceFieldId === "files").upload, undefined);
});

test("upload transfers staged bytes, preserves existing files and appends one Notion file_upload", async () => {
  const s = await projectSchema(schema, connection);
  const files = s.fields.find((field) => field.sourceFieldId === "files");
  const current = structuredClone(record);
  current.properties.Files.files = [
    { name: "external.pdf", type: "external", external: { url: "https://example.com/external.pdf" } },
    { name: "hosted.pdf", type: "file", file: { url: "https://signed.example.com/hosted.pdf", expiry_time: "2026-10-17T16:00:00Z" } },
  ];
  const updated = structuredClone(current);
  updated.properties.Files.files.push({
    name: "new.txt",
    type: "file",
    file: { url: "https://signed.example.com/new.txt", expiry_time: "2026-10-17T16:10:00Z" },
  });
  const sourceUrl = "https://11111111111111111111111111111111.r2.cloudflarestorage.com/staging/object?X-Amz-Signature=abc";
  const calls = [];
  const p = createNotionProvider({
    fetch: async (url, init = {}) => {
      calls.push({ url, init });
      if (url === sourceUrl) return new Response(new TextEncoder().encode("hello"), { headers: { "content-length": "5", "content-type": "text/plain" } });
      if (url.endsWith("/pages/" + page)) return reply(current);
      if (url.endsWith("/file_uploads")) return reply({ object: "file_upload", id: "upl-notion-1", status: "pending" });
      if (url.endsWith("/file_uploads/upl-notion-1/send")) {
        assert(init.body instanceof FormData);
        const uploaded = init.body.get("file");
        assert(uploaded instanceof Blob);
        assert.equal(uploaded.size, 5);
        assert.equal(init.headers["content-type"], undefined);
        return reply({ object: "file_upload", id: "upl-notion-1", status: "uploaded" });
      }
      if (url.endsWith("/pages/" + page) && init.method === "PATCH") return reply(updated);
      if (init.method === "PATCH") return reply(updated);
      throw new Error(`unexpected request ${init.method ?? "GET"} ${url}`);
    },
    sleep: async () => {},
    spacingMs: 0,
  });
  const result = await p.execute(connection, input("upload", s, {
    recordId: "rec_external_" + resource + "_" + page,
    input: { fieldKey: files.key, sourceUrl, name: "new.txt", contentType: "text/plain", size: 5 },
  }));
  assert.equal(result.data[files.key].length, 3);
  const patch = calls.find((call) => call.init.method === "PATCH");
  assert(patch);
  const body = JSON.parse(patch.init.body);
  assert.deepEqual(body.properties.files.files, [
    { name: "external.pdf", type: "external", external: { url: "https://example.com/external.pdf" } },
    { name: "hosted.pdf", type: "file", file: { url: "https://signed.example.com/hosted.pdf", expiry_time: "2026-10-17T16:00:00Z" } },
    { type: "file_upload", file_upload: { id: "upl-notion-1" }, name: "new.txt" },
  ]);
  assert.equal(calls.some((call) => call.init.method === "HEAD"), false);
});

test("upload validates record/field/source before mutating Notion", async () => {
  const s = await projectSchema(schema, connection);
  const files = s.fields.find((field) => field.sourceFieldId === "files");
  const sourceUrl = "https://11111111111111111111111111111111.r2.cloudflarestorage.com/staging/object?X-Amz-Signature=abc";
  const foreign = structuredClone(record);
  foreign.parent.data_source_id = "10000000000000000000000000000002";
  let calls = 0;
  const p = createNotionProvider({
    fetch: async () => { calls += 1; return reply(foreign); },
    sleep: async () => {}, spacingMs: 0,
  });
  await assert.rejects(
    p.execute(connection, input("upload", s, {
      recordId: "rec_external_" + resource + "_" + page,
      input: { fieldKey: files.key, sourceUrl, name: "new.txt", contentType: "text/plain", size: 5 },
    })),
    (error) => error.code === "EXTERNAL_RESOURCE_UNAVAILABLE",
  );
  assert.equal(calls, 1);
  await assert.rejects(
    p.execute(connection, input("upload", s, {
      recordId: "rec_external_" + resource + "_" + page,
      input: { fieldKey: files.key, sourceUrl: "https://example.com/not-staging", name: "new.txt", contentType: "text/plain", size: 5 },
    })),
    (error) => error.code === "EXTERNAL_VALIDATION_FAILED",
  );
  assert.equal(calls, 1);
});

test("uncertain Notion upload send is never retried", async () => {
  const s = await projectSchema(schema, connection);
  const files = s.fields.find((field) => field.sourceFieldId === "files");
  const sourceUrl = "https://11111111111111111111111111111111.r2.cloudflarestorage.com/staging/object?X-Amz-Signature=abc";
  let sendAttempts = 0;
  const p = createNotionProvider({
    fetch: async (url, init = {}) => {
      if (url === sourceUrl) return new Response(new TextEncoder().encode("hello"), { headers: { "content-length": "5" } });
      if (url.endsWith("/pages/" + page)) return reply(record);
      if (url.endsWith("/file_uploads")) return reply({ object: "file_upload", id: "upl-notion-2", status: "pending" });
      if (url.endsWith("/file_uploads/upl-notion-2/send")) { sendAttempts += 1; throw new Error("timeout"); }
      throw new Error(`unexpected request ${init.method ?? "GET"} ${url}`);
    },
    sleep: async () => {}, spacingMs: 0,
  });
  await assert.rejects(
    p.execute(connection, input("upload", s, {
      recordId: "rec_external_" + resource + "_" + page,
      input: { fieldKey: files.key, sourceUrl, name: "new.txt", contentType: "text/plain", size: 5 },
    })),
    (error) => error.code === "EXTERNAL_WRITE_UNKNOWN" && error.retrySafe === false,
  );
  assert.equal(sendAttempts, 1);
});
'''
if 'test("files advertise separate upload capability only under a write connection"' in tests:
    raise SystemExit("upload tests already present")
test_path.write_text(tests + extra)
