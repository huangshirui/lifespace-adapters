from pathlib import Path

readme = Path("adapters/notion/README.md")
text = readme.read_text()
text = text.replace(
    '| files | file_ref_list | yes | no | none | Provider-hosted references only; bytes remain in Notion |',
    '| files | file_ref_list | yes | no (separate upload capability) | none | Provider-hosted references; write-enabled connections may advertise bounded upload separately |',
)
old = '''For Notion-hosted files, the current signed URL and expiry are returned. For external files, the original URL is returned without fabricated expiry. File bytes are never copied into LifeSpace/R2 and signed URLs are not treated as durable file identity.'''
new = '''For Notion-hosted files, the current signed URL and expiry are returned. For external files, the original URL is returned without fabricated expiry. Signed URLs are not treated as durable file identity.

A write-enabled Dynamic Connection may additionally advertise `upload: { supported: true, maxBytes: 20971520 }` on the `file_ref_list` field. This is intentionally separate from ordinary field `writable`: applications cannot PATCH canonical file references directly. The LifeSpace upload session first stages the client upload in short-lived R2 transport storage, then the Adapter validates the target page/field, reads that staged object, sends it through Notion's single-part File Upload API, preserves the current Notion `files` array and appends the new `file_upload` entry. Notion remains the durable owner of External file bytes; the R2 staging object is deleted after successful finalization or later cleanup. V1 is bounded to 20 MiB per Notion upload and does not use Notion external-URL import. Any timeout or ambiguous failure after a Notion write begins is returned as `EXTERNAL_WRITE_UNKNOWN` and is never blindly retried.'''
if old not in text:
    raise SystemExit("README files paragraph anchor not found")
readme.write_text(text.replace(old, new, 1))

test_path = Path("adapters/notion/test/provider.test.mjs")
tests = test_path.read_text()
if 'test("staged source size mismatch never starts a Notion file upload"' in tests:
    raise SystemExit("hardening tests already present")
extra = r'''

test("staged source size mismatch never starts a Notion file upload", async () => {
  const s = await projectSchema(schema, connection);
  const files = s.fields.find((field) => field.sourceFieldId === "files");
  const sourceUrl = "https://11111111111111111111111111111111.r2.cloudflarestorage.com/staging/object?X-Amz-Signature=abc";
  let providerMutations = 0;
  const p = createNotionProvider({
    fetch: async (url, init = {}) => {
      if (url.endsWith("/pages/" + page)) return reply(record);
      if (url === sourceUrl) return new Response(new TextEncoder().encode("four"), { headers: { "content-length": "4" } });
      if (init.method !== "GET") providerMutations += 1;
      throw new Error(`unexpected request ${init.method ?? "GET"} ${url}`);
    },
    sleep: async () => {}, spacingMs: 0,
  });
  await assert.rejects(
    p.execute(connection, input("upload", s, {
      recordId: "rec_external_" + resource + "_" + page,
      input: { fieldKey: files.key, sourceUrl, name: "new.txt", contentType: "text/plain", size: 5 },
    })),
    (error) => error.code === "EXTERNAL_VALIDATION_FAILED",
  );
  assert.equal(providerMutations, 0);
});

test("uncertain attachment PATCH is never retried", async () => {
  const s = await projectSchema(schema, connection);
  const files = s.fields.find((field) => field.sourceFieldId === "files");
  const sourceUrl = "https://11111111111111111111111111111111.r2.cloudflarestorage.com/staging/object?X-Amz-Signature=abc";
  let patchAttempts = 0;
  const p = createNotionProvider({
    fetch: async (url, init = {}) => {
      if (url === sourceUrl) return new Response(new TextEncoder().encode("hello"), { headers: { "content-length": "5" } });
      if (url.endsWith("/pages/" + page) && init.method === "GET") return reply(record);
      if (url.endsWith("/file_uploads") && init.method === "POST") return reply({ object: "file_upload", id: "upl-notion-patch", status: "pending" });
      if (url.endsWith("/file_uploads/upl-notion-patch/send")) return reply({ object: "file_upload", id: "upl-notion-patch", status: "uploaded" });
      if (url.endsWith("/pages/" + page) && init.method === "PATCH") { patchAttempts += 1; throw new Error("timeout after attach"); }
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
  assert.equal(patchAttempts, 1);
});
'''
test_path.write_text(tests + extra)
