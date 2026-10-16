import { readFileSync, writeFileSync } from 'node:fs';

function replace(path, oldText, newText) {
  const text = readFileSync(path, 'utf8');
  if (!text.includes(oldText)) throw new Error(`missing expected text in ${path}`);
  writeFileSync(path, text.replace(oldText, newText));
}

replace(
  'adapters/notion/src/provider.mjs',
  'values.length > 100',
  'values.length > 50',
);

replace(
  'adapters/notion/README.md',
  'Empty/oversized enum definitions are hidden until representable.',
  'Empty enum definitions or definitions with more than 50 options are hidden until representable, matching the current LifeSpace canonical `enum` constraint.',
);
replace(
  'adapters/notion/README.md',
  'Unsupported types never enter the compatible snapshot. Rich text formatting/annotations are not preserved; consumers explicitly receive plain text.',
  'Unsupported types never enter the compatible snapshot. The Adapter is selecting a safe Provider-specific subset of the full LifeSpace Canonical Field Language; the External framework does not define a separate field-type whitelist. Adding future Notion mappings to an already-existing canonical type is therefore Adapter work, provided the mapping is lossless and stable. Rich text formatting/annotations are not preserved; consumers explicitly receive plain text.',
);

replace(
  'docs/lifespace-contract-consumption.md',
  'The provider-facing Notion adapter explicitly consumes LifeSpace `apps/core/external-adapter.contract.json` version 1 and the boundaries in `docs/external-models.md`. Provider field codecs/schema/query translation remain adapter-owned. Core consumes only the compatible projection.',
  'The provider-facing Notion adapter explicitly consumes LifeSpace `apps/core/external-adapter.contract.json` version 1 and the boundaries in `docs/external-models.md`. External fields use the same LifeSpace Canonical Field Language as Native models; the Provider adapter chooses only the canonical types/capabilities it can map safely and does not own a second type system. Provider field codecs/schema/query translation remain adapter-owned. Core consumes only the compatible projection.',
);

const testPath = 'adapters/notion/test/provider.test.mjs';
let tests = readFileSync(testPath, 'utf8');
const marker = 'test("typed filters/sort push down by property ID; wrong types and hidden fields fail closed", async () => {';
const addition = `test("enum projection follows the canonical 50-value bound", async () => {\n  const withSelect = structuredClone(schema);\n  withSelect.properties.Status = {\n    id: "status",\n    name: "Status",\n    type: "select",\n    select: { options: Array.from({ length: 50 }, (_, index) => ({ name: \`v\${index}\` })) },\n  };\n  const accepted = await projectSchema(withSelect, connection);\n  assert(accepted.fields.some((field) => field.sourceFieldId === "status"));\n  withSelect.properties.Status.select.options.push({ name: "v50" });\n  const rejected = await projectSchema(withSelect, connection);\n  assert.equal(rejected.fields.some((field) => field.sourceFieldId === "status"), false);\n});\n`;
if (!tests.includes(addition)) {
  if (!tests.includes(marker)) throw new Error('test insertion marker missing');
  tests = tests.replace(marker, addition + marker);
  writeFileSync(testPath, tests);
}
