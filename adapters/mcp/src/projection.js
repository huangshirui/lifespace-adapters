const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/u;
const HTTP_METHOD_ORDER = ["get", "post", "patch", "delete"];

export class AdapterContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AdapterContractError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new AdapterContractError(code, message);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_CONTRACT", `${label} must be an object`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) fail("INVALID_CONTRACT", `${label} must be an array`);
  return value;
}

function string(value, label) {
  if (typeof value !== "string" || !value) fail("INVALID_CONTRACT", `${label} must be a non-empty string`);
  return value;
}

function safeSegment(value, label) {
  const segment = string(value, label).replace(/[^A-Za-z0-9_.-]/gu, "_");
  if (!segment) fail("INVALID_TOOL_NAME", `${label} cannot be represented in an MCP tool name`);
  return segment;
}

function toolName(spaceId, modelKey, operationKey) {
  const name = `ls.${safeSegment(spaceId, "spaceId")}.${safeSegment(modelKey, "modelKey")}.${safeSegment(operationKey, "operationKey")}`;
  if (!TOOL_NAME_PATTERN.test(name)) {
    fail("INVALID_TOOL_NAME", `Projected MCP tool name is not safely representable: ${name}`);
  }
  return name;
}

function resolvePointer(root, ref) {
  if (!ref.startsWith("#/")) fail("UNSUPPORTED_SCHEMA_REF", `Only local JSON references are supported: ${ref}`);
  let current = root;
  for (const encoded of ref.slice(2).split("/")) {
    const token = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    current = object(current, `reference segment ${token}`)[token];
    if (current === undefined) fail("MISSING_SCHEMA_REF", `Model Contract reference does not exist: ${ref}`);
  }
  return current;
}

function materializeSchema(schema, openapi, stack = []) {
  const current = object(schema, "schema");
  if (typeof current.$ref === "string") {
    if (stack.includes(current.$ref)) fail("CYCLIC_SCHEMA_REF", `Cyclic schema reference is not supported: ${current.$ref}`);
    return materializeSchema(resolvePointer(openapi, current.$ref), openapi, [...stack, current.$ref]);
  }

  const result = {};
  for (const [key, value] of Object.entries(current)) {
    if (key === "$ref") continue;
    if (Array.isArray(value)) {
      result[key] = value.map((item) => item && typeof item === "object" ? materializeSchema(item, openapi, stack) : item);
    } else if (value && typeof value === "object") {
      result[key] = materializeSchema(value, openapi, stack);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function manifestByKey(modelContract) {
  const manifest = object(modelContract.manifest, "modelContract.manifest");
  const models = array(manifest.models, "modelContract.manifest.models");
  return new Map(models.map((entry, index) => {
    const model = object(entry, `manifest.models[${index}]`);
    return [string(model.key, `manifest.models[${index}].key`), model];
  }));
}

function assertModelEvidence(discoveredModel, manifestEntry) {
  if (!manifestEntry) fail("MODEL_CONTRACT_MISSING_MODEL", `Model Contract has no entry for discovered model ${discoveredModel.key}`);
  for (const key of ["route", "schemaHash"]) {
    if (manifestEntry[key] !== discoveredModel[key]) {
      fail("MODEL_CONTRACT_MISMATCH", `Discovery ${discoveredModel.key}.${key} does not match pinned Model Contract evidence`);
    }
  }
}

function requestBodySchema(operation, openapi) {
  const requestBody = operation.requestBody;
  if (!requestBody) return null;

  function resolveBody(value) {
    const body = object(value, "requestBody");
    if (typeof body.$ref === "string") return resolveBody(resolvePointer(openapi, body.$ref));
    const content = object(body.content, "requestBody.content");
    const json = object(content["application/json"], "requestBody.content/application/json");
    return { schema: materializeSchema(json.schema, openapi), required: body.required === true };
  }

  return resolveBody(requestBody);
}

function parameterSchema(parameter, openapi) {
  const resolved = typeof parameter.$ref === "string" ? resolvePointer(openapi, parameter.$ref) : parameter;
  const value = object(resolved, "operation parameter");
  const where = string(value.in, "parameter.in");
  const name = string(value.name, "parameter.name");
  if (!["path", "query"].includes(where)) fail("UNSUPPORTED_PARAMETER", `Unsupported parameter location ${where} for ${name}`);
  return {
    name,
    in: where,
    required: value.required === true || where === "path",
    description: typeof value.description === "string" ? value.description : undefined,
    schema: materializeSchema(value.schema ?? { type: "string" }, openapi),
  };
}

function mergeInput(operation, openapi, fixedPathParameters) {
  const properties = {};
  const required = [];
  const bindings = [];
  const parameters = array(operation.parameters ?? [], "operation.parameters").map((value) => parameterSchema(value, openapi));

  for (const parameter of parameters) {
    if (parameter.in === "path" && fixedPathParameters.has(parameter.name)) continue;
    if (Object.hasOwn(properties, parameter.name)) fail("ARGUMENT_COLLISION", `Duplicate projected argument ${parameter.name}`);
    properties[parameter.name] = {
      ...parameter.schema,
      ...(parameter.description && parameter.schema.description === undefined ? { description: parameter.description } : {}),
    };
    if (parameter.required) required.push(parameter.name);
    bindings.push({ name: parameter.name, in: parameter.in });
  }

  const body = requestBodySchema(operation, openapi);
  if (body) {
    if (Object.hasOwn(properties, "input")) fail("ARGUMENT_COLLISION", "Canonical request body collides with an existing input argument");
    properties.input = {
      ...body.schema,
      title: body.schema.title ?? "LifeSpace Input",
      description: body.schema.description ?? "Canonical LifeSpace JSON request body from the pinned immutable Model Contract Revision.",
    };
    if (body.required) required.push("input");
    bindings.push({ name: "input", in: "body" });
  }

  return {
    inputSchema: {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    },
    argumentBindings: bindings,
  };
}

function operationAt(openapi, path, method) {
  const paths = object(openapi.paths, "modelContract.openapi.paths");
  const pathItem = paths[path];
  if (!pathItem || typeof pathItem !== "object") return null;
  const operation = pathItem[method];
  return operation && typeof operation === "object" ? operation : null;
}

function addOperation(surface, names, context) {
  const { openapi, space, model, path, method, operationKey, title, description, access, actionKey } = context;
  const operation = operationAt(openapi, path, method);
  if (!operation) return;
  const name = toolName(space.spaceId, model.key, operationKey);
  if (names.has(name)) fail("TOOL_NAME_COLLISION", `Projected tool name collision: ${name}`);
  names.add(name);

  const { inputSchema, argumentBindings } = mergeInput(operation, openapi, new Set(["spaceId"]));
  surface.push({
    tool: {
      name,
      title,
      description,
      inputSchema,
    },
    binding: {
      method: method.toUpperCase(),
      pathTemplate: path,
      fixedPathParameters: { spaceId: space.spaceId },
      argumentBindings,
      spaceId: space.spaceId,
      modelKey: model.key,
      operationKey,
      access,
      ...(actionKey ? { actionKey } : {}),
    },
  });
}

function modelDisplay(model) {
  const display = model.display && typeof model.display === "object" ? model.display : {};
  return {
    singular: typeof display.singular === "string" && display.singular ? display.singular : model.key,
    plural: typeof display.plural === "string" && display.plural ? display.plural : model.key,
  };
}

function projectModel(surface, names, openapi, space, model) {
  const access = new Set(array(model.access, `${model.key}.access`));
  const route = string(model.route, `${model.key}.route`);
  const display = modelDisplay(model);
  const base = `/api/v1/spaces/{spaceId}/${route}`;
  const item = `${base}/{recordId}`;

  if (access.has("read")) {
    addOperation(surface, names, {
      openapi, space, model, path: base, method: "get", operationKey: "list", access: "read",
      title: `List ${display.plural} in ${space.spaceName}`,
      description: `List ${display.plural} currently visible in the LifeSpace “${space.spaceName}” Space.`,
    });
    addOperation(surface, names, {
      openapi, space, model, path: item, method: "get", operationKey: "get", access: "read",
      title: `Get ${display.singular} in ${space.spaceName}`,
      description: `Read one ${display.singular} from the LifeSpace “${space.spaceName}” Space.`,
    });
  }

  if (access.has("write")) {
    addOperation(surface, names, {
      openapi, space, model, path: base, method: "post", operationKey: "create", access: "write",
      title: `Create ${display.singular} in ${space.spaceName}`,
      description: `Create one ${display.singular} in the LifeSpace “${space.spaceName}” Space.`,
    });
    addOperation(surface, names, {
      openapi, space, model, path: item, method: "patch", operationKey: "update", access: "write",
      title: `Update ${display.singular} in ${space.spaceName}`,
      description: `Update one ${display.singular} in the LifeSpace “${space.spaceName}” Space using the pinned LifeSpace Model Contract.`,
    });
    addOperation(surface, names, {
      openapi, space, model, path: item, method: "delete", operationKey: "delete", access: "write",
      title: `Delete ${display.singular} in ${space.spaceName}`,
      description: `Delete one ${display.singular} in the LifeSpace “${space.spaceName}” Space using the canonical LifeSpace operation.`,
    });
  }

  for (const actionValue of array(model.actions ?? [], `${model.key}.actions`)) {
    const action = object(actionValue, `${model.key}.action`);
    const key = string(action.key, `${model.key}.action.key`);
    const requiredAccess = string(action.access, `${model.key}.action.access`);
    if (!access.has(requiredAccess)) continue;
    addOperation(surface, names, {
      openapi,
      space,
      model,
      path: `${item}/actions/${key}`,
      method: "post",
      operationKey: `action.${key}`,
      access: requiredAccess,
      actionKey: key,
      title: `${key} ${display.singular} in ${space.spaceName}`,
      description: `Execute the LifeSpace “${key}” action for one ${display.singular} in the “${space.spaceName}” Space.`,
    });
  }
}

export function projectMcpToolSurface({ discovery, modelContract }) {
  const discoveryObject = object(discovery, "discovery");
  const spaces = array(discoveryObject.spaces, "discovery.spaces");
  const contractObject = object(modelContract, "modelContract");
  const openapi = object(contractObject.openapi, "modelContract.openapi");
  const manifest = manifestByKey(contractObject);
  const surface = [];
  const names = new Set();

  for (const [spaceIndex, spaceValue] of spaces.entries()) {
    const space = object(spaceValue, `discovery.spaces[${spaceIndex}]`);
    string(space.spaceId, `discovery.spaces[${spaceIndex}].spaceId`);
    string(space.spaceName, `discovery.spaces[${spaceIndex}].spaceName`);
    for (const modelValue of array(space.models, `discovery.spaces[${spaceIndex}].models`)) {
      const model = object(modelValue, "discovered model");
      string(model.key, "discovered model.key");
      assertModelEvidence(model, manifest.get(model.key));
      projectModel(surface, names, openapi, space, model);
    }
  }

  return surface.sort((left, right) => left.tool.name.localeCompare(right.tool.name));
}

export const __test = { materializeSchema, TOOL_NAME_PATTERN, HTTP_METHOD_ORDER };
