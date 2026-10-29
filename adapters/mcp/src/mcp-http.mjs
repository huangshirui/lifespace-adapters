import { createMcpHandler, fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import { resolveMcpEndpoint, projectDomainQuerySurface } from "./domain-projection.mjs";
import { buildLifeSpaceQueryRequest } from "./projection.mjs";
import { findTaskCapabilities, resolveGeneralQueryBinding, GENERAL_QUERY_INPUT_SCHEMA, GENERAL_DISCOVERY_INPUT_SCHEMA } from "./general-discovery.mjs";

function response(message, status, headers = {}) {
  return new Response(message, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true; // non-browser MCP clients commonly omit Origin
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function trustedContext(value) {
  return value && typeof value === "object"
    && typeof value.fetchJson === "function"
    && typeof value.executeQuery === "function";
}

/**
 * Stateless Streamable HTTP transport for the existing read-only query projection.
 *
 * authorizeRequest MUST verify an OAuth/Identity credential and return functions
 * bound to the verified LifeSpace Principal / Actor / Application context.
 * There is deliberately no anonymous mode, token forwarding shortcut, or
 * deployable Worker entrypoint without a genuine authorization bridge.
 *
 * fetchJson(path) must query LifeSpace Core as that caller.
 * executeQuery({ method, path, body }) must execute as that same caller.
 */
export function createAuthenticatedMcpHttpHandler({ authorizeRequest } = {}) {
  if (typeof authorizeRequest !== "function") {
    throw new TypeError("A trusted authorizeRequest function is required");
  }
  return async function fetchMcp(request) {
    if (!(request instanceof Request)) return response("Invalid request", 400);
    const pathname = new URL(request.url).pathname;
    const endpoint = resolveMcpEndpoint(pathname);
    if (!endpoint) return response("MCP endpoint not found", 404);
    if (!sameOrigin(request)) return response("Origin not allowed", 403);
    let context;
    try {
      context = await authorizeRequest(request, { pathname, domain: endpoint.domain });
    } catch {
      return response("Unauthorized", 401, { "WWW-Authenticate": 'Bearer realm="lifespace-mcp"' });
    }
    if (!trustedContext(context)) {
      return response("Unauthorized", 401, { "WWW-Authenticate": 'Bearer realm="lifespace-mcp"' });
    }

    let projection = { tools: [], bindings: {} };
    if (endpoint.kind === "domain") {
      try {
        projection = await projectDomainQuerySurface({
          endpoint: pathname,
          fetchJson: context.fetchJson,
        });
      } catch {
        // Do not serialize upstream credential, Space, model or provider errors.
        return response("MCP discovery unavailable", 502);
      }
    }

    // A fresh server/handler is built for this authenticated HTTP request.
    // Do not cache another caller's inventory, schemas, or execution bindings.
    const handler = createMcpHandler(() => {
      const server = new McpServer({
        name: `lifespace-${endpoint.domain ?? "general"}`,
        version: "0.1.0",
      });
      if (endpoint.kind === "general") {
        server.registerTool("lifespace.find_capabilities", {
          description: "Find only currently readable LifeSpace models relevant to a task. Use before query_records; never enumerates unauthorized models.",
          inputSchema: fromJsonSchema(GENERAL_DISCOVERY_INPUT_SCHEMA),
          annotations: { readOnlyHint: true, destructiveHint: false },
        }, async ({ intent, limit }) => {
          try {
            const matches = await findTaskCapabilities({ fetchJson: context.fetchJson, intent, limit });
            return { content: [{ type: "text", text: JSON.stringify({ capabilities: matches }) }] };
          } catch {
            return { isError: true, content: [{ type: "text", text: "LifeSpace capability search unavailable" }] };
          }
        });

        server.registerTool("lifespace.query_records", {
          description: "Query one model in one currently readable Space after find_capabilities. Query fields/operators are resolved from current LifeSpace semantic detail; never allows write or platform admin.",
          inputSchema: fromJsonSchema(GENERAL_QUERY_INPUT_SCHEMA),
          annotations: { readOnlyHint: true, destructiveHint: false },
        }, async ({ modelKey, spaceId, ...args }) => {
          try {
            const binding = await resolveGeneralQueryBinding({ fetchJson: context.fetchJson, modelKey, spaceId });
            const operation = buildLifeSpaceQueryRequest(binding, { spaceId, ...args });
            const result = await context.executeQuery(operation);
            return { content: [{ type: "text", text: JSON.stringify(result) }] };
          } catch {
            return { isError: true, content: [{ type: "text", text: "LifeSpace query denied or unavailable" }] };
          }
        });
      }
      for (const tool of projection.tools) {
        const binding = projection.bindings[tool.name];
        if (!binding) throw new Error("Missing trusted query binding");
        server.registerTool(
          tool.name,
          {
            title: tool.title,
            description: tool.description,
            inputSchema: fromJsonSchema(tool.inputSchema),
            annotations: { readOnlyHint: true, destructiveHint: false },
          },
          async (args) => {
            try {
              const operation = buildLifeSpaceQueryRequest(binding, args);
              if (operation.method !== "POST" || !operation.path.startsWith("/api/v1/spaces/")) {
                throw new Error("Unsupported Core operation");
              }
              // The authenticated executor MUST call Core to recheck current
              // access; a cached MCP tools/list is never authorization proof.
              const result = await context.executeQuery(operation);
              return { content: [{ type: "text", text: JSON.stringify(result) }] };
            } catch {
              return {
                isError: true,
                content: [{ type: "text", text: "LifeSpace query denied or unavailable" }],
              };
            }
          },
        );
      }
      return server;
    });
    return handler.fetch(request);
  };
}
