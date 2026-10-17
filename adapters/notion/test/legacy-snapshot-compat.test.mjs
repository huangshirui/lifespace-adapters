import test from "node:test";
import assert from "node:assert/strict";
import {
  projectRecord,
  translateQuery,
  translateWrite,
} from "../src/provider.mjs";

const resourceId = "11111111111111111111111111111111";
const pageId = "22222222222222222222222222222222";

function legacySnapshot() {
  return {
    resourceId,
    displayName: "Legacy synthetic records",
    fields: [{
      key: "amount",
      sourceFieldId: "stable_property",
      title: "Amount",
      type: "number",
      nullable: true,
      readable: true,
      writable: true,
      operators: ["eq", "gt"],
      sortable: true,
    }],
    capabilities: {
      get: true,
      query: true,
      create: true,
      update: true,
      delete: true,
      batchWrite: true,
      atomicBatch: false,
      transaction: false,
      versionedWrite: false,
      actions: false,
      relationTargetResolution: false,
    },
    queryLimits: { maxDepth: 2, maxNodes: 100, maxSort: 8, maxPageSize: 100 },
    // Pre-#376 snapshots keyed codecs by the old public field key instead of
    // provider sourceFieldId. Core can now migrate the public key locally, so
    // the Adapter must still resolve this provider codec without rediscovery.
    adapterState: {
      codecs: {
        f_0123456789abcdef0123456789abcdef: {
          id: "stable_property",
          type: "number",
        },
      },
    },
  };
}

test("legacy adapterState codec keys survive Core stable-key migration", () => {
  const snapshot = legacySnapshot();

  assert.deepEqual(translateWrite(snapshot, { amount: 9 }), {
    stable_property: { number: 9 },
  });

  assert.deepEqual(
    translateQuery(snapshot, {
      filter: { field: "amount", op: "gt", value: 5 },
      sort: [{ field: "amount", direction: "asc" }],
      page: { limit: 25 },
    }),
    {
      page_size: 25,
      filter: { property: "stable_property", number: { greater_than: 5 } },
      sorts: [{ property: "stable_property", direction: "ascending" }],
    },
  );

  assert.deepEqual(
    projectRecord(snapshot, {
      object: "page",
      id: pageId,
      parent: { type: "data_source_id", data_source_id: resourceId },
      properties: {
        Amount: { id: "stable_property", type: "number", number: 8 },
      },
      created_time: "2026-10-01T00:00:00Z",
      last_edited_time: "2026-10-02T00:00:00Z",
      archived: false,
      in_trash: false,
    }),
    {
      id: `rec_external_${resourceId}_${pageId}`,
      data: { amount: 8 },
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-02T00:00:00Z",
    },
  );
});