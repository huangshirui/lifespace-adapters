import { AdapterContractError } from "./projection.js";

function fail(code, message) {
  throw new AdapterContractError(code, message);
}

function encodePath(pathTemplate, values) {
  return pathTemplate.replace(/\{([^}]+)\}/gu, (_, name) => {
    const value = values[name];
    if (typeof value !== "string" || !value) fail("MISSING_ARGUMENT", `Missing path argument ${name}`);
    return encodeURIComponent(value);
  });
}

export function buildLifeSpaceRequest(binding, args = {}) {
  if (!binding || typeof binding !== "object") fail("INVALID_BINDING", "binding must be an object");
  if (!args || typeof args !== "object" || Array.isArray(args)) fail("INVALID_ARGUMENTS", "tool arguments must be an object");

  const pathValues = { ...(binding.fixedPathParameters ?? {}) };
  const query = new URLSearchParams();
  let body;
  const known = new Set();

  for (const argumentBinding of binding.argumentBindings ?? []) {
    const { name, in: where } = argumentBinding;
    known.add(name);
    if (!Object.hasOwn(args, name)) continue;
    const value = args[name];
    if (where === "path") {
      if (typeof value !== "string" || !value) fail("INVALID_PATH_ARGUMENT", `${name} must be a non-empty string`);
      pathValues[name] = value;
    } else if (where === "query") {
      if (Array.isArray(value)) {
        for (const item of value) query.append(name, String(item));
      } else if (value !== null && value !== undefined) {
        query.append(name, String(value));
      }
    } else if (where === "body") {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        fail("INVALID_BODY_ARGUMENT", `${name} must be a JSON object`);
      }
      if (body !== undefined) fail("INVALID_BINDING", "Only one canonical JSON body binding is supported");
      body = value;
    } else {
      fail("INVALID_BINDING", `Unsupported binding location ${where}`);
    }
  }

  const unknown = Object.keys(args).filter((name) => !known.has(name));
  if (unknown.length) fail("UNKNOWN_ARGUMENT", `Unknown tool argument(s): ${unknown.join(", ")}`);

  const path = encodePath(binding.pathTemplate, pathValues);
  const queryString = query.toString();
  return {
    method: binding.method,
    path: queryString ? `${path}?${queryString}` : path,
    ...(body !== undefined ? { body } : {}),
  };
}
