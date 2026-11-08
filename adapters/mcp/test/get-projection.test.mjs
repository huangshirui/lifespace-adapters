import { test } from "node:test";
import assert from "node:assert/strict";
import { projectNativeGets, buildNativeGet } from "../src/get-projection.mjs";

const selection = {
  models: [{
    detail: {
      origin: "native", key: "task", display: { singular: "Task" },
      mcpOperations: ["get"],
    },
    spaces: [{ spaceId: "spc_synthetic", access: ["read"] }],
  }],
};

test("native Get is projected only for current Core-selected get operation", () => {
  const projected = projectNativeGets(selection);
  assert.equal(projected.tools.length, 1);
  assert.equal(projected.tools[0].name, "lifespace.get.task");
  assert.deepEqual(projected.tools[0].inputSchema.required, ["spaceId", "recordId"]);
  assert.deepEqual(buildNativeGet(projected.bindings["lifespace.get.task"], {
    spaceId: "spc_synthetic", recordId: "rec_synthetic",
  }), {
    method: "GET",
    path: "/api/v1/spaces/spc_synthetic/models/task/records/rec_synthetic",
  });
  assert.deepEqual(projectNativeGets({ models: [{
    ...selection.models[0], detail: {
      ...selection.models[0].detail, mcpOperations: ["query"],
    },
  }] }).tools, []);
});

test("native Get denies forged identity context, Space and record selectors", () => {
  const { bindings } = projectNativeGets(selection);
  const binding = bindings["lifespace.get.task"];
  for (const args of [
    { spaceId: "spc_other", recordId: "rec_synthetic" },
    { spaceId: "spc_synthetic", recordId: "person_abc" },
    { spaceId: "spc_synthetic", recordId: "rec_synthetic", principalUserId: "usr_other" },
  ]) assert.throws(() => buildNativeGet(binding, args));
  assert.deepEqual(projectNativeGets({ models: [{
    ...selection.models[0], spaces: [{ spaceId: "spc_synthetic", access: ["write"] }],
  }] }).tools, []);
});
