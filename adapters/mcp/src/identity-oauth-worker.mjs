import { projectCoreOperationCatalog, buildCoreOperation } from "./generic-operation-projection.mjs";

// New Identity-owned OAuth MCP Resource Server. Not the retired Access
// Managed OAuth Preview. This layer never exchanges CF Access assertions,
// forwards public OAuth access tokens to Core, or grants User delegation.
const MCP_PATH_PATTERN = /^\/mcp\/mcp_[a-f0-9]{32}$/u;
const META_PATH = "/.well-known/oauth-protected-resource";
const MAX_BODY_BYTES = 65536;
const MAX_RESULT_BYTES = 131072;
const MAX_DISCOVERED_MODELS = 32;
const MAX_TOKEN_LENGTH = 1024;
const VERSION = "2025-11-25";
const MODERN_VERSION = "2026-07-28";
const SUPPORTED_VERSIONS = [MODERN_VERSION, VERSION];
const SERVER_INFO = Object.freeze({ name: "lifespace-identity-oauth-mcp", version: "0.4.0-candidate" });

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store", ...headers },
  });
}

function validHttpsOrigin(value) {
  if (typeof value !== "string" || value.length > 512) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.hash
      || u.search || u.pathname !== "/" || u.hostname.includes("*")) return null;
    return u.origin;
  } catch { return null; }
}

export function oauthResourceConfig(env, requestUrl) {
  const issuer = validHttpsOrigin(env?.MCP_OAUTH_ISSUER);
  if (!issuer) return null;
  // One private Adapter Worker can serve every Core-issued mcp_* Server through
  // Core's verified same-origin ingress. The Resource is the exact request path,
  // never a Client-supplied header/body parameter or untrusted hostname.
  const dynamicOrigin = env?.MCP_RESOURCE_ORIGIN === undefined
    ? null : validHttpsOrigin(env.MCP_RESOURCE_ORIGIN);
  if (env?.MCP_RESOURCE_ORIGIN !== undefined) {
    if (!dynamicOrigin || env.MCP_RESOURCE_URI !== undefined || !requestUrl) return null;
    let incoming;
    try { incoming = new URL(requestUrl); } catch { return null; }
    if (incoming.origin !== dynamicOrigin || incoming.username || incoming.password
      || incoming.hash || incoming.search) return null;
    const path = incoming.pathname.startsWith(META_PATH + "/mcp/")
      ? incoming.pathname.slice(META_PATH.length) : incoming.pathname;
    if (!MCP_PATH_PATTERN.test(path)) return null;
    return {
      issuer, resource: dynamicOrigin + path, origin: dynamicOrigin, path,
      metadata: dynamicOrigin + META_PATH + path,
    };
  }
  // Legacy single-resource candidate remains available only for isolated
  // synthetic tests; production-style multi-Server routing uses the above.
  const resource = typeof env?.MCP_RESOURCE_URI === "string" ? env.MCP_RESOURCE_URI : "";
  let resourceUrl;
  try { resourceUrl = new URL(resource); } catch { return null; }
  if (resource.length > 1024 || resourceUrl.protocol !== "https:"
    || resourceUrl.username || resourceUrl.password || resourceUrl.hash || resourceUrl.search
    || !MCP_PATH_PATTERN.test(resourceUrl.pathname) || resourceUrl.href !== resource
    || resourceUrl.hostname.includes("*")) return null;
  return { issuer, resource, origin: resourceUrl.origin, path: resourceUrl.pathname,
    metadata: resourceUrl.origin + META_PATH + resourceUrl.pathname };
}

// Core is the only MCP Server config authority. The public Core ingress
// replaces this advisory header before its private Service Binding call.
// No field here grants OAuth, Agent or User authority; execution still passes
// Identity + Core's current Scope, Grants and exact operation checks.
function resourceScopes(request) {
  const hint = request.headers.get("x-lifespace-mcp-scope-ceiling");
  return hint === "resources:read resources:write"
    ? ["resources:read", "resources:write"] : ["resources:read"];
}

function challenge(config, request, extra = "") {
  return "Bearer resource_metadata=\"" + config.metadata
    + "\", scope=\"" + resourceScopes(request).join(" ") + "\"" + extra;
}

function authFailure(config, request, error = "invalid_token") {
  return json({ error: "OAuth authorization required" }, 401, {
    "www-authenticate": challenge(config, request, ", error=\"" + error + "\""),
  });
}

function insufficientScope(config, request) {
  return json({ error: "insufficient_scope" }, 403, {
    "www-authenticate": challenge(config, request, ", error=\"insufficient_scope\""),
  });
}

function validatedOAuthClientId(value) {
  if (typeof value !== "string" || value.length > 256) return false;
  if (/^ocli_[A-Za-z0-9_-]+$/u.test(value)) return true;
  // This is the exact identifier from Identity's authenticated token
  // introspection, NOT a user-provided URL to fetch from the Adapter.
  let uri;
  try { uri = new URL(value); } catch { return false; }
  if (uri.protocol !== "https:" || uri.href !== value
    || uri.username || uri.password || uri.search || uri.hash || uri.port
    || uri.pathname === "/" || uri.hostname.includes("*")) return false;
  const labels = uri.hostname.toLowerCase().split(".");
  if (labels.length < 2 || labels.some(label => !label || label.length > 63
    || label.startsWith("-") || label.endsWith("-"))
    || !/^[a-z]{2,63}$/u.test(labels[labels.length - 1])) return false;
  return true;
}

export function validateIntrospection(data, config) {
  if (!data || data.active !== true) return { error: "invalid_token" };
  if (data.resource !== config.resource || !Number.isSafeInteger(data.exp)
    || data.exp <= Math.floor(Date.now() / 1000)) return { error: "invalid_token" };
  if (!validatedOAuthClientId(data.client_id)
    || !/^oaz_[a-zA-Z0-9_-]+$/u.test(data.authorization_id || "")
    || !/^usr_[a-zA-Z0-9_-]+$/u.test(data.sub || "")
    || !/^app_[a-zA-Z0-9_-]+$/u.test(data.application_id || "")
    || !/^spc_[a-zA-Z0-9_-]+$/u.test(data.space_id || "")
    || !/^agt_[a-zA-Z0-9_-]+$/u.test(data.agent_id || "")) return { error: "invalid_token" };
  if (typeof data.scope !== "string" || data.scope.length > 500) return { error: "invalid_token" };
  const scopes = data.scope.split(/\s+/u).filter(Boolean);
  if (new Set(scopes).size !== scopes.length || scopes.some(s => ![
    "resources:read", "resources:write", "resources:manage",
  ].includes(s))) return { error: "invalid_token" };
  if (!scopes.includes("resources:read")) return { error: "insufficient_scope" };
  if (typeof data.allow_user_authorization !== "boolean") return { error: "invalid_token" };
  return {
    // This is context, not Core authority. It must never be turned into a
    // trusted Principal, Actor or Delegation without an Identity/Core bridge.
    context: Object.freeze({
      clientId: data.client_id, authorizationId: data.authorization_id,
      userId: data.sub, applicationId: data.application_id,
      spaceId: data.space_id, agentId: data.agent_id, scopes: Object.freeze(scopes),
      mayRequestDelegation: data.allow_user_authorization,
    }),
  };
}

async function verifyOAuthToken(request, config, env) {
  const header = request.headers.get("authorization") || "";
  if (!/^Bearer lsp_oat_[A-Za-z0-9_-]+$/u.test(header)
    || header.length > MAX_TOKEN_LENGTH + 7) return { error: "invalid_token" };
  const secret = env?.OAUTH_RESOURCE_SERVER_SECRET;
  if (typeof secret !== "string" || secret.length < 32
    || !env?.IDENTITY || typeof env.IDENTITY.fetch !== "function") {
    return { error: "resource_unavailable" };
  }
  let response;
  try {
    response = await env.IDENTITY.fetch("https://identity.internal/oauth/introspect", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-lifespace-resource-secret": secret,
      },
      body: new URLSearchParams({
        token: header.slice(7), resource: config.resource,
      }),
    });
  } catch {
    return { error: "resource_unavailable" };
  }
  if (response.status !== 200) return { error: "resource_unavailable" };
  const payload = await response.json().catch(() => null);
  return validateIntrospection(payload, config);
}

async function coreExecution(authorized, request, config, env, delegationId = null) {
  if (!env?.CORE || typeof env.CORE.fetch !== "function"
    || !env?.IDENTITY || typeof env.IDENTITY.fetch !== "function") {
    return { error: "CORE_EXECUTION_NOT_CONFIGURED" };
  }
  // Only Identity owns OAuth → Core Agent execution translation. The public
  // OAuth token is sent solely to Identity, never to Core or browser JS.
  const secret = env.OAUTH_RESOURCE_SERVER_SECRET;
  const token = request.headers.get("authorization").slice(7);
  let response;
  try {
    response = await env.IDENTITY.fetch("https://identity.internal/oauth/execution-tokens", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-lifespace-resource-secret": secret,
      },
      body: JSON.stringify({ token, resource: config.resource,
        ...(delegationId ? { delegationId } : {}) }),
    });
  } catch { return { error: "IDENTITY_EXECUTION_UNAVAILABLE" }; }
  if (response.status !== 200) return { error: "IDENTITY_EXECUTION_DENIED" };
  const result = await response.json().catch(() => null);
  const data = result?.data;
  if (data?.tokenType !== "Bearer"
    || typeof data.accessToken !== "string"
    || data.accessToken.length > 5000
    || !/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(data.accessToken)
    || !["resources:read", "resources:read resources:write"].includes(data.scope)
    || data.scope.split(" ").some(scope => !authorized.context.scopes.includes(scope))
    || !Number.isSafeInteger(data.expiresIn) || data.expiresIn < 1 || data.expiresIn > 60
    || data.applicationId !== authorized.context.applicationId
    || data.agentId !== authorized.context.agentId
    || data.spaceId !== authorized.context.spaceId) {
    return { error: "IDENTITY_EXECUTION_INVALID_RESPONSE" };
  }
  return { token: data.accessToken };
}

async function coreJson(env, coreToken, path, method = "GET", body, delegationId = null) {
  const recordGet = method === "GET" && /^\/api\/v1\/spaces\/spc_[A-Za-z0-9_-]+\/models\/[a-z][a-z0-9_]{1,62}\/records\/rec_[A-Za-z0-9_-]+$/u.test(path);
  const mutationPath = /^\/api\/v1\/spaces\/spc_[A-Za-z0-9_-]+\/models\/[a-z][a-z0-9_]{1,62}\/records(?:\/rec_[A-Za-z0-9_-]+)?$/u.test(path)
    && (method === "POST" && path.endsWith("/records") || ["PATCH", "DELETE"].includes(method) && !path.endsWith("/records"));
  const oauthRequest = /^\/api\/v1\/spaces\/spc_[A-Za-z0-9_-]+\/oauth-delegation-requests(?:\/arq_[a-f0-9]{32})?$/u.test(path)
    && (method === "POST" && path.endsWith("/oauth-delegation-requests")
      || method === "GET" && /\/arq_[a-f0-9]{32}$/u.test(path));
  const genericCatalog = /^\/api\/v1\/spaces\/spc_[A-Za-z0-9_-]+\/_discovery\/operations$/u.test(path)
    && method==="GET";
  const genericCommand = /^\/api\/v1\/spaces\/spc_[A-Za-z0-9_-]+\/_operations\/op_[a-f0-9]{64}\/invoke$/u.test(path)
    && method==="POST";
  // Person routes are a documented Kernel transport exception. The Agent
  // never chooses a trusted channel; this bridge is reachable only with a
  // signed represented User token and explicit Core Delegation selector.
  const personUrl = new URL("https://core.internal"+path);
  const personCollection=/^\/api\/v1\/spaces\/spc_[A-Za-z0-9_-]+\/people$/u.test(personUrl.pathname);
  const personRecord=/^\/api\/v1\/spaces\/spc_[A-Za-z0-9_-]+\/people\/per_[A-Za-z0-9_-]+$/u.test(personUrl.pathname);
  const personQuerySafe=[...personUrl.searchParams.keys()].every(k=>["q","limit","cursor"].includes(k));
  const delegatedPerson = Boolean(delegationId) && personQuerySafe
    && ((method==="GET" && (personCollection || personRecord))
      || (method==="POST" && personCollection && !personUrl.search)
      || (["PATCH","DELETE"].includes(method) && personRecord && !personUrl.search))
    && (!personUrl.search || (method==="GET" && personCollection));
  const delegatedAction = Boolean(delegationId) && method==="POST"
    && /^\/api\/v1\/spaces\/spc_[A-Za-z0-9_-]+\/models\/[a-z][a-z0-9_]{1,62}\/records\/rec_[A-Za-z0-9_-]+\/actions\/[a-z][a-z0-9_-]{0,62}$/u.test(path);
  if (!genericCatalog && !genericCommand && !delegatedAction && !delegatedPerson && !oauthRequest && !recordGet && !mutationPath && !/^\/api\/v1\/(me\/_discovery\/inventory|spaces\/spc_[A-Za-z0-9_-]+\/(?:_discovery\/models\/(?:batch|[a-z][a-z0-9_-]*)|models\/[a-z][a-z0-9_-]*\/records\/query))$/u.test(path)) {
    return { error: "CORE_PATH_REJECTED" };
  }
  let response;
  try {
    response = await env.CORE.fetch("https://core.internal" + path, {
      method, headers: {
        authorization: "Bearer " + coreToken,
        ...(delegationId ? { "x-lifespace-delegation-id": delegationId } : {}),
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch { return { error: "CORE_UNAVAILABLE" }; }
  if (!response.ok) {
    // An invalid Canonical Query is a caller error, not a Core outage.
    // Never forward Core's raw error body: it may contain private details.
    if ((genericCommand || delegatedAction || delegatedPerson || path.endsWith("/records/query") || mutationPath)
      && (response.status === 400 || response.status === 422)) {
      return { error: (genericCommand || delegatedAction || delegatedPerson) ? "INVALID_OPERATION_ARGUMENTS"
        : mutationPath ? "INVALID_MUTATION_ARGUMENTS" : "INVALID_QUERY_ARGUMENTS" };
    }
    if ((genericCommand || delegatedAction || delegatedPerson || mutationPath) && response.status === 409) return { error: "RECORD_VERSION_CONFLICT" };
    return { error: response.status === 401 || response.status === 403
      ? "CORE_PERMISSION_DENIED" : "CORE_UNAVAILABLE" };
  }
  if (response.status === 204) return { payload: { data: { deleted: true } } };
  let raw;
  try { raw = await response.text(); } catch { return { error: "CORE_UNAVAILABLE" }; }
  if (new TextEncoder().encode(raw).length > MAX_RESULT_BYTES) {
    return { error: "CORE_RESULT_TOO_LARGE" };
  }
  let payload;
  try { payload = JSON.parse(raw); } catch { return { error: "CORE_INVALID_RESPONSE" }; }
  return { payload };
}

async function currentToolProjection(env,coreToken,selectedSpace){
  const path="/api/v1/spaces/"+encodeURIComponent(selectedSpace)+"/_discovery/operations";
  const response=await coreJson(env,coreToken,path);
  if(response.error)return response;
  try{return {projected:projectCoreOperationCatalog(response.payload?.data,selectedSpace)};}
  catch{return {error:"CORE_OPERATION_CATALOG_INVALID"};}
}

// This is a UI protocol transport, never a Delegation authority. The user
// approves only on the independent LifeSpace Account website.
const DELEGATION_MODEL = /^[a-z][a-z0-9_]{1,62}$/u;
const DELEGATION_ID = /^dlg_[A-Za-z0-9_-]+$/u;
const REQUEST_ID = /^arq_[a-f0-9]{32}$/u;
const DELEGATED_OPS = ["get", "query", "create", "update", "delete"];
const DELEGATED_ACTION = /^action:([a-z][a-z0-9_-]{0,62})$/u;
const delegatedOp = value => typeof value === "string"
  && (DELEGATED_OPS.includes(value) || DELEGATED_ACTION.test(value));
const delegatedOpSchema = {oneOf:[
  {type:"string",enum:DELEGATED_OPS},
  {type:"string",pattern:"^action:[a-z][a-z0-9_-]{0,62}$"},
]};
// MCP 2026-07-28 URL elicitation is a protocol UX, never a new authority
// source. MRTR returns immediately; only a later authenticated retry can
// read Core's user-approved Delegation. No browser callback or token is trusted.
const ELICITATION_KEY="lifespace_account_approval";
function urlElicitationCapable(params,modern) {
  const url=params?._meta?.["io.modelcontextprotocol/clientCapabilities"]?.elicitation?.url;
  return modern && !!url && typeof url==="object" && !Array.isArray(url);
}
function safeApprovalUrl(raw,requestId) {
  try {
    const url=new URL(raw);
    return url.protocol==="https:" && !url.username && !url.password
      && !url.hash && url.pathname==="/delegation"
      && url.searchParams.size===1 && url.searchParams.get("request_id")===requestId
      && !["localhost","127.0.0.1"].includes(url.hostname)
      ? url.href : null;
  } catch{return null;}
}
function stableJson(value) {
  if(Array.isArray(value))return "["+value.map(stableJson).join(",")+"]";
  if(value && typeof value==="object")return "{"+Object.keys(value).sort()
    .map(k=>JSON.stringify(k)+":"+stableJson(value[k])).join(",")+"}";
  return JSON.stringify(value);
}
function base64url(bytes) {
  let text="";for(const byte of bytes)text+=String.fromCharCode(byte);
  return btoa(text).replaceAll("+","-").replaceAll("/","_").replace(/=+$/u,"");
}
function unbase64url(text) {
  if(typeof text!=="string"||!/^[A-Za-z0-9_-]{1,2048}$/u.test(text))return null;
  try {return Uint8Array.from(atob(text.replaceAll("-","+").replaceAll("_","/")
    .padEnd(Math.ceil(text.length/4)*4,"=")),c=>c.charCodeAt(0));}
  catch{return null;}
}
async function mrtrKey(env) {
  const secret=env?.OAUTH_RESOURCE_SERVER_SECRET;
  if(typeof secret!=="string"||secret.length<32)throw Error("MRTR secret unavailable");
  return crypto.subtle.importKey("raw",new TextEncoder().encode(secret),
    {name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);
}
function stateBinding(auth,config,args,encoded) {
  const c=auth.context;
  return "lifespace-url-elicitation-v1\n"+encoded+"\n"
    +stableJson({authorizationId:c.authorizationId,clientId:c.clientId,
      userId:c.userId,applicationId:c.applicationId,spaceId:c.spaceId,
      agentId:c.agentId,resource:config.resource,arguments:args});
}
async function signApprovalState(env,auth,config,args,pending) {
  const approvalUrl=safeApprovalUrl(pending.approvalUrl,pending.id);
  if(!REQUEST_ID.test(pending.id||"") || pending.status!=="pending" || !approvalUrl)
    return null;
  const exp=Math.min(Date.now()+600000,Date.parse(pending.expiresAt)||Date.now()+600000);
  if(exp<=Date.now())return null;
  const payload={v:1,id:pending.id,url:approvalUrl,exp};
  const encoded=base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key=await mrtrKey(env);
  const mac=await crypto.subtle.sign("HMAC",key,
    new TextEncoder().encode(stateBinding(auth,config,args,encoded)));
  return encoded+"."+base64url(new Uint8Array(mac));
}
async function verifyApprovalState(env,auth,config,args,state) {
  if(typeof state!=="string"||state.length>2800)return null;
  const [encoded,signature,...extra]=state.split(".");
  if(extra.length||!encoded||!signature)return null;
  const mac=unbase64url(signature);
  const data=unbase64url(encoded);
  if(!mac||mac.length!==32||!data)return null;
  const key=await mrtrKey(env);
  if(!await crypto.subtle.verify("HMAC",key,mac,
    new TextEncoder().encode(stateBinding(auth,config,args,encoded))))return null;
  let payload;try{payload=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(data));}
  catch{return null;}
  if(!payload||payload.v!==1||!REQUEST_ID.test(payload.id||"")
    ||!Number.isSafeInteger(payload.exp)||Date.now()>=payload.exp
    ||!safeApprovalUrl(payload.url,payload.id))return null;
  return payload;
}
function approvalInputRequired(id,state,pending,modern) {
  return rpcResult(id,{
    resultType:"input_required",
    requestState:state,
    inputRequests:{
      [ELICITATION_KEY]:{
        method:"elicitation/create",
        params:{mode:"url",url:pending.url,
          message:"在 LifeSpace Account 网页确认 "+pending.modelKey+" · "+pending.operation+" 的用户委托。确认后客户端可重新提交原工具调用；网页同意不直接授予权限。"},
      },
    },
  },modern);
}
function delegationStatusMatches(payload,requestId,args,auth,config) {
  const c=auth.context;
  return payload?.id===requestId && payload.modelKey===args.modelKey
    && payload.operation===args.operation && payload.reason===args.reason
    && payload.applicationId===c.applicationId && payload.agentId===c.agentId
    && payload.spaceId===c.spaceId && payload.clientId===c.clientId
    && payload.resource===config.resource
    && ["pending","approved","denied","expired"].includes(payload.status);
}
function oauthToolSecurity() {
  // A Delegation Tool can request a read or write operation. Announce its
  // baseline read Scope; a write request triggers a scoped OAuth step-up.
  const securitySchemes=[{type:"oauth2",scopes:["resources:read"]}];
  return {securitySchemes,_meta:{securitySchemes:structuredClone(securitySchemes)}};
}
function userDelegationTools() {
  return [
    { name: "lifespace.request_user_delegation",
      ...oauthToolSecurity(),
      title: "Request LifeSpace User Delegation",
      description: "Ask the signed-in user to approve one specific Agent operation. Returns a LifeSpace Account confirmation URL; no authority is granted until approval.",
      inputSchema: {type:"object",additionalProperties:false,required:["modelKey","operation","reason"],
        properties:{
          modelKey:{type:"string",pattern:"^[a-z][a-z0-9_]{1,62}$"},
          operation:delegatedOpSchema,
          reason:{type:"string",minLength:4,maxLength:250},
        }},
    },
    { name: "lifespace.user_delegation_status",
      ...oauthToolSecurity(),
      title: "Check LifeSpace Delegation Approval",
      description: "Check the current status of an explicit User Delegation request, then retrieve the Core-issued delegationId when approved.",
      inputSchema:{type:"object",additionalProperties:false,required:["requestId"],
        properties:{requestId:{type:"string",pattern:"^arq_[a-f0-9]{32}$"}}},
    },
    { name: "lifespace.execute_user_delegation",
      ...oauthToolSecurity(),
      title: "Execute Account-Approved LifeSpace User Delegation",
      description: "Execute an exact Core model operation under a Delegation independently approved by the signed-in LifeSpace Account User. Account selects one-use, bounded time-limited repeat, or until-revoked lifetime; the Agent cannot choose or widen it. Native/Person and Provider-backed External operations stay restricted by current OAuth, User/Agent, Space, Model and policy authority; Core rejects revoked, expired, used, or cross-operation Delegations. External one-use write authority is consumed before the single Provider attempt, including on failure; repeated grants permit independently authorized attempts without exactly-once guarantees.",
      annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false},
      inputSchema:{type:"object",additionalProperties:false,required:["delegationId","modelKey","operation"],
        properties:{
          delegationId:{type:"string",pattern:"^dlg_[A-Za-z0-9_-]+$"},
          modelKey:{type:"string",pattern:"^[a-z][a-z0-9_]{1,62}$"},
          operation:delegatedOpSchema,
          recordId:{type:"string",pattern:"^(rec|per)_[A-Za-z0-9_-]+$"},
          data:{type:"object",description:"Canonical model payload validated by LifeSpace Core."},
        }},
    },
  ];
}
function delegatedCoreOperation(spaceId, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)
    || Object.keys(args).some(k => !["delegationId","modelKey","operation","recordId","data"].includes(k))
    || !DELEGATION_ID.test(args.delegationId||"") || !DELEGATION_MODEL.test(args.modelKey||"")
    || !delegatedOp(args.operation)) return null;
  const id=args.recordId;
  if (args.modelKey === "person") {
    const person="/api/v1/spaces/"+encodeURIComponent(spaceId)+"/people";
    const isPersonId=typeof id==="string" && /^per_[A-Za-z0-9_-]+$/u.test(id);
    const data=args.data;
    if (args.operation==="query") {
      if (id!==undefined || (data!==undefined && (!data||typeof data!=="object"||Array.isArray(data))))return null;
      const query=data||{};
      if (Object.keys(query).some(k=>!["search","limit","cursor"].includes(k)))return null;
      const params=new URLSearchParams();
      if (query.search!==undefined) {
        if (typeof query.search!=="string"||!query.search.trim()||query.search.length>100)return null;
        params.set("q",query.search);
      }
      if (query.limit!==undefined) {
        if (!Number.isSafeInteger(query.limit)||query.limit<1||query.limit>100)return null;
        params.set("limit",String(query.limit));
      }
      if (query.cursor!==undefined) {
        if (typeof query.cursor!=="string"||!query.cursor||query.cursor.length>2048)return null;
        params.set("cursor",query.cursor);
      }
      return {method:"GET",path:person+(params.size?"?"+params.toString():"")};
    }
    if (args.operation==="get")return isPersonId&&data===undefined
      ?{method:"GET",path:person+"/"+encodeURIComponent(id)}:null;
    if (args.operation==="create")return id===undefined&&data
      &&typeof data==="object"&&!Array.isArray(data)
      ?{method:"POST",path:person,body:data}:null;
    if (!["update","delete"].includes(args.operation)||!isPersonId||!data
      ||typeof data!=="object"||Array.isArray(data)
      ||!Number.isSafeInteger(data.version)||data.version<1)return null;
    return {method:args.operation==="update"?"PATCH":"DELETE",
      path:person+"/"+encodeURIComponent(id),body:data};
  }
  const base="/api/v1/spaces/" + encodeURIComponent(spaceId)
    + "/models/" + encodeURIComponent(args.modelKey) + "/records";
  const action=DELEGATED_ACTION.exec(args.operation);
  if (action) {
    if (!/^rec_[A-Za-z0-9_-]+$/u.test(id||"") || !args.data
      || typeof args.data!=="object" || Array.isArray(args.data)
      || !Number.isSafeInteger(args.data.version) || args.data.version<1) return null;
    return {method:"POST",path:base+"/"+encodeURIComponent(id)+"/actions/"
      +encodeURIComponent(action[1]),body:args.data};
  }
  if (args.operation === "get") {
    if (!/^rec_[A-Za-z0-9_-]+$/u.test(id||"") || args.data!==undefined) return null;
    return {method:"GET",path:base+"/"+encodeURIComponent(id)};
  }
  if (args.operation === "query") {
    if (id!==undefined || !args.data || typeof args.data!=="object" || Array.isArray(args.data)) return null;
    return {method:"POST",path:base+"/query",body:args.data};
  }
  if (args.operation === "create") {
    if (id!==undefined || !args.data || typeof args.data!=="object" || Array.isArray(args.data)) return null;
    return {method:"POST",path:base,body:args.data};
  }
  if (!/^rec_[A-Za-z0-9_-]+$/u.test(id||"") || !args.data
    || typeof args.data!=="object" || Array.isArray(args.data)) return null;
  // Native optimistic version is a Core Model Contract rule, NOT an Adapter
  // assumption about every public model (External Provider models never
  // require the Native version). Core validates actual operation input.
  return {method:args.operation==="update"?"PATCH":"DELETE",path:base+"/"+encodeURIComponent(id),body:args.data};
}

function validOrigin(request, config) {
  const header = request.headers.get("origin");
  return header === null || header === config.origin;
}

function rpcResult(id, result, modern = false) {
  return json({ jsonrpc: "2.0", id, result: modern
    ? {
      resultType: "complete", ...result,
      _meta: { ...result._meta, "io.modelcontextprotocol/serverInfo": SERVER_INFO },
    }
    : result });
}

function rpcError(id, code, message, status = 200, data) {
  return json({ jsonrpc: "2.0", id, error: {
    code, message, ...(data === undefined ? {} : { data }),
  } }, status);
}
// A missing write Scope on an otherwise authenticated Delegation is not a
// malformed Tool call. MCP-capable Clients may request an explicitly approved
// OAuth upgrade; neither this hint nor a refreshed Token grants Core authority.
function writeScopeStepUp(id, config, request, modern) {
  if (!resourceScopes(request).includes("resources:write"))
    return rpcError(id,-32602,"Write operation is not offered by this MCP Server");
  const required="resources:read resources:write";
  const value='Bearer resource_metadata="'+config.metadata
    +'", scope="'+required+'", error="insufficient_scope"'
    +', error_description="Reauthorize for the requested write operation"';
  // RFC 6750/MCP: HTTP 403 plus WWW-Authenticate is the universal step-up
  // signal. The MCP tool-result metadata also supports clients which inspect
  // mcp/www_authenticate within tools/call (without making it authoritative).
  const rpc=rpcResult(id,{isError:true,
    content:[{type:"text",text:"OAuth write Scope required; reauthorize to request it."}],
    _meta:{"mcp/www_authenticate":[value]}},modern);
  const headers=new Headers(rpc.headers);
  headers.set("www-authenticate",value);
  return new Response(rpc.body,{status:403,headers});
}

function decodeMcpName(raw) {
  if (typeof raw !== "string") return null;
  const prefix = "=?base64?", suffix = "?=";
  if (raw.startsWith(prefix) && raw.endsWith(suffix)) {
    const encoded = raw.slice(prefix.length, -suffix.length);
    if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) return null;
    try {
      return new TextDecoder("utf-8", { fatal: true })
        .decode(Uint8Array.from(atob(encoded), x => x.charCodeAt(0)));
    } catch { return null; }
  }
  if (raw.trim() !== raw || raw.startsWith(prefix)
    || [...raw].some(c => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) > 0x7e)) return null;
  return raw;
}

function modernRequestError(request, message) {
  const version = request.headers.get("mcp-protocol-version");
  const params = message.params;
  const meta = params && typeof params === "object" && !Array.isArray(params) ? params._meta : null;
  const bodyVersion = meta && typeof meta === "object" ? meta["io.modelcontextprotocol/protocolVersion"] : null;
  const modern = version === MODERN_VERSION || bodyVersion === MODERN_VERSION;
  if (version && !SUPPORTED_VERSIONS.includes(version)) {
    return { modern: false, error: rpcError(message.id, -32022, "Unsupported protocol version", 400, {
      supported: SUPPORTED_VERSIONS, requested: version,
    }) };
  }
  if (!modern) return { modern: false };
  // 2026-07-28 has no session; every RPC carries its capabilities and
  // matching HTTP routing headers. Missing/mismatched metadata fails closed.
  if (version !== MODERN_VERSION || bodyVersion !== MODERN_VERSION
    || request.headers.get("mcp-method") !== message.method
    || !meta || typeof meta !== "object" || Array.isArray(meta)
    || !meta["io.modelcontextprotocol/clientCapabilities"]
    || typeof meta["io.modelcontextprotocol/clientCapabilities"] !== "object"
    || Array.isArray(meta["io.modelcontextprotocol/clientCapabilities"])) {
    return { modern: true, error: rpcError(message.id, -32020, "Header mismatch or missing modern request metadata", 400) };
  }
  if (message.method === "tools/call") {
    if (decodeMcpName(request.headers.get("mcp-name")) !== params?.name) {
      return { modern: true, error: rpcError(message.id, -32020, "Mcp-Name header mismatch", 400) };
    }
  }
  return { modern: true };
}

export async function handleIdentityOAuthMcp(request, env) {
  const url = new URL(request.url);
  if (env?.MCP_RESOURCE_ORIGIN !== undefined) {
    // An unrelated URL is not a resource, even in the private Worker.
    const path = url.pathname.startsWith(META_PATH + "/mcp/")
      ? url.pathname.slice(META_PATH.length) : url.pathname;
    if (!MCP_PATH_PATTERN.test(path)) return json({ error: "Not found" }, 404);
  }
  const config = oauthResourceConfig(env, request.url);
  if (!config) return json({ error: "Resource server unavailable" }, 503);
  if (url.origin !== config.origin) return json({ error: "Invalid resource host" }, 403);

  if ((url.pathname === META_PATH || url.pathname === META_PATH + config.path) && request.method === "GET") {
    return json({
      resource: config.resource,
      authorization_servers: [config.issuer],
      scopes_supported: resourceScopes(request),
      bearer_methods_supported: ["header"],
    }, 200, { "cache-control": "public, max-age=300" });
  }
  if (url.pathname !== config.path || url.search) return json({ error: "Not found" }, 404);
  if (!validOrigin(request, config)) return json({ error: "Invalid origin" }, 403);
  if (request.method !== "POST") return json({ error: "MCP requires POST" }, 405, { allow: "POST" });

  const authorized = await verifyOAuthToken(request, config, env);
  if (authorized.error === "resource_unavailable") return json({ error: "Resource authentication unavailable" }, 503);
  if (authorized.error === "insufficient_scope") return insufficientScope(config, request);
  if (authorized.error) return authFailure(config, request);

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "Expected application/json" }, 415);
  }
  const accept = request.headers.get("accept") || "";
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
    return json({ error: "MCP Accept header is required" }, 406);
  }
  const declared = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(declared) || declared > MAX_BODY_BYTES) return json({ error: "Request too large" }, 413);
  const body = await request.text();
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) return json({ error: "Request too large" }, 413);
  let message;
  try { message = JSON.parse(body); } catch { return rpcError(null, -32700, "Parse error", 400); }
  if (!message || typeof message !== "object" || Array.isArray(message)
    || message.jsonrpc !== "2.0" || typeof message.method !== "string"
    || (message.id !== undefined && !(
      (typeof message.id === "string" && message.id.length <= 128)
      || (typeof message.id === "number" && Number.isFinite(message.id))
    ))) return rpcError(null, -32600, "Invalid request", 400);

  const checked = modernRequestError(request, message);
  if (checked.error) return checked.error;
  const modern = checked.modern;
  if (modern && message.id !== undefined && message.method === "server/discover") {
    return rpcResult(message.id, {
      supportedVersions: SUPPORTED_VERSIONS,
      capabilities: { tools: { listChanged: false } },
      ttlMs: 0, cacheScope: "private",
    }, true);
  }
  if (!modern && message.method === "notifications/initialized" && message.id === undefined) {
    return new Response(null, { status: 202 });
  }
  if (message.id === undefined) return rpcError(null, -32600, "Unexpected notification", 400);
  if (!modern && message.method === "initialize") {
    return rpcResult(message.id, {
      protocolVersion: VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
    });
  }
  if (!modern && message.method === "ping") return rpcResult(message.id, {});

  if (message.method !== "tools/list" && message.method !== "tools/call") {
    return rpcError(message.id, -32601, "Method not found", modern ? 404 : 200);
  }
  const execution = await coreExecution(authorized, request, config, env);
  if (execution.error) return json({ error: execution.error }, 503);

  const current = await currentToolProjection(env, execution.token, authorized.context.spaceId);
  if (current.error) return json({ error: current.error }, 503);
  if (message.method === "tools/list") {
    if (message.params && (typeof message.params !== "object" || Array.isArray(message.params)
      || Object.keys(message.params).some(key => key !== "cursor" && !(modern && key === "_meta")) || message.params.cursor)) {
      return rpcError(message.id, -32602, "Unsupported pagination parameters");
    }
    return rpcResult(message.id, { tools: [...current.projected.tools,
      ...(authorized.context.mayRequestDelegation ? userDelegationTools() : [])],
      ...(modern ? { ttlMs: 0, cacheScope: "private" } : {}) }, modern);
  }

  if (!message.params || typeof message.params !== "object" || Array.isArray(message.params)
    || typeof message.params.name !== "string"
    || !message.params.arguments || typeof message.params.arguments !== "object"
    || Array.isArray(message.params.arguments)) {
    return rpcError(message.id, -32602, "Invalid tool invocation");
  }
  if (message.params.name.startsWith("lifespace.") && [
      "lifespace.request_user_delegation", "lifespace.user_delegation_status",
      "lifespace.execute_user_delegation"].includes(message.params.name)) {
    if (!authorized.context.mayRequestDelegation)
      return rpcError(message.id, -32602, "User Delegation is disabled for this OAuth grant");
    const args=message.params.arguments;
    const space=authorized.context.spaceId;
    let path,method="GET",payload,delegation=null;
    if (message.params.name==="lifespace.request_user_delegation") {
      if (Object.keys(args).some(k=>!["modelKey","operation","reason"].includes(k))
        || !DELEGATION_MODEL.test(args.modelKey||"") || !delegatedOp(args.operation)
        || typeof args.reason!=="string" || args.reason.trim().length<4 || args.reason.trim().length>250)
        return rpcError(message.id,-32602,"Invalid User Delegation request");
      if (!["query","get"].includes(args.operation)
        && !authorized.context.scopes.includes("resources:write"))
        return writeScopeStepUp(message.id,config,request,modern);
      path="/api/v1/spaces/"+encodeURIComponent(space)+"/oauth-delegation-requests";
      method="POST";payload=args;
    } else if (message.params.name==="lifespace.user_delegation_status") {
      if (Object.keys(args).length!==1 || !REQUEST_ID.test(args.requestId||""))
        return rpcError(message.id,-32602,"Invalid Authorization Request ID");
      path="/api/v1/spaces/"+encodeURIComponent(space)+"/oauth-delegation-requests/"+encodeURIComponent(args.requestId);
    } else {
      const next=delegatedCoreOperation(space,args);
      if (!next) return rpcError(message.id,-32602,"Invalid Delegation execution arguments");
      if (!["query","get"].includes(args.operation)
        && !authorized.context.scopes.includes("resources:write"))
        return writeScopeStepUp(message.id,config,request,modern);
      path=next.path;method=next.method;payload=next.body;delegation=args.delegationId;
    }
    const coreToken=delegation
      ? await coreExecution(authorized,request,config,env,delegation)
      : execution;
    if (coreToken.error) return json({error:coreToken.error},503);
    const outcome=await coreJson(env,coreToken.token,path,method,payload,delegation);
    return rpcResult(message.id,{
      ...(outcome.error ? {isError:true} : {}),
      content:[{type:"text",text: outcome.error||JSON.stringify(outcome.payload?.data??outcome.payload)}],
    },modern);
  }
  const binding = current.projected.bindings[message.params.name];
  if (!binding) return rpcError(message.id, -32602, "Tool is not in the currently authorized projection");
  // Tool discovery can show an Agent operation requiring explicit additional
  // OAuth Scope, but the current token never gains it by being listed.
  if (binding.requiredScopes.some(scope=>!authorized.context.scopes.includes(scope)))
    return writeScopeStepUp(message.id,config,request,modern);
  let operation;
  try { operation=buildCoreOperation(binding,message.params.arguments); }
  catch { return rpcError(message.id,-32602,"Invalid arguments for current Core operation"); }
  if (!operation.path.startsWith("/api/v1/spaces/"
    + encodeURIComponent(authorized.context.spaceId) + "/")) {
    return rpcError(message.id, -32602, "Selected Space mismatch");
  }
  const result = await coreJson(env, execution.token, operation.path, operation.method, operation.body);
  if (result.error) return rpcResult(message.id, {
    isError: true, content: [{ type: "text", text: result.error }],
  }, modern);
  return rpcResult(message.id, {
    content: [{ type: "text", text: JSON.stringify(result.payload?.data ?? result.payload) }],
  }, modern);
}

export default { fetch: handleIdentityOAuthMcp };
