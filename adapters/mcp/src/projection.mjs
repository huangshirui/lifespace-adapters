const JSON_SCHEMA_2020_12 = "https://json-schema.org/draft/2020-12/schema";
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/u;
const CANONICAL_PATH = "/api/v1/spaces/{spaceId}/models/{modelKey}/records/query";
const CANONICAL_COMPOSITION = Object.freeze({
  selectionFacets: ["search", "filter"],
  selectionCombine: "intersection",
  ordering: "sort",
  pagination: "cursor-pagination",
});
const NULL_OPERATORS = new Set(["isNull", "isNotNull"]);

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

function exactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${label} contains unsupported property ${JSON.stringify(key)}`);
  }
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

function rangeOperandSchema(target) {
  const variants = [{
    type: "object",
    additionalProperties: false,
    required: ["kind", "startDate", "endDateExclusive", "timezone"],
    properties: {
      kind: { const: "local_date_window" },
      startDate: { type: "string", format: "date" },
      endDateExclusive: { type: "string", format: "date" },
      timezone: { type: "string", description: "IANA timezone; Core owns DST-safe conversion." },
    },
  }];

  if (["date", "date-range", "temporal-range"].includes(target.valueType)) {
    variants.push({
      type: "object",
      additionalProperties: false,
      required: ["kind", "start", "endExclusive"],
      properties: {
        kind: { const: "date" },
        start: { type: "string", format: "date" },
        endExclusive: { type: "string", format: "date" },
      },
    });
  }
  if (["datetime", "instant-range", "temporal-range"].includes(target.valueType)) {
    variants.push({
      type: "object",
      additionalProperties: false,
      required: ["kind", "start", "endExclusive"],
      properties: {
        kind: { const: "instant" },
        start: { type: "string", format: "date-time" },
        endExclusive: { type: "string", format: "date-time" },
      },
    });
  }
  return { oneOf: variants };
}

function scalarValueSchema(target) {
  if (target.valueType === "integer") return { type: "integer" };
  if (target.valueType === "number") return { type: "number" };
  if (target.valueType === "boolean") return { type: "boolean" };
  if (target.valueType === "date") return { type: "string", format: "date" };
  if (target.valueType === "datetime") return { type: "string", format: "date-time" };
  return { type: "string", minLength: 1 };
}

function predicateValueSchema(target, operator) {
  const rangeOperator = ["within", "overlaps", "before", "after"].includes(operator)
    || (operator === "contains" && ["date-range", "instant-range", "temporal-range"].includes(target.valueType));
  if (rangeOperator) return rangeOperandSchema(target);
  if (operator === "kindIs") return { type: "string", enum: ["date", "instant"] };
  return scalarValueSchema(target);
}

function flatFilterBranches(canonical) {
  const filter = object(canonical.filter, "query.canonical.filter");
  const targets = array(filter.targets, "query.canonical.filter.targets");
  if (!targets.length) fail("query.canonical.filter.targets must not be empty");
  const branches = [];
  for (const target of targets) {
    const field = string(target.field, "canonical filter target field");
    for (const rawOperator of array(target.operators, `canonical filter target ${field} operators`)) {
      const operator = string(rawOperator, `canonical filter target ${field} operator`);
      const properties = {
        field: { type: "string", enum: [field] },
        operator: { type: "string", enum: [operator] },
      };
      const required = ["field", "operator"];
      if (!NULL_OPERATORS.has(operator)) {
        properties.value = predicateValueSchema(target, operator);
        required.push("value");
      }
      branches.push({ type: "object", additionalProperties: false, required, properties });
    }
  }
  return branches;
}

function advancedFilterSchema(canonical) {
  const filter = object(canonical.filter, "query.canonical.filter");
  const targets = array(filter.targets, "query.canonical.filter.targets");
  if (!targets.length) fail("query.canonical.filter.targets must not be empty");
  const fields = [];
  const operators = new Set();
  for (const target of targets) {
    fields.push(string(target.field, "canonical filter target field"));
    for (const operator of array(target.operators, `canonical filter target ${target.field} operators`)) {
      operators.add(string(operator, `canonical filter target ${target.field} operator`));
    }
  }
  const valueOperators = [...operators].filter((operator) => !NULL_OPERATORS.has(operator)).sort();
  const nullOperators = [...operators].filter((operator) => NULL_OPERATORS.has(operator)).sort();
  const variants = [
    {
      type: "object", additionalProperties: false, required: ["and"],
      properties: { and: { type: "array", minItems: 1, maxItems: filter.maxNodes, items: { $ref: "#/$defs/advancedFilterNode" } } },
    },
    {
      type: "object", additionalProperties: false, required: ["or"],
      properties: { or: { type: "array", minItems: 1, maxItems: filter.maxNodes, items: { $ref: "#/$defs/advancedFilterNode" } } },
    },
  ];
  if (nullOperators.length) {
    variants.push({
      type: "object", additionalProperties: false, required: ["field", "op"],
      properties: { field: { type: "string", enum: [...new Set(fields)].sort() }, op: { type: "string", enum: nullOperators } },
    });
  }
  if (valueOperators.length) {
    variants.push({
      type: "object", additionalProperties: false, required: ["field", "op", "value"],
      properties: {
        field: { type: "string", enum: [...new Set(fields)].sort() },
        op: { type: "string", enum: valueOperators },
        value: {
          description: "Core validates the value against the selected field semantic type and operator.",
          oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "object" }],
        },
      },
    });
  }
  return {
    oneOf: variants,
    "x-lifespace-max-depth": filter.maxDepth,
    "x-lifespace-max-nodes": filter.maxNodes,
    "x-lifespace-operator-selection": "derived-from-field-semantic-type",
    "x-lifespace-targets": structuredClone(targets),
  };
}

function assertCanonicalComposition(canonical) {
  const composition = object(canonical.composition, "query.canonical.composition");
  if (JSON.stringify(composition) !== JSON.stringify(CANONICAL_COMPOSITION)) {
    fail("query.canonical composition is unsupported");
  }
}

function canonicalQueryTool(selection) {
  const detail = object(selection.detail, "selected semantic detail");
  const query = object(detail.query, "semantic detail query");
  const canonical = object(query.canonical, "query.canonical");
  const invocation = object(canonical.invocation, "query.canonical.invocation");
  if (invocation.method !== "POST" || invocation.pathTemplate !== CANONICAL_PATH) {
    fail("query.canonical invocation is unsupported");
  }
  assertCanonicalComposition(canonical);

  const spaces = readableSpaces(selection);
  const schema = baseInputSchema(spaces);
  schema.$defs = { advancedFilterNode: advancedFilterSchema(canonical) };
  const targetMap = {};
  for (const target of canonical.filter.targets) {
    if (Object.hasOwn(targetMap, target.field)) fail(`duplicate canonical filter target ${JSON.stringify(target.field)}`);
    targetMap[target.field] = structuredClone(target);
  }

  let search = null;
  if (canonical.search !== null) {
    search = object(canonical.search, "query.canonical.search");
    array(search.fields, "query.canonical.search.fields");
    schema.properties.search = {
      type: "string",
      ...(Number.isInteger(search.minLength) ? { minLength: search.minLength } : {}),
      ...(Number.isInteger(search.maxLength) ? { maxLength: search.maxLength } : {}),
      description: `Keyword search across ${search.fields.join(", ")}. Search and filters jointly constrain the candidate set.`,
      "x-lifespace-searchable-fields": structuredClone(search.fields),
    };
  }

  const simpleFilterBranches = flatFilterBranches(canonical);
  if (simpleFilterBranches.length) {
    schema.properties.filters = {
      type: "array",
      maxItems: canonical.filter.maxNodes,
      items: { oneOf: simpleFilterBranches },
      description: "High-frequency typed predicates combined with AND. Use advancedFilter instead when nested AND/OR logic is required.",
    };
    schema.properties.advancedFilter = {
      $ref: "#/$defs/advancedFilterNode",
      description: "Optional nested Canonical Filter AST for advanced Boolean logic. Do not combine with filters.",
    };
  }

  const sort = object(canonical.sort, "query.canonical.sort");
  const sortFields = array(sort.fields, "query.canonical.sort.fields").map((field) => string(field, "canonical sort field"));
  const directions = array(sort.directions, "query.canonical.sort.directions").map((direction) => string(direction, "canonical sort direction"));
  schema.properties.sort = {
    type: "array", minItems: 1, maxItems: sort.maxCriteria,
    items: {
      type: "object", additionalProperties: false, required: ["field", "direction"],
      properties: { field: { type: "string", enum: sortFields }, direction: { type: "string", enum: directions } },
    },
    default: structuredClone(sort.default),
    "x-lifespace-null-placement": sort.nullPlacement,
    "x-lifespace-stable-tie-breaker": sort.stableTieBreaker,
  };

  const pagination = object(canonical.pagination, "query.canonical.pagination");
  const limit = object(pagination.limit, "query.canonical.pagination.limit");
  const cursor = object(pagination.cursor, "query.canonical.pagination.cursor");
  if (cursor.opaque !== true) fail("query.canonical cursor must be opaque");
  schema.properties.limit = {
    type: "integer", minimum: limit.minimum, maximum: limit.maximum,
    ...(Number.isInteger(limit.default) ? { default: limit.default } : {}),
    description: "Maximum records to return.",
  };
  schema.properties.cursor = {
    type: "string",
    minLength: 1,
    description: "Opaque pagination cursor from the previous result.",
  };

  const name = toolName(["lifespace", "query", string(detail.key, "semantic detail key")]);
  const display = object(detail.display, "semantic detail display");
  return {
    tool: {
      name,
      title: `Query ${display.plural}`,
      description: `Query ${display.plural} through LifeSpace Canonical Query. Keyword Search and typed filters jointly constrain the candidate set; Sort and cursor Pagination apply afterwards. Core rechecks current authority at execution time.`,
      inputSchema: schema,
    },
    binding: {
      kind: "canonical-model-query",
      toolName: name,
      modelKey: detail.key,
      method: invocation.method,
      pathTemplate: invocation.pathTemplate,
      allowedSpaceIds: spaces.map((space) => space.spaceId),
      search: search === null ? null : { minLength: search.minLength, maxLength: search.maxLength },
      filter: { maxDepth: canonical.filter.maxDepth, maxNodes: canonical.filter.maxNodes, targets: targetMap },
      sort: { fields: sortFields, directions, maxCriteria: sort.maxCriteria },
      page: { minimum: limit.minimum, maximum: limit.maximum },
    },
  };
}

export function projectSelectedModelsToMcp(selectionSet) {
  const projected = array(selectionSet.models, "selected models").map(canonicalQueryTool);
  projected.sort((a, b) => a.tool.name.localeCompare(b.tool.name));
  return {
    tools: projected.map(({ tool }) => tool),
    bindings: Object.fromEntries(projected.map(({ binding }) => [binding.toolName, binding])),
  };
}

function validateRangeOperand(value, label) {
  const range = object(value, label);
  if (range.kind === "local_date_window") {
    exactKeys(range, ["kind", "startDate", "endDateExclusive", "timezone"], label);
    string(range.startDate, `${label}.startDate`);
    string(range.endDateExclusive, `${label}.endDateExclusive`);
    string(range.timezone, `${label}.timezone`);
    return;
  }
  if (range.kind === "date" || range.kind === "instant") {
    exactKeys(range, ["kind", "start", "endExclusive"], label);
    string(range.start, `${label}.start`);
    string(range.endExclusive, `${label}.endExclusive`);
    return;
  }
  fail(`${label}.kind is not a canonical range kind`);
}

function validatePredicateValue(value, label) {
  if (["string", "number", "boolean"].includes(typeof value)) return;
  validateRangeOperand(value, label);
}

function validateCanonicalPredicate(binding, node, label, operatorProperty = "op") {
  object(node, label);
  const allowedKeys = operatorProperty === "operator" ? ["field", "operator", "value"] : ["field", "op", "value"];
  const field = string(node.field, `${label}.field`);
  const op = string(node[operatorProperty], `${label}.${operatorProperty}`);
  const target = binding.filter.targets[field];
  if (!target) fail(`filter field ${JSON.stringify(field)} was not projected`);
  if (!target.operators.includes(op)) fail(`operator ${JSON.stringify(op)} was not projected for filter field ${JSON.stringify(field)}`);
  if (NULL_OPERATORS.has(op)) {
    exactKeys(node, allowedKeys.slice(0, 2), label);
    return { field, op };
  }
  exactKeys(node, allowedKeys, label);
  if (!Object.hasOwn(node, "value")) fail(`filter predicate ${field}.${op} requires value`);
  validatePredicateValue(node.value, `${label} ${field}.${op} value`);
  return { field, op, value: structuredClone(node.value) };
}

function validateAdvancedFilter(binding, node, state, depth = 1) {
  object(node, "advancedFilter node");
  state.nodes += 1;
  if (state.nodes > binding.filter.maxNodes) fail(`advancedFilter exceeds maxNodes ${binding.filter.maxNodes}`);
  if (depth > binding.filter.maxDepth) fail(`advancedFilter exceeds maxDepth ${binding.filter.maxDepth}`);
  const groupKeys = ["and", "or"].filter((key) => Object.hasOwn(node, key));
  const isLeaf = Object.hasOwn(node, "field") || Object.hasOwn(node, "op") || Object.hasOwn(node, "value");
  if (groupKeys.length === 1 && !isLeaf) {
    exactKeys(node, [groupKeys[0]], "advancedFilter group");
    const children = array(node[groupKeys[0]], `advancedFilter.${groupKeys[0]}`);
    if (!children.length) fail(`advancedFilter.${groupKeys[0]} must not be empty`);
    for (const child of children) validateAdvancedFilter(binding, child, state, depth + 1);
    return;
  }
  if (groupKeys.length || !isLeaf) fail("advancedFilter node must be exactly one AND group, OR group, or predicate");
  validateCanonicalPredicate(binding, node, "advancedFilter predicate", "op");
}

function validateSearch(binding, value) {
  if (binding.search === null) fail("search was not projected for this model");
  const text = string(value, "search");
  if (Number.isInteger(binding.search.minLength) && text.length < binding.search.minLength) fail("search is too short");
  if (Number.isInteger(binding.search.maxLength) && text.length > binding.search.maxLength) fail("search is too long");
  return text;
}

function validateSimpleFilters(binding, value) {
  const filters = array(value, "filters");
  if (filters.length > binding.filter.maxNodes) fail(`filters exceed maxNodes ${binding.filter.maxNodes}`);
  return filters.map((entry, index) => validateCanonicalPredicate(binding, entry, `filters[${index}]`, "operator"));
}

function validateSort(binding, value) {
  const sort = array(value, "sort");
  if (!sort.length || sort.length > binding.sort.maxCriteria) fail(`sort must contain 1-${binding.sort.maxCriteria} criteria`);
  const used = new Set();
  for (const criterion of sort) {
    object(criterion, "sort criterion");
    exactKeys(criterion, ["field", "direction"], "sort criterion");
    if (!binding.sort.fields.includes(criterion.field)) fail(`sort field ${JSON.stringify(criterion.field)} was not projected`);
    if (!binding.sort.directions.includes(criterion.direction)) fail(`sort direction ${JSON.stringify(criterion.direction)} was not projected`);
    if (used.has(criterion.field)) fail(`sort field ${JSON.stringify(criterion.field)} may be supplied only once`);
    used.add(criterion.field);
  }
}

function validateLimit(binding, value) {
  if (!Number.isInteger(value) || value < binding.page.minimum || value > binding.page.maximum) {
    fail(`limit must be an integer from ${binding.page.minimum} to ${binding.page.maximum}`);
  }
}

export function buildLifeSpaceQueryRequest(binding, args) {
  object(binding, "query binding");
  if (binding.kind !== "canonical-model-query" || binding.method !== "POST" || binding.pathTemplate !== CANONICAL_PATH) {
    fail("binding is not a supported Canonical Query binding");
  }
  object(args, "tool arguments");
  exactKeys(args, ["spaceId", "search", "filters", "advancedFilter", "sort", "limit", "cursor"], "tool arguments");
  const spaceId = string(args.spaceId, "spaceId");
  if (!binding.allowedSpaceIds.includes(spaceId)) fail(`Space ${JSON.stringify(spaceId)} is not in the projected readable Space set`);
  if (args.filters !== undefined && args.advancedFilter !== undefined) {
    fail("filters and advancedFilter cannot be combined; use advancedFilter for the complete Boolean expression");
  }

  const body = {};
  if (args.search !== undefined) body.search = { text: validateSearch(binding, args.search) };
  if (args.filters !== undefined) {
    const predicates = validateSimpleFilters(binding, args.filters);
    if (predicates.length === 1) body.filter = predicates[0];
    if (predicates.length > 1) body.filter = { and: predicates };
  }
  if (args.advancedFilter !== undefined) {
    validateAdvancedFilter(binding, args.advancedFilter, { nodes: 0 });
    body.filter = structuredClone(args.advancedFilter);
  }
  if (args.sort !== undefined) {
    validateSort(binding, args.sort);
    body.sort = structuredClone(args.sort);
  }

  const page = {};
  if (args.limit !== undefined) {
    validateLimit(binding, args.limit);
    page.limit = args.limit;
  }
  if (args.cursor !== undefined) page.cursor = string(args.cursor, "cursor");
  if (Object.keys(page).length) body.page = page;

  return {
    method: "POST",
    path: binding.pathTemplate
      .replace("{spaceId}", encodeURIComponent(spaceId))
      .replace("{modelKey}", encodeURIComponent(binding.modelKey)),
    body,
  };
}