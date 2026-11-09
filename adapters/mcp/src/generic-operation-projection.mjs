// Core's single protocol-neutral authorized operation projection.
// Never inspect model source/origin, Person Directory, Provider or storage type.
const OP_REF=/^op_[a-f0-9]{64}$/u;
const SPACE=/^spc_[A-Za-z0-9_-]+$/u;
const MODEL=/^[a-z][a-z0-9_]{1,62}$/u;
const ACTION=/^action:([a-z][a-z0-9_-]{0,62})$/u;
const SIMPLE=new Set(["query","get","create","update","delete"]);
const TOOL=/^[A-Za-z0-9_.-]{1,128}$/u;
const MAX=128;
export function projectCoreOperationCatalog(payload,spaceId) {
  if(!SPACE.test(spaceId)||!payload||typeof payload!=="object"||Array.isArray(payload)
    ||!Array.isArray(payload.operations)||payload.operations.length>MAX)throw Error("Invalid Core operation catalog");
  const projected={tools:[],bindings:{}},refs=new Set();
  for(const row of payload.operations){
    if(!row||typeof row!=="object"||Array.isArray(row)
      ||!OP_REF.test(row.operationRef||"")||!MODEL.test(row.modelKey||"")
      ||!(SIMPLE.has(row.operation)||ACTION.test(row.operation||""))
      ||typeof row.title!=="string"||!row.title||row.title.length>160
      ||typeof row.description!=="string"||row.description.length>700
      ||!row.inputSchema||typeof row.inputSchema!=="object"||Array.isArray(row.inputSchema)
      ||row.inputSchema.type!=="object"
      ||!row.inputSchema.properties||typeof row.inputSchema.properties!=="object"
      ||!Array.isArray(row.inputSchema.properties.spaceId?.enum)
      ||row.inputSchema.properties.spaceId.enum.length!==1
      ||row.inputSchema.properties.spaceId.enum[0]!==spaceId
      ||!Array.isArray(row.inputSchema.required)
      ||!row.inputSchema.required.includes("spaceId")
      ||refs.has(row.operationRef))throw Error("Invalid or duplicate Core operation");
    refs.add(row.operationRef);
    const action=ACTION.exec(row.operation||"");
    const name=action?"lifespace.action."+row.modelKey+"."+action[1]
      :"lifespace."+row.operation+"."+row.modelKey;
    if(!TOOL.test(name)||Object.hasOwn(projected.bindings,name))throw Error("Duplicate model operation");
    const read=["query","get"].includes(row.operation);
    // OAuth permissions are protocol metadata, never a substitute for Core's
    // fresh credential Scope, Data Grant and Model Policy checks.
    // Both forms support MCP clients using securitySchemes or legacy _meta.
    const securitySchemes=[{type:"oauth2",scopes:read
      ? ["resources:read"] : ["resources:read","resources:write"]}];
    projected.tools.push({name,title:row.title,description:row.description,
      annotations:{readOnlyHint:read,destructiveHint:["update","delete"].includes(row.operation)
        ||Boolean(action),idempotentHint:read,openWorldHint:false},
      securitySchemes,_meta:{securitySchemes:structuredClone(securitySchemes)},
      inputSchema:structuredClone(row.inputSchema)});
    projected.bindings[name]={kind:"core-operation",spaceId,operationRef:row.operationRef};
  }
  projected.tools.sort((a,b)=>a.name.localeCompare(b.name));
  return projected;
}
export function buildCoreOperation(binding,args){
  if(!binding||binding.kind!=="core-operation"
    ||!SPACE.test(binding.spaceId)||!OP_REF.test(binding.operationRef)
    ||!args||typeof args!=="object"||Array.isArray(args)
    ||args.spaceId!==binding.spaceId
    ||Object.keys(args).some(k=>!["spaceId","recordId","data"].includes(k))
    ||(args.recordId!==undefined&&(typeof args.recordId!=="string"||args.recordId.length>160))
    ||(args.data!==undefined&&(!args.data||typeof args.data!=="object"||Array.isArray(args.data))))
    throw Error("Invalid generic operation request");
  return {method:"POST",path:"/api/v1/spaces/"+encodeURIComponent(binding.spaceId)
    +"/_operations/"+encodeURIComponent(binding.operationRef)+"/invoke",
    body:{arguments:args}};
}
