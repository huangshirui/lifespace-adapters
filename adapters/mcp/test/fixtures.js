export function modelContractFixture() {
  return {
    id: "mct_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    manifest: {
      models: [
        { key: "task", route: "tasks", version: 5, schemaHash: "1".repeat(64) },
      ],
    },
    openapi: {
      openapi: "3.1.0",
      paths: {
        "/api/v1/spaces/{spaceId}/tasks": {
          get: {
            parameters: [
              { name: "spaceId", in: "path", required: true, schema: { type: "string" } },
              { name: "q", in: "query", schema: { type: "string", maxLength: 200 } },
              { name: "sort", in: "query", schema: { type: "array", items: { type: "string" }, maxItems: 8 } },
            ],
          },
          post: {
            parameters: [{ name: "spaceId", in: "path", required: true, schema: { type: "string" } }],
            requestBody: {
              required: true,
              content: { "application/json": { schema: { $ref: "#/components/schemas/TaskCreate" } } },
            },
          },
        },
        "/api/v1/spaces/{spaceId}/tasks/{recordId}": {
          get: {
            parameters: [
              { name: "spaceId", in: "path", required: true, schema: { type: "string" } },
              { name: "recordId", in: "path", required: true, schema: { type: "string" } },
            ],
          },
          patch: {
            parameters: [
              { name: "spaceId", in: "path", required: true, schema: { type: "string" } },
              { name: "recordId", in: "path", required: true, schema: { type: "string" } },
            ],
            requestBody: {
              required: true,
              content: { "application/json": { schema: { $ref: "#/components/schemas/TaskUpdate" } } },
            },
          },
        },
        "/api/v1/spaces/{spaceId}/tasks/{recordId}/actions/complete": {
          post: {
            parameters: [
              { name: "spaceId", in: "path", required: true, schema: { type: "string" } },
              { name: "recordId", in: "path", required: true, schema: { type: "string" } },
            ],
            requestBody: {
              required: true,
              content: { "application/json": { schema: { $ref: "#/components/schemas/TaskCompleteRequest" } } },
            },
            "x-lifespace-concurrency": {
              strategy: "record-version",
              required: true,
              transport: { in: "body", name: "version" },
            },
          },
        },
        "/api/v1/model-admin/models": {
          get: { parameters: [] },
        },
      },
      components: {
        schemas: {
          TaskCreate: {
            type: "object",
            properties: {
              name: { type: "string", title: "Name", minLength: 1, maxLength: 200 },
              note: { anyOf: [{ type: "string", maxLength: 1000 }, { type: "null" }] },
            },
            required: ["name"],
            additionalProperties: false,
          },
          TaskUpdate: {
            type: "object",
            properties: {
              name: { type: "string", minLength: 1, maxLength: 200 },
              version: { type: "integer", minimum: 1, "x-lifespace-input-role": "concurrency" },
            },
            required: ["version"],
            additionalProperties: false,
          },
          TaskCompleteRequest: {
            type: "object",
            properties: {
              note: { anyOf: [{ type: "string", maxLength: 1000 }, { type: "null" }] },
              version: { type: "integer", minimum: 1, "x-lifespace-input-role": "concurrency" },
            },
            required: ["version"],
            additionalProperties: false,
          },
        },
      },
    },
  };
}

export function discoveryFixture({ access = ["read", "write"], spaces = ["spc_alpha"], includeAction = true } = {}) {
  return {
    spaces: spaces.map((spaceId, index) => ({
      spaceId,
      spaceName: index === 0 ? "Example Home" : `Example Space ${index + 1}`,
      models: [
        {
          key: "task",
          route: "tasks",
          version: 5,
          schemaHash: "1".repeat(64),
          display: { singular: "Task", plural: "Tasks" },
          description: "Synthetic task model",
          access,
          fields: [],
          defaults: { status: "pending" },
          query: {},
          actions: includeAction && access.includes("write")
            ? [{ key: "complete", access: "write", kind: "workflow", input: { fields: [] }, concurrency: { strategy: "record-version", required: true, transport: { in: "body", name: "version" } } }]
            : [],
          capabilities: [],
        },
      ],
    })),
  };
}
