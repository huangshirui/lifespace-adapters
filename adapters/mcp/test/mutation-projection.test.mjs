import { test } from "node:test";
import assert from "node:assert/strict";
import { projectNativeMutations, buildNativeMutation } from "../src/mutation-projection.mjs";
function fixture() {
  return { models: [{ detail: { key: "task", version: 1, schemaHash: "a".repeat(64), display: { singular: "Task" },
    mutations: { contractId: "mct_" + "b".repeat(64), modelVersion: 1, schemaHash: "a".repeat(64),
      operations: { create: { $ref: "#/$defs/Create" } }, $defs: { Create: { type: "object" } } } },
  spaces: [{ spaceId: "spc_synthetic", access: ["read", "write"] }] }] };
}
test("mutation schema must match exact Core model contract identity and all local refs", () => {
  for (const change of [
    m => { m.detail.mutations.contractId = "latest"; },
    m => { m.detail.mutations.schemaHash = "c".repeat(64); },
    m => { m.detail.mutations.modelVersion = 2; },
    m => { m.detail.origin = "external"; },
    m => { m.detail.mutations.operations.create.$ref = "https://evil.example/schema"; },
    m => { m.detail.mutations.$defs = {}; },
    m => { m.detail.mutations.operations.bulk = {}; },
  ]) {
    const f = fixture(); change(f.models[0]);
    assert.throws(() => projectNativeMutations(f));
  }
});
test("mutation request rejects identity selectors, cross-Space and invalid record/version input", () => {
  const projected = projectNativeMutations(fixture());
  const binding = projected.bindings["lifespace.create.task"];
  const data = { name: "Synthetic task" };
  assert.deepEqual(buildNativeMutation(binding, { spaceId: "spc_synthetic", data }), {
    method: "POST", path: "/api/v1/spaces/spc_synthetic/models/task/records", body: data,
  });
  for (const args of [
    { spaceId: "spc_other", data }, { spaceId: "spc_synthetic", data, principalUserId: "usr_other" },
    { spaceId: "spc_synthetic", data, delegationId: "dlg_unapproved" },
    { spaceId: "spc_synthetic", data, recordId: "rec_synthetic" },
  ]) assert.throws(() => buildNativeMutation(binding, args));
});
