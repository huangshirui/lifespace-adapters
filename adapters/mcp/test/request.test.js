import assert from "node:assert/strict";
import test from "node:test";
import { buildLifeSpaceRequest, projectMcpToolSurface } from "../src/index.js";
import { discoveryFixture, modelContractFixture } from "./fixtures.js";

function binding(suffix) {
  const surface = projectMcpToolSurface({ discovery: discoveryFixture(), modelContract: modelContractFixture() });
  return surface.find((entry) => entry.tool.name.endsWith(suffix)).binding;
}

test("builds a canonical action request with semantic and concurrency input in the body", () => {
  const request = buildLifeSpaceRequest(binding("action.complete"), {
    recordId: "tsk_example",
    input: { note: "done", version: 7 },
  });

  assert.deepEqual(request, {
    method: "POST",
    path: "/api/v1/spaces/spc_alpha/tasks/tsk_example/actions/complete",
    body: { note: "done", version: 7 },
  });
});

test("preserves ordered repeatable query arguments", () => {
  const request = buildLifeSpaceRequest(binding("list"), {
    q: "milk",
    sort: ["createdAt:desc", "name:asc"],
  });

  assert.equal(
    request.path,
    "/api/v1/spaces/spc_alpha/tasks?q=milk&sort=createdAt%3Adesc&sort=name%3Aasc",
  );
});

test("rejects arguments not present in the pinned operation schema", () => {
  assert.throws(
    () => buildLifeSpaceRequest(binding("get"), { recordId: "tsk_example", principalId: "usr_fake" }),
    /Unknown tool argument/,
  );
});
