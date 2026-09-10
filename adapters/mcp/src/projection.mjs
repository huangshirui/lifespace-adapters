const JSON_SCHEMA_2020_12 = "https://json-schema.org/draft/2020-12/schema";
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/u;

function fail(message) {
  throw new Error(`LifeSpace MCP projection: ${message}`);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value;
}

function string(value, label) {
  if (typeof value !== "string" || !value) fail(`${label} must be a non-empty string`);
  return value;
}

function toolName(parts) {
  const name = parts.join(".");
  if (!TOOL_NAME_PATTERN.test(name)) fail(`projected tool name ${JSON.stringify(name)} is not MCP-safe`);
  return name;
}

function readableSpaces(selection) {
  return [...selection.spaces]
    .filter((space) => Array.isArray(space.access) && space.access.includes("read"))
    .sort((a, b) => a.spaceId.localeCompare(b.spaceId));
}

function scalarSchemaForType(type) {
  switch (type) {
    case "integer": return { type: "integer" };
    case "number": return { type: "number" };
    case "boolean": return { type: "boolean" };
    case "date": return { type: "string", format: "date" };
    case "datetime": return { type: "string", format: "date-time" };
    case "person_list":
    case "record_list": return { type: "array", items: { type: "string" } };
    default: return { type: "string" };
  }
}

function fieldSchema(field, filter) {
  const schema = scalarSchemaForType(field?.type);
  if (field?.type === "enum") {
    schema.description = field.values?.length
      ? `One value, or a comma-separated set, from: ${field.values.join(", ")}.`
      : "One enum value or a comma-separated set of enum values.";
  }
  if (filter?.acceptsCurrentActorPersonAlias === "me") {
    schema.description = [schema.description, 'The canonical query also accepts the alias "me".']
      .filter(Boolean).join(" ");
  }
  return schema;
}

function comparisonValueSchema(valueType) {
  if (!["date", "datetime", "integer", "number"].includes(valueType)) {
    fail(`unsupported comparison valueType ${JSON.stringify(valueType)}`);
  }
  return scalarSchemaForType(valueType);
}

function addProperty(properties, name, schema) {
  if (Object.hasOwn(properties, name)) fail(`duplicate projected argument ${JSON.stringify(name)}`);
  properties[name] = schema;
}

function addDependencyGroup(dependentRequired, names) {
  for (const name of names) {
    dependentRequired[name] = names.filter((candidate) => candidate !== name);
  }
}

function baseInputSchema(spaces) {
  if (!spaces.length) fail("selected model has no readable Space");
  return {
    $schema: JSON_SCHEMA_2020_12,
    type: "object",
    additionalProperties: false,
    properties: {
      spaceId: {
        type: "string",
        enum: spaces.map((space) => space.spaceId),
        description: "LifeSpace Space in which the query executes. Core rechecks current authority at execution time.",
      },
    },
    required: ["spaceId"],
  };
}

function modelFieldMap(detail) {
  return new Map(array(detail.fields, "semantic detail fields").map((field) => [string(field.key, "field.key"), field]));
}

function genericQueryTool(selection) {
  const detail = object(selection.detail, "selected semantic detail");
  const query = object(detail.query, "semantic detail query");
  const spaces = readableSpaces(selection);
  const schema = baseInputSchema(spaces);
  const dependentRequired = {};
  const fields = modelFieldMap(detail);
  const comparisons = array(query.comparisons, "query.comparisons");
  const comparableFields = new Set(comparisons.map((entry) => string(entry.field, "comparison.field")));

  if (query.search !== null && query.search !== undefined) {
    const search = object(query.search, "query.search");
    addProperty(schema.properties, string(search.parameter, "query.search.parameter"), {
      type: "string",
      ...(Number.isInteger(search.minLength) ? { minLength: search.minLength } : {}),
      ...(Number.isInteger(search.maxLength) ? { maxLength: search.maxLength } : {}),
    });
  }

  for (const filter of array(query.filters, "query.filters")) {
    const fieldKey = string(filter.field, "query.filter.field");
    if (comparableFields.has(fieldKey)) continue;
    const parameter = string(filter.parameter, "query.filter.parameter");
    const field = fields.get(fieldKey);
    if (!field) fail(`filter ${parameter} references unknown field ${fieldKey}`);
    addProperty(schema.properties, parameter, fieldSchema(field, filter));
  }

  for (const comparison of comparisons) {
    const valueSchema = comparisonValueSchema(comparison.valueType);
    for (const operator of array(comparison.operators, `comparison ${comparison.field} operators`)) {
      if (operator.transport !== "explicit") continue;
      const parameter = string(operator.parameter, "comparison operator parameter");
      addProperty(schema.properties, parameter, structuredClone(valueSchema));
    }
    if (comparison.localDateWindow !== undefined) {
      if (comparison.valueType !== "datetime") fail(`local-date window on non-datetime field ${comparison.field}`);
      const window = object(comparison.localDateWindow, `comparison ${comparison.field} localDateWindow`);
      if (window.bounds !== "[)" || window.lowerOperator !== "gte" || window.upperOperator !== "lt") {
        fail(`unsupported local-date-window semantics for ${comparison.field}`);
      }
      const names = [
        string(window.dateStartParameter, "local-date dateStartParameter"),
        string(window.dateEndExclusiveParameter, "local-date dateEndExclusiveParameter"),
        string(window.timezoneParameter, "local-date timezoneParameter"),
      ];
      addProperty(schema.properties, names[0], { type: "string", format: "date" });
      addProperty(schema.properties, names[1], { type: "string", format: "date" });
      addProperty(schema.properties, names[2], {
        type: "string",
        description: "IANA viewing timezone. LifeSpace Core performs the DST-safe local-date to instant conversion.",
      });
      addDependencyGroup(dependentRequired, names);
    }
  }

  const sort = object(query.sort, "query.sort");
  const genericValues = array(sort.genericValues, "query.sort.genericValues");
  if (genericValues.length) {
    addProperty(schema.properties, string(sort.parameter, "query.sort.parameter"), {
      type: "array",
      minItems: 1,
      maxItems: Number.isInteger(sort.maxCriteria) ? sort.maxCriteria : 8,
      items: { type: "string", enum: [...genericValues] },
      description: "Ordered Generic Query sort criteria. The array order is significant.",
    });
  }

  const pagination = object(query.pagination, "query.pagination");
  const limit = object(pagination.limit, "query.pagination.limit");
  addProperty(schema.properties, string(limit.parameter, "query.pagination.limit.parameter"), {
    type: "integer",
    ...(Number.isFinite(limit.minimum) ? { minimum: limit.minimum } : {}),
    ...(Number.isFinite(limit.maximum) ? { maximum: limit.maximum } : {}),
  });
  const cursor = object(pagination.cursor, "query.pagination.cursor");
  addProperty(schema.properties, string(cursor.parameter, "query.pagination.cursor.parameter"), { type: "string" });

  if (Object.keys(dependentRequired).length) schema.dependentRequired = dependentRequired;

  const name = toolName(["lifespace", "query", string(detail.key, "semantic detail key")]);
  const display = object(detail.display, "semantic detail display");
  const binding = {
    kind: "model-query",
    toolName: name,
    modelKey: detail.key,
    allowedSpaceIds: spaces.map((space) => space.spaceId),
    allowedArguments: Object.keys(schema.properties).filter((key) => key !== "spaceId").sort(),
    repeatableArguments: genericValues.length ? [sort.parameter] : [],
    dependencyGroups: Object.keys(dependentRequired).length
      ? Object.entries(dependentRequired).map(([key, companions]) => [key, ...companions].sort()).filter((group, index, groups) => groups.findIndex((candidate) => candidate.join("\0") === group.join("\0")) === index)
      : [],
  };
  return {
    tool: {
      name,
      title: `Query ${display.plural}`,
      description: `Query ${display.plural} through canonical LifeSpace Generic Query. Current authority is rechecked by LifeSpace Core when the request executes.`,
      inputSchema: schema,
    },
    binding,
  };
}

function capabilityQueryTools(selection) {
  const detail = object(selection.detail, "selected semantic detail");
  const query = object(detail.query, "semantic detail query");
  const spaces = readableSpaces(selection);
  const pagination = object(query.pagination, "query.pagination");
  const tools = [];

  for (const capabilityQuery of array(query.capabilityQueries, "query.capabilityQueries")) {
    const key = string(capabilityQuery.key, "capability query key");
    const capability = string(capabilityQuery.capability, "capability query capability");
    const schema = baseInputSchema(spaces);
    const required = [];

    for (const parameter of array(capabilityQuery.parameters, `capability query ${key} parameters`)) {
      const name = string(parameter.parameter, `capability query ${key} parameter`);
      let parameterSchema;
      switch (parameter.type) {
        case "date": parameterSchema = { type: "string", format: "date" }; break;
        case "datetime": parameterSchema = { type: "string", format: "date-time" }; break;
        case "boolean": parameterSchema = { type: "boolean" }; break;
        case "timezone": parameterSchema = { type: "string", description: "IANA timezone." }; break;
        default: fail(`unsupported capability query parameter type ${JSON.stringify(parameter.type)} for ${key}`);
      }
      addProperty(schema.properties, name, parameterSchema);
      if (parameter.required === true) required.push(name);
    }
    schema.required.push(...required);

    const ordering = object(capabilityQuery.ordering, `capability query ${key} ordering`);
    const orderingParameter = string(ordering.parameter, `capability query ${key} ordering parameter`);
    const orderingValues = array(ordering.values, `capability query ${key} ordering values`);
    addProperty(schema.properties, orderingParameter, { type: "string", enum: [...orderingValues] });

    const limit = object(pagination.limit, "query.pagination.limit");
    const cursor = object(pagination.cursor, "query.pagination.cursor");
    addProperty(schema.properties, string(limit.parameter, "query.pagination.limit.parameter"), {
      type: "integer",
      ...(Number.isFinite(limit.minimum) ? { minimum: limit.minimum } : {}),
      ...(Number.isFinite(limit.maximum) ? { maximum: limit.maximum } : {}),
    });
    addProperty(schema.properties, string(cursor.parameter, "query.pagination.cursor.parameter"), { type: "string" });

    const name = toolName(["lifespace", "query", string(detail.key, "semantic detail key"), key]);
    tools.push({
      tool: {
        name,
        title: `${capability} query for ${detail.display?.plural ?? detail.key}`,
        description: `Run LifeSpace ${key} semantics for ${detail.display?.plural ?? detail.key}. Only parameters declared by this capability query are exposed; LifeSpace Core owns timezone, overlap, authorization, and other semantic execution rules.`,
        inputSchema: schema,
      },
      binding: {
        kind: "capability-query",
        capabilityQueryKey: key,
        toolName: name,
        modelKey: detail.key,
        allowedSpaceIds: spaces.map((space) => space.spaceId),
        allowedArguments: Object.keys(schema.properties).filter((property) => property !== "spaceId").sort(),
        repeatableArguments: [],
        dependencyGroups: required.length > 1 ? [required.slice().sort()] : [],
      },
    });
  }
  return tools;
}

export function projectSelectedModelsToMcp(selectionSet) {
  const projected = [];
  for (const selection of array(selectionSet.models, "selected models")) {
    projected.push(genericQueryTool(selection), ...capabilityQueryTools(selection));
  }
  projected.sort((a, b) => a.tool.name.localeCompare(b.tool.name));
  const bindings = Object.fromEntries(projected.map(({ binding }) => [binding.toolName, binding]));
  return { tools: projected.map(({ tool }) => tool), bindings };
}

function assertArguments(binding, args) {
  object(args, "tool arguments");
  const spaceId = string(args.spaceId, "spaceId");
  if (!binding.allowedSpaceIds.includes(spaceId)) fail(`Space ${JSON.stringify(spaceId)} is not in the projected readable Space set`);
  const allowed = new Set(["spaceId", ...binding.allowedArguments]);
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) fail(`argument ${JSON.stringify(key)} was not projected for ${binding.toolName}`);
  }
  for (const group of binding.dependencyGroups ?? []) {
    const present = group.filter((name) => args[name] !== undefined);
    if (present.length > 0 && present.length !== group.length) {
      fail(`arguments ${group.join(", ")} must be supplied together`);
    }
  }
  return spaceId;
}

function serializeQueryValue(value, name) {
  if (["string", "number", "boolean"].includes(typeof value)) return String(value);
  fail(`argument ${JSON.stringify(name)} must be a scalar or supported repeatable array`);
}

export function buildLifeSpaceQueryRequest(binding, args) {
  const spaceId = assertArguments(binding, args);
  const repeatable = new Set(binding.repeatableArguments ?? []);
  const entries = [];
  for (const name of binding.allowedArguments) {
    const value = args[name];
    if (value === undefined) continue;
    if (repeatable.has(name)) {
      if (!Array.isArray(value) || value.length === 0) fail(`argument ${JSON.stringify(name)} must be a non-empty array`);
      for (const item of value) entries.push([name, serializeQueryValue(item, name)]);
    } else {
      if (Array.isArray(value)) fail(`argument ${JSON.stringify(name)} is not repeatable`);
      entries.push([name, serializeQueryValue(value, name)]);
    }
  }
  const params = new URLSearchParams();
  for (const [name, value] of entries) params.append(name, value);
  return {
    method: "GET",
    path: `/api/v1/spaces/${encodeURIComponent(spaceId)}/models/${encodeURIComponent(binding.modelKey)}/records`,
    query: params.toString(),
  };
}
