import test from "node:test";
import assert from "node:assert/strict";
import {
  delegationExecutionInputSchema,
  delegationExecutionArgumentProblem,
} from "../src/delegation-arguments.mjs";

const base={delegationId:"dlg_synthetic",modelKey:"health_document"};
const id="fil_"+"a".repeat(32);
const uploadId="upl_"+"b".repeat(32);
const error=(args)=>delegationExecutionArgumentProblem(args);

test("delegated tool publishes per-operation structural branches, including exact File read and phased upload",()=>{
  const schema=delegationExecutionInputSchema();
  assert.deepEqual(schema.required,["delegationId","modelKey","operation"]);
  const branches=schema.allOf[0].oneOf;
  assert.deepEqual(branches.map(x=>x.title),[
    "relation_create","relation_get","relation_query","relation_delete",
    "file_read","file_upload","get","query","create","update","delete","action",
  ]);
  const read=branches.find(b=>b.title==="file_read");
  assert.deepEqual(read.required,["operation","recordId","data"]);
  assert.deepEqual(read.properties.data.required,["fieldKey","fileId"]);
  assert.equal(read.properties.data.additionalProperties,false);
  const upload=branches.find(b=>b.title==="file_upload").properties.data.oneOf;
  assert.deepEqual(upload[0].required,["phase","fieldKey","name","contentType","size"]);
  assert.deepEqual(upload[1].required,["phase","uploadId"]);
  assert.equal(branches.find(b=>b.title==="create").properties.data.description.includes("Model Contract"),true);
  for(const op of ["relation_create","relation_get","relation_query","relation_delete"]){
    assert.deepEqual(branches.find(b=>b.title===op).required,["operation","targetDelegationId","data"]);
    assert.equal(error({...base,operation:op,data:{}}).fieldPath,"targetDelegationId");
  }
  assert.equal(schema.properties.mode,undefined,"Account alone selects lifetime");
});

test("missing delegated file_read arguments identify caller-owned field paths without a Core lookup",()=>{
  const sample={...base,operation:"file_read",recordId:"rec_synthetic",
    data:{fieldKey:"attachment",fileId:id}};
  assert.equal(error(sample),null);
  assert.deepEqual(error({...sample,recordId:undefined}),{
    code:"MISSING_DELEGATION_ARGUMENT",fieldPath:"recordId",
    repair:"Provide recordId as required by the selected operation schema.",
  });
  assert.equal(error({...sample,data:{fieldKey:"attachment"}}).fieldPath,"data.fileId");
  assert.equal(error({...sample,data:{fileId:id}}).fieldPath,"data.fieldKey");
  assert.equal(error({...sample,data:{fieldKey:"attachment",fileId:"wrong"}}).code,
    "INVALID_DELEGATION_ARGUMENT");
  assert.equal(error({...sample,data:{...sample.data,privateField:"not used"}}).fieldPath,
    "data.privateField");
});

test("phased upload has explicit field diagnostics and reuses File identity after record retry",()=>{
  const begin={...base,operation:"file_upload",data:{
    phase:"begin",fieldKey:"attachment",name:"synthetic.pdf",contentType:"application/pdf",size:42,
  }};
  assert.equal(error(begin),null);
  assert.equal(error({...begin,data:{phase:"begin"}}).fieldPath,"data.fieldKey");
  assert.equal(error({...begin,data:{...begin.data,size:0}}).fieldPath,"data.size");
  assert.equal(error({...begin,data:{phase:"complete"}}).fieldPath,"data.uploadId");
  assert.equal(error({...begin,data:{phase:"complete",uploadId}}),null);
  assert.equal(error({...begin,data:{phase:"unknown"}}).fieldPath,"data.phase");
  assert.equal(error({...begin,recordId:"rec_synthetic"}).fieldPath,"recordId");
  assert.equal(error({...base,operation:"create",data:{attachments:[{id}]}}),null,
    "Model payload stays canonical and is not revalidated in Adapter");
});

test("caller paths are diagnosable without saying if a hidden delegation or record exists",()=>{
  assert.equal(error({...base,operation:"get"}).fieldPath,"recordId");
  assert.equal(error({...base,operation:"create"}).fieldPath,"data");
  assert.equal(error({...base,operation:"action:complete",recordId:"rec_synthetic",data:{}}).fieldPath,
    "data.version");
  assert.equal(error({...base,operation:"update",recordId:"rec_synthetic",data:{status:"x"}}),null,
    "External Provider mutation must not inherit Native version requirement");
  assert.equal(error({...base,modelKey:"person",operation:"update",
    recordId:"per_synthetic",data:{}}).fieldPath,"data.version");
  assert.equal(error({...base,operation:"not_real"}).fieldPath,"operation");
  assert.equal(error({...base,operation:"get",recordId:"rec_synthetic",secret:"don't echo"}).fieldPath,"secret");
});
