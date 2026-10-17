from pathlib import Path

path = Path("adapters/notion/test/provider.test.mjs")
text = path.read_text()
old = '''      if (url === sourceUrl) return new Response(new TextEncoder().encode("hello"), { headers: { "content-length": "5", "content-type": "text/plain" } });
      if (url.endsWith("/pages/" + page)) return reply(current);
      if (url.endsWith("/file_uploads")) return reply({ object: "file_upload", id: "upl-notion-1", status: "pending" });'''
new = '''      if (url === sourceUrl) return new Response(new TextEncoder().encode("hello"), { headers: { "content-length": "5", "content-type": "text/plain" } });
      if (url.endsWith("/pages/" + page) && init.method === "PATCH") return reply(updated);
      if (url.endsWith("/pages/" + page)) return reply(current);
      if (url.endsWith("/file_uploads")) return reply({ object: "file_upload", id: "upl-notion-1", status: "pending" });'''
if old not in text:
    raise SystemExit("positive upload routing anchor not found")
text = text.replace(old, new, 1)
text = text.replace('''      if (url.endsWith("/pages/" + page) && init.method === "PATCH") return reply(updated);
      if (init.method === "PATCH") return reply(updated);
''', '''      if (init.method === "PATCH") return reply(updated);
''', 1)
path.write_text(text)
