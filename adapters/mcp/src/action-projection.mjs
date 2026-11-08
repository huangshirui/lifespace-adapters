// Adapter-only mapping from current Core Model Action semantics.
// Action authority and payload validation are exclusively Core responsibilities.
const KEY=/^[a-z][a-z0-9_]{1,62}$/u;
const ACTION=/^[a-z][a-z0-9_-]{0,62}$/u;
const SPACE=/^spc_[A-Za-z0-9_-]+$/u;
const RECORD=/^rec_[A-Za-z0-9_-]+$/u;
export function projectModelActions(selection) {
  const out={tools:[],bindings:{}};
  for(const {detail,spaces}of selection.models){
    if(detail.origin==="external"||!Array.isArray(detail.mcpOperations)||!Array.isArray(detail.actions))continue;
    if(!KEY.test(detail.key))throw Error("Core Action model key");
    for(const item of detail.actions){
      if(!item||typeof item!=="object"||!ACTION.test(item.key||"")
        ||!detail.mcpOperations.includes("action:"+item.key))continue;
      if(!["read","write"].includes(item.access)||!["workflow","capability"].includes(item.kind))throw Error("Core Action semantic contract");
      const allowed=spaces.filter(s=>Array.isArray(s.access)&&s.access.includes(item.access)
        &&SPACE.test(s.spaceId)).map(s=>s.spaceId);
      if(!allowed.length)continue;
      const name="lifespace.action."+detail.key+"."+item.key;
      const dataSchema=item.kind==="workflow"
        ?{type:"object",properties:{version:{type:"integer",minimum:1}},required:["version"],additionalProperties:false}
        :{type:"object",description:"Core canonical action payload; fields, capability policy and record version are validated by LifeSpace."};
      out.tools.push({name,title:"Action "+item.key+" on "+detail.display.singular,
        description:"Execute current published LifeSpace Model Action. Core validates exactly this Server's allowed action, active access, workflow/capability policy, version and Change attribution.",
        annotations:{readOnlyHint:item.access==="read",destructiveHint:item.access!=="read",idempotentHint:false,openWorldHint:false},
        inputSchema:{type:"object",additionalProperties:false,
          properties:{spaceId:{type:"string",enum:allowed},recordId:{type:"string",pattern:"^rec_[A-Za-z0-9_-]+$"},data:dataSchema},
          required:["spaceId","recordId","data"]}});
      out.bindings[name]={kind:"model-action",modelKey:detail.key,actionKey:item.key,allowedSpaceIds:allowed};
    }
  }
  return out;
}
export function buildModelAction(binding,args){
  if(!binding||binding.kind!=="model-action"||!KEY.test(binding.modelKey)
    ||!ACTION.test(binding.actionKey)||!Array.isArray(binding.allowedSpaceIds)
    ||!args||typeof args!=="object"||Array.isArray(args)
    ||Object.keys(args).some(k=>!["spaceId","recordId","data"].includes(k))
    ||!SPACE.test(args.spaceId||"")||!binding.allowedSpaceIds.includes(args.spaceId)
    ||!RECORD.test(args.recordId||"")||!args.data||typeof args.data!=="object"
    ||Array.isArray(args.data)||JSON.stringify(args.data).length>16384)throw Error("Invalid Action arguments");
  return {method:"POST",
    path:"/api/v1/spaces/"+encodeURIComponent(args.spaceId)+"/models/"+
      encodeURIComponent(binding.modelKey)+"/records/"+encodeURIComponent(args.recordId)+
      "/actions/"+encodeURIComponent(binding.actionKey),body:args.data};
}
