import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

test("Notion documents type, metadata and stable-identity compatibility", () => {
  assert.match(readme, /Canonical field projection/u);
  assert.match(readme, /Metadata mapping/u);
  for (const classification of ["provider-native", "adapter-derived", "provider-only", "unsupported"]) {
    assert.match(readme, new RegExp(classification, "u"));
  }
  assert.match(readme, /sourceFieldId/u);
  assert.match(readme, /non-nullable unique option-name array/u);
});
