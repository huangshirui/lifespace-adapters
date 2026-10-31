import assert from "node:assert/strict";
import test from "node:test";
import { buildPreviewConfig } from "../scripts/build-preview-config.mjs";

const safe = {
  MCP_WORKER_NAME: "example-mcp",
  MCP_PREVIEW_IDENTITY_SERVICE: "example-identity-staging",
  MCP_PREVIEW_CORE_SERVICE: "example-core-staging",
  MCP_PREVIEW_MODEL_KEYS: "task,event",
};

test("generates production-closed Worker with Staging-only Preview bindings", () => {
  const result = buildPreviewConfig(safe);
  assert.equal(result.workers_dev, false);
  assert.equal(result.preview_urls, true);
  assert.equal(result.name, "example-mcp");
  assert.equal(result.previews.vars.MCP_MODEL_KEYS, "task,event");
  assert.deepEqual(result.previews.services, [
    { binding: "IDENTITY", service: "example-identity-staging" },
    { binding: "CORE", service: "example-core-staging" },
  ]);
  assert.equal(result.services, undefined);
  assert.equal(JSON.stringify(result).includes("lsa_"), false);
  assert.equal(JSON.stringify(result).includes("account_id"), false);
});

test("rejects accidental Production bindings and ambiguous infrastructure", () => {
  for (const override of [
    { MCP_PREVIEW_IDENTITY_SERVICE: "example-identity-production" },
    { MCP_PREVIEW_IDENTITY_SERVICE: "example-identity" },
    { MCP_PREVIEW_CORE_SERVICE: "example-core" },
    { MCP_PREVIEW_CORE_SERVICE: "example-identity-staging" },
    { MCP_PREVIEW_CORE_SERVICE: "" },
    { MCP_WORKER_NAME: "" },
    { MCP_WORKER_NAME: "example/mcp" },
  ]) assert.throws(() => buildPreviewConfig({ ...safe, ...override }), Error);
});

test("rejects duplicate, malicious and oversized model allowlists", () => {
  for (const MCP_PREVIEW_MODEL_KEYS of ["", "task,task", "task;event", "task,../admin",
    Array.from({ length: 17 }, (_, i) => "model" + i).join(",")]) {
    assert.throws(() => buildPreviewConfig({ ...safe, MCP_PREVIEW_MODEL_KEYS }), Error);
  }
});
