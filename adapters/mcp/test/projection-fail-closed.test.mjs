import assert from "node:assert/strict";
import test from "node:test";
import { buildLifeSpaceQueryRequest, projectSelectedModelsToMcp } from "../src/projection.mjs";

function queryBase() {
  return {
    search: null,
    filters: [],
    comparisons: [],
    sort: { parameter: "sort", maxCriteria: 8, genericValues: [] },
    pagination: {
      limit: { parameter: "limit", minimum: 1, maximum: 200 },
      cursor: { parameter: "cursor", type: "string" },
    },
    capabilityQueries: [],
  };
}

function selection(detail) {
  return {
    models: [{
      detail,
      spaces: [{ spaceId: "spc_test", spaceName: "Synthetic", access: ["read"] }],
    }],
  };
}

test("unknown exact-filter field types fail closed instead of degrading to string", () => {
  const query = queryBase();
  query.filters = [{ field: "opaque", parameter: "opaque", mode: "exact" }];
  const detail = {
    key: "synthetic",
    display: { singular: "Synthetic", plural: "Synthetics" },
    fields: [{ key: "opaque", type: "future_type" }],
    query,
  };
  assert.throws(() => projectSelectedModelsToMcp(selection(detail)), /unsupported field type/u);
});

test("request builder rechecks required capability arguments instead of trusting client schema validation", () => {
  const query = queryBase();
  query.capabilityQueries = [{
    key: "synthetic.window",
    capability: "synthetic",
    parameters: [
      { parameter: "windowStartDate", type: "date", required: true },
      { parameter: "windowEndDateExclusive", type: "date", required: true },
    ],
    ordering: { parameter: "sort", values: ["windowStart:asc"] },
  }];
  const detail = {
    key: "synthetic",
    display: { singular: "Synthetic", plural: "Synthetics" },
    fields: [],
    query,
  };
  const projected = projectSelectedModelsToMcp(selection(detail));
  const binding = projected.bindings["lifespace.query.synthetic.synthetic.window"];
  assert.throws(
    () => buildLifeSpaceQueryRequest(binding, { spaceId: "spc_test" }),
    /required argument/u,
  );
});
