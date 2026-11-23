// MCP-only input projection and caller-owned argument diagnostics.
// Core remains the sole authority for model fields, policy and Delegations.
const MODEL = /^[a-z][a-z0-9_]{1,62}$/u;
const RECORD = /^(rec|per)_[A-Za-z0-9_-]+$/u;
const FILE = /^fil_[a-f0-9]{32}$/u;
const UPLOAD = /^upl_[a-f0-9]{32}$/u;
const DELEGATION = /^dlg_[A-Za-z0-9_-]+$/u;
const FIELD = /^[a-z][A-Za-z0-9]{0,62}$/u;
const ACTION = /^action:[a-z][a-z0-9_-]{0,62}$/u;
const OPERATIONS = ["query","get","create","update","delete","file_read","file_upload"];
const object = x => x !== null && typeof x === "object" && !Array.isArray(x);
const schemaString = pattern => ({type:"string",pattern});
const recordId = schemaString("^(rec|per)_[A-Za-z0-9_-]+$");
const fileReadData = {
  type:"object",additionalProperties:false,required:["fieldKey","fileId"],
  properties:{
    fieldKey:schemaString("^[a-z][A-Za-z0-9]{0,62}$"),
    fileId:schemaString("^fil_[a-f0-9]{32}$"),
  },
};
const uploadBegin = {
  type:"object",additionalProperties:false,
  required:["phase","fieldKey","name","contentType","size"],
  properties:{
    phase:{const:"begin"},fieldKey:schemaString("^[a-z][A-Za-z0-9]{0,62}$"),
    recordId:schemaString("^rec_[A-Za-z0-9_-]+$"),
    name:{type:"string",minLength:1,maxLength:512},
    contentType:{type:"string",minLength:1,maxLength:255},
    size:{type:"integer",minimum:1},
  },
};
const uploadComplete = {
  type:"object",additionalProperties:false,required:["phase","uploadId"],
  properties:{phase:{const:"complete"},uploadId:schemaString("^upl_[a-f0-9]{32}$")},
};
const branch = (operation,required=[],props={}) => ({
  title:operation,required:["operation",...required],
  properties:{operation:{const:operation},...props},
});
export function delegationExecutionInputSchema() {
  return {
    type:"object",additionalProperties:false,
    required:["delegationId","modelKey","operation"],
    properties:{
      delegationId:schemaString("^dlg_[A-Za-z0-9_-]+$"),
      modelKey:schemaString("^[a-z][a-z0-9_]{1,62}$"),
      operation:{oneOf:[{type:"string",enum:OPERATIONS},{type:"string",pattern:"^action:[a-z][a-z0-9_-]{0,62}$"}]},
      recordId,
      data:{type:"object",description:"Canonical record payload: required model fields/types/enums are owned by the published LifeSpace Model Contract; do not guess them."},
    },
    allOf:[{oneOf:[
      branch("file_read",["recordId","data"],{recordId,data:fileReadData}),
      branch("file_upload",["data"],{data:{oneOf:[uploadBegin,uploadComplete]}}),
      branch("get",["recordId"],{recordId}),
      branch("query",[],{data:{type:"object",description:"Canonical query; for Person an optional search/limit/cursor object."}}),
      branch("create",["data"],{data:{type:"object",description:"Use the published Model Contract for this model's fields, required values and enums."}}),
      branch("update",["recordId","data"],{recordId,data:{type:"object"}}),
      branch("delete",["recordId","data"],{recordId,data:{type:"object"}}),
      {title:"action",required:["operation","recordId","data"],properties:{
        operation:{type:"string",pattern:"^action:[a-z][a-z0-9_-]{0,62}$"},
        recordId,data:{type:"object"},
      }},
    ]}],
  };
}
const problem = (code,fieldPath,repair) => ({code,fieldPath,repair});
const missing = (path,repair) => problem("MISSING_DELEGATION_ARGUMENT",path,repair);
const invalid = (path,repair) => problem("INVALID_DELEGATION_ARGUMENT",path,repair);
const unexpected = (path) => problem("UNEXPECTED_DELEGATION_ARGUMENT",path,"Remove this field; use the selected operation's input schema.");
const requiredText = path => "Provide "+path+" as required by the selected operation schema.";
const keys = (value,allowed,prefix) => Object.keys(value).find(k=>!allowed.includes(k))
  ? unexpected(prefix+Object.keys(value).find(k=>!allowed.includes(k))) : null;
const validRecord = (args) => {
  if(args.recordId===undefined)return missing("recordId",requiredText("recordId"));
  if(!RECORD.test(args.recordId))return invalid("recordId","Use an accessible record identifier with the rec_ or per_ prefix.");
  return null;
};
const validData = args => args.data===undefined
  ?missing("data",requiredText("data"))
  :!object(args.data)?invalid("data","Use a JSON object for data."):null;
const absent = (args,key) => args[key]!==undefined?unexpected(key):null;

/** Diagnose caller-supplied structure only; never examine Core state or infer access. */
export function delegationExecutionArgumentProblem(args) {
  if(!object(args))return invalid("$","Provide a JSON object of execution arguments.");
  const unknown=keys(args,["delegationId","modelKey","operation","recordId","data"],"");
  if(unknown)return unknown;
  if(args.delegationId===undefined)return missing("delegationId",requiredText("delegationId"));
  if(!DELEGATION.test(args.delegationId))return invalid("delegationId","Use the exact dlg_* ID returned by Account approval for this operation.");
  if(args.modelKey===undefined)return missing("modelKey",requiredText("modelKey"));
  if(!MODEL.test(args.modelKey))return invalid("modelKey","Use an eligible LifeSpace model key.");
  if(args.operation===undefined)return missing("operation",requiredText("operation"));
  if(!OPERATIONS.includes(args.operation)&&!ACTION.test(args.operation))
    return invalid("operation","Choose a supported operation from the approved request.");
  const op=args.operation;
  if(op==="file_read"){
    const record=validRecord(args);if(record)return record;
    const data=validData(args);if(data)return data;
    const extra=keys(args.data,["fieldKey","fileId"],"data.");if(extra)return extra;
    if(args.data.fieldKey===undefined)return missing("data.fieldKey",requiredText("data.fieldKey"));
    if(!FIELD.test(args.data.fieldKey))return invalid("data.fieldKey","Use the linked File field key from the current model contract.");
    if(args.data.fileId===undefined)return missing("data.fileId",requiredText("data.fileId"));
    if(!FILE.test(args.data.fileId))return invalid("data.fileId","Use the exact fil_* ID already linked to the selected record and field.");
    return null;
  }
  if(op==="file_upload"){
    const top=absent(args,"recordId");if(top)return top;
    const data=validData(args);if(data)return data;
    const phase=args.data.phase;
    if(phase===undefined)return missing("data.phase","Use begin or complete.");
    if(phase!=="begin"&&phase!=="complete")return invalid("data.phase","Use begin or complete.");
    const allowed=phase==="begin"
      ?["phase","fieldKey","recordId","name","contentType","size"]:["phase","uploadId"];
    const extra=keys(args.data,allowed,"data.");if(extra)return extra;
    if(phase==="complete"){
      if(args.data.uploadId===undefined)return missing("data.uploadId",requiredText("data.uploadId"));
      if(!UPLOAD.test(args.data.uploadId))return invalid("data.uploadId","Use the upl_* ID returned by begin; do not re-upload when retrying completion.");
      return null;
    }
    for(const field of ["fieldKey","name","contentType","size"])
      if(args.data[field]===undefined)return missing("data."+field,requiredText("data."+field));
    if(!FIELD.test(args.data.fieldKey))return invalid("data.fieldKey","Use a writable File field from the current model contract.");
    if(typeof args.data.name!=="string"||!args.data.name.trim()||args.data.name.length>512)return invalid("data.name","Use a nonempty file name of at most 512 characters.");
    if(typeof args.data.contentType!=="string"||!args.data.contentType.trim()||args.data.contentType.length>255)return invalid("data.contentType","Provide the uploaded bytes' MIME type.");
    if(!Number.isSafeInteger(args.data.size)||args.data.size<1)return invalid("data.size","Use a positive integer size in bytes.");
    if(args.data.recordId!==undefined&&(!/^(rec|per)_[A-Za-z0-9_-]+$/u.test(args.data.recordId)))
      return invalid("data.recordId","Provide a valid record ID, or omit it for a pre-record Native upload.");
    return null;
  }
  if(op==="get")return validRecord(args)||absent(args,"data");
  if(op==="query"){
    const top=absent(args,"recordId");if(top)return top;
    if(args.modelKey!=="person")return validData(args);
    if(args.data===undefined)return null;
    if(!object(args.data))return invalid("data","Use an optional Person search object.");
    const extra=keys(args.data,["search","limit","cursor"],"data.");if(extra)return extra;
    return null;
  }
  if(op==="create")return absent(args,"recordId")||validData(args);
  const rec=validRecord(args);if(rec)return rec;
  const data=validData(args);if(data)return data;
  if(args.modelKey==="person"||ACTION.test(op)){
    if(args.data.version===undefined&&op!=="create")return missing("data.version",requiredText("data.version"));
    if(!Number.isSafeInteger(args.data.version)||args.data.version<1)
      return invalid("data.version","Provide a positive current record version.");
  }
  return null;
}
