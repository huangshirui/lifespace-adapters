import assert from "node:assert/strict";
import test from "node:test";
import { buildLifeSpaceQueryRequest, projectSelectedModelsToMcp } from "../src/projection.mjs";

function canonical() {
  return {
    invocation: { method: "POST", pathTemplate: "/api/v1/spaces/{spaceId}/models/{modelKey}/records/query" },
    composition: {
      selectionFacets: ["search", "filter"],
      selectionCombine: "intersection",
      ordering: "sort",
      pagination: "cursor-pagination",
    },
    search: null,
    filter: {
      maxDepth: 2,
      maxNodes: 3,
      targets: [{ field: "createdAt", kind: "envelope", valueType: "datetime", operators: ["eq", "within"], nullable: false }],
    },
    sort: {
      fields: ["createdAt"], directions: ["asc", "desc"], maxCriteria: 2,
      default: [{ field: "createdAt", direction: "desc" }], nullPlacement: "last", stableTieBreaker: "record-id-asc",
    },
    pagination: {
      limit: { minimum: 1, maximum: 200, default: 100 },
      cursor: { opaque: true, binds: [], snapshotConsistency: false },
    },
  };
}

function selection(value = canonical()) {
  return {
    models: [{
      detail: { key: "synthetic", display: { singular: "Synthetic", plural: "Synthetics" }, query: { canonical: value } },
      spaces: [{ spaceId: "spc_test", spaceName: "Synthetic", access: ["read"] }],
    }],
  };
}

test("missing Canonical Query metadata fails closed", () => {
  const selected = selection();
  delete selected.models[0].detail.query.canonical;
  assert.throws(() => projectSelectedModelsToMcp(selected), /query\.canonical must be an object/u);
});

test("unknown invocation and composition fail closed", () => {
  const get = canonical();
  get.invocation.method = "GET";
  assert.throws(() => projectSelectedModelsToMcp(selection(get)), /invocation is unsupported/u);

  const reordered = canonical();
  reordered.composition.selectionFacets = ["filter", "search"];
  assert.throws(() => projectSelectedModelsToMcp(selection(reordered)), /composition is unsupported/u);

  const sequential = canonical();
  sequential.composition.selectionCombine = "sequence";
  assert.throws(() => projectSelectedModelsToMcp(selection(sequential)), /composition is unsupported/u);
});

test("duplicate filter targets fail closed", () => {
  const value = canonical();
  value.filter.targets.push(structuredClone(value.filter.targets[0]));
  assert.throws(() => projectSelectedModelsToMcp(selection(value)), /duplicate canonical filter target/u);
});

test("advancedFilter rechecks depth and node bounds", () => {
  const projected = projectSelectedModelsToMcp(selection());
  const binding = projected.bindings["lifespace.query.synthetic"];
  assert.throws(
    () => buildLifeSpaceQueryRequest(binding, {
      spaceId: "spc_test",
      advancedFilter: { and: [{ or: [{ field: "createdAt", op: "eq", value: "2026-09-01T00:00:00Z" }] }] },
    }),
    /exceeds maxDepth/u,
  );
  assert.throws(
    () => buildLifeSpaceQueryRequest(binding, {
      spaceId: "spc_test",
      advancedFilter: { and: [
        { field: "createdAt", op: "eq", value: "a" },
        { field: "createdAt", op: "eq", value: "b" },
        { field: "createdAt", op: "eq", value: "c" },
      ] },
    }),
    /exceeds maxNodes/u,
  );
});

test("malformed range operands fail closed rather than being normalized locally", () => {
  const projected = projectSelectedModelsToMcp(selection());
  const binding = projected.bindings["lifespace.query.synthetic"];
  assert.throws(
    () => buildLifeSpaceQueryRequest(binding, {
      spaceId: "spc_test",
      filters: [{ field: "createdAt", operator: "within", value: { kind: "local_date_window", startDate: "2026-09-01" } }],
    }),
    /endDateExclusive/u,
  );
});