import {test} from "node:test";
import assert from "node:assert/strict";
import {projectCoreOperationCatalog,buildCoreOperation} from "../src/generic-operation-projection.mjs";
const spaceId="spc_synthetic";
function operation(modelKey,operation,ordinal){
  return {modelKey,operation,operationRef:"op_"+ordinal.toString(16).padStart(64,"a"),
    display:modelKey,title:operation+" "+modelKey,description:"Core current permitted operation",
    inputSchema:{type:"object",additionalProperties:false,
      properties:{spaceId:{type:"string",enum:[spaceId]},
        recordId:{type:"string",minLength:1},data:{type:"object"}},
      required:["spaceId",...(["query","create","update","delete"].includes(operation)?["data"]:[])]}};
}
test("one uniform tool contract for Kernel Person, dynamic External, Native and Actions",()=>{
  // The Core projection intentionally does not disclose storage origin.
  const manifest={operations:[
    operation("person","query",1),
    operation("person","create",2),
    operation("event","create",3),
    operation("task","get",4),
    operation("event","action:complete",5),
  ]};
  const result=projectCoreOperationCatalog(manifest,spaceId);
  assert.deepEqual(result.tools.map(x=>x.name).sort(),[
    "lifespace.action.event.complete","lifespace.create.event",
    "lifespace.create.person","lifespace.get.task","lifespace.query.person",
  ].sort());
  // Tool declarations must guide scope-aware MCP clients without granting
  // authority beyond the Core-owned current operation projection.
  for(const tool of result.tools){
    const read=tool.name==="lifespace.get.task"||tool.name==="lifespace.query.person";
    const expected=[{type:"oauth2",scopes:read?["resources:read"]:["resources:read","resources:write"]}];
    assert.deepEqual(tool.securitySchemes,expected,tool.name);
    assert.deepEqual(tool._meta.securitySchemes,expected,tool.name);
    assert.equal(tool.annotations.readOnlyHint,read,tool.name);
  }
  for(const [name,binding] of Object.entries(result.bindings)){
    assert.deepEqual(Object.keys(binding).sort(),["kind","operationRef","spaceId"].sort(),name);
    const input={spaceId,data:{title:"Synthetic only"}};
    const op=buildCoreOperation(binding,input);
    assert.equal(op.method,"POST");
    assert.match(op.path,/^\/api\/v1\/spaces\/spc_synthetic\/_operations\/op_[a-f0-9]{64}\/invoke$/u);
    assert.deepEqual(op.body,{arguments:input});
    assert.ok(!JSON.stringify(binding).includes("person_directory"));
    assert.ok(!JSON.stringify(binding).includes("external"));
    assert.ok(!JSON.stringify(binding).includes("provider"));
  }
});
test("core operation projection is fail-closed for duplicate, cross-Space and forged selectors",()=>{
  const a=operation("task","query",1);
  assert.throws(()=>projectCoreOperationCatalog({operations:[a,a]},spaceId));
  assert.throws(()=>projectCoreOperationCatalog({operations:[{...a,operationRef:"../../admin"}]},spaceId));
  assert.throws(()=>projectCoreOperationCatalog({operations:[{...a,inputSchema:{type:"object",properties:{spaceId:{type:"string",enum:["spc_other"]}},required:["spaceId"]}}]},spaceId));
  const b=projectCoreOperationCatalog({operations:[a]},spaceId).bindings["lifespace.query.task"];
  assert.throws(()=>buildCoreOperation(b,{spaceId:"spc_other",data:{}}));
  assert.throws(()=>buildCoreOperation(b,{spaceId,principalUserId:"usr_forbidden"}));
  assert.throws(()=>buildCoreOperation({...b,operationRef:"op_invalid"},{spaceId,data:{}}));
});
