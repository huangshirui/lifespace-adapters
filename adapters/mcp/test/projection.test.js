import assert from "node:assert/strict";
import test from "node:test";
import { AdapterContractError, projectMcpToolSurface } from "../src/index.js";
import { discoveryFixture, modelContractFixture } from "./fixtures.js";

function names(surface) {
  return surface.map((entry) => entry.tool.name);
}

test("read-only discovery exposes only read tools", () => {
  const surface = projectMcpToolSurface({
    discovery: discoveryFixture({ access: ["read"], includeAction: false }),
    modelContract: modelContractFixture(),
  });

  assert.deepEqual(names(surface), [
    "ls.spc_alpha.task.get",
    "ls.spc_alpha.task.list",
  ]);
});

test("write discovery projects create/update/action while preserving contract concurrency input", () => {
  const surface = projectMcpToolSurface({
    discovery: discoveryFixture(),
    modelContract: modelContractFixture(),
  });

  assert.deepEqual(names(surface), [
    "ls.spc_alpha.task.action.complete",
    "ls.spc_alpha.task.create",
    "ls.spc_alpha.task.get",
    "ls.spc_alpha.task.list",
    "ls.spc_alpha.task.update",
  ]);

  const action = surface.find((entry) => entry.tool.name.endsWith("action.complete"));
  assert.equal(action.tool.inputSchema.properties.input.properties.version["x-lifespace-input-role"], "concurrency");
  assert.deepEqual(action.tool.inputSchema.required, ["recordId", "input"]);
  assert.equal(action.binding.fixedPathParameters.spaceId, "spc_alpha");
  assert.equal(action.binding.actionKey, "complete");
});

test("Space boundaries remain explicit when the same model is visible in multiple Spaces", () => {
  const surface = projectMcpToolSurface({
    discovery: discoveryFixture({ access: ["read"], includeAction: false, spaces: ["spc_alpha", "spc_beta"] }),
    modelContract: modelContractFixture(),
  });

  assert.deepEqual(names(surface), [
    "ls.spc_alpha.task.get",
    "ls.spc_alpha.task.list",
    "ls.spc_beta.task.get",
    "ls.spc_beta.task.list",
  ]);
  assert.deepEqual(new Set(surface.map((entry) => entry.binding.spaceId)), new Set(["spc_alpha", "spc_beta"]));
});

test("a current discovery result removes stale capabilities from the projected surface", () => {
  const before = projectMcpToolSurface({ discovery: discoveryFixture(), modelContract: modelContractFixture() });
  const after = projectMcpToolSurface({
    discovery: discoveryFixture({ access: ["read"], includeAction: false }),
    modelContract: modelContractFixture(),
  });

  assert(before.some((entry) => entry.tool.name.endsWith("action.complete")));
  assert(!after.some((entry) => entry.tool.name.endsWith("action.complete")));
});

test("platform-admin paths in the pinned contract are never projected implicitly", () => {
  const surface = projectMcpToolSurface({ discovery: discoveryFixture(), modelContract: modelContractFixture() });
  assert(!surface.some((entry) => entry.binding.pathTemplate.includes("model-admin")));
});

test("Model Contract mismatch fails closed instead of guessing from discovery", () => {
  const discovery = discoveryFixture();
  discovery.spaces[0].models[0].schemaHash = "2".repeat(64);

  assert.throws(
    () => projectMcpToolSurface({ discovery, modelContract: modelContractFixture() }),
    (error) => error instanceof AdapterContractError && error.code === "MODEL_CONTRACT_MISMATCH",
  );
});

test("missing referenced schemas fail closed", () => {
  const contract = modelContractFixture();
  delete contract.openapi.components.schemas.TaskCreate;

  assert.throws(
    () => projectMcpToolSurface({ discovery: discoveryFixture(), modelContract: contract }),
    (error) => error instanceof AdapterContractError && error.code === "MISSING_SCHEMA_REF",
  );
});


test("complex Model Contract request schemas remain intact instead of being re-authored by the adapter", () => {
  const contract = modelContractFixture();
  contract.openapi.components.schemas.TaskCreate = {
    allOf: [
      {
        type: "object",
        properties: { name: { type: "string", minLength: 1 } },
        required: ["name"],
      },
      {
        oneOf: [
          { type: "object", properties: { mode: { const: "dated" }, dueDate: { type: "string", format: "date" } }, required: ["mode", "dueDate"] },
          { type: "object", properties: { mode: { const: "open" } }, required: ["mode"] },
        ],
      },
    ],
  };

  const surface = projectMcpToolSurface({ discovery: discoveryFixture(), modelContract: contract });
  const create = surface.find((entry) => entry.tool.name.endsWith("create"));
  assert.equal(create.tool.inputSchema.properties.input.allOf.length, 2);
});

test("tool names obey current MCP interoperable naming constraints", () => {
  const surface = projectMcpToolSurface({ discovery: discoveryFixture(), modelContract: modelContractFixture() });
  for (const entry of surface) {
    assert.match(entry.tool.name, /^[A-Za-z0-9_.-]{1,128}$/u);
  }
});
