// Pure protocol projection of Core's current Person Directory Kernel capability.
// Authorization/ownership/linked-user restrictions stay entirely in Core.
const SPACE=/^spc_[A-Za-z0-9_-]+$/u,PERSON=/^per_[A-Za-z0-9_-]+$/u;
const OPS=new Set(["list","get","create","update","delete"]);
const INPUT={
  list:{q:{type:"string",minLength:1,maxLength:100},limit:{type:"integer",minimum:1,maximum:100},cursor:{type:"string",minLength:1}},
  get:{personId:{type:"string",pattern:"^per_[A-Za-z0-9_-]+$"}},
  create:{data:{type:"object",additionalProperties:false,properties:{
    displayName:{type:"string",minLength:1,maxLength:100},
    alternateNames:{type:"array",maxItems:20,items:{type:"string",minLength:1,maxLength:100}}
  },required:["displayName"]}},
  update:{personId:{type:"string",pattern:"^per_[A-Za-z0-9_-]+$"},data:{type:"object",properties:{
    version:{type:"integer",minimum:1},displayName:{type:"string",minLength:1,maxLength:100},
    alternateNames:{type:"object"}
  },required:["version"],additionalProperties:false}},
  delete:{personId:{type:"string",pattern:"^per_[A-Za-z0-9_-]+$"},data:{type:"object",properties:{
    version:{type:"integer",minimum:1}},required:["version"],additionalProperties:false}},
};
export function projectPersonDirectory(spaceId,detail) {
  const result={tools:[],bindings:{}};
  if(!SPACE.test(spaceId)||!detail||detail.resourceKey!=="person_directory"
    || !Array.isArray(detail.operations)||detail.operations.some(op=>!OPS.has(op)))throw Error("Invalid Core Person Directory projection");
  for(const op of detail.operations) {
    const name="lifespace.person."+op;
    const properties={spaceId:{type:"string",enum:[spaceId]},...INPUT[op]};
    const required=["spaceId",...(op==="get"?["personId"]:["update","delete"].includes(op)?["personId","data"]:op==="create"?["data"]:[])];
    result.tools.push({name,title:op+" Person",description:"Kernel Space Person Directory "+op+"; Core enforces independent Person Grant, linked-user boundaries, current User/Agent authority and version.",
      annotations:{readOnlyHint:["list","get"].includes(op),destructiveHint:op==="delete",idempotentHint:["list","get"].includes(op),openWorldHint:false},
      inputSchema:{type:"object",additionalProperties:false,properties,required}});
    result.bindings[name]={kind:"person-directory",operation:op,spaceId};
  }
  return result;
}
export function buildPersonDirectoryOperation(binding,args) {
  if(!binding||binding.kind!=="person-directory"||!OPS.has(binding.operation)
    ||!SPACE.test(binding.spaceId)||!args||typeof args!=="object"||Array.isArray(args)
    ||args.spaceId!==binding.spaceId)throw Error("Person Directory arguments");
  const op=binding.operation,base="/api/v1/spaces/"+encodeURIComponent(args.spaceId)+"/people";
  const allowed=op==="list"?["spaceId","q","limit","cursor"]:op==="get"?["spaceId","personId"]:op==="create"?["spaceId","data"]:["spaceId","personId","data"];
  if(Object.keys(args).some(k=>!allowed.includes(k)))throw Error("Unknown Person argument");
  if(["get","update","delete"].includes(op)&&!PERSON.test(args.personId||""))throw Error("Person ID");
  if(op==="list"){
    const params=new URLSearchParams();
    if(args.q!==undefined){if(typeof args.q!=="string"||!args.q.trim()||args.q.length>100)throw Error("Person search");params.set("q",args.q)}
    if(args.limit!==undefined){if(!Number.isInteger(args.limit)||args.limit<1||args.limit>100)throw Error("Person limit");params.set("limit",String(args.limit))}
    if(args.cursor!==undefined){if(typeof args.cursor!=="string"||!args.cursor||args.cursor.length>2048)throw Error("Person cursor");params.set("cursor",args.cursor)}
    return {method:"GET",path:base+(params.size?"?"+params:"")};
  }
  if(op==="get")return {method:"GET",path:base+"/"+encodeURIComponent(args.personId)};
  if(!args.data||typeof args.data!=="object"||Array.isArray(args.data))throw Error("Person data");
  const d=args.data;
  const fieldNames=op==="create"?["displayName","alternateNames"]:
    op==="update"?["version","displayName","alternateNames"]:["version"];
  if(Object.keys(d).some(k=>!fieldNames.includes(k)))throw Error("Person body");
  if(op==="create"&&(typeof d.displayName!=="string"||!d.displayName.trim()))throw Error("Person name");
  if(op!=="create"&&(!Number.isInteger(d.version)||d.version<1))throw Error("Person version");
  return {method:op==="create"?"POST":op==="update"?"PATCH":"DELETE",
    path:base+(op==="create"?"":"/"+encodeURIComponent(args.personId)),body:d};
}
