import {test} from "node:test";
import assert from "node:assert/strict";
import {fileReadResult} from "../src/file-read-content.mjs";
const space="spc_synthetic",id="fil_"+"a".repeat(32);
const bytes=new TextEncoder().encode("%PDF-1.7\nsynthetic only");
const transfer="https://"+"a".repeat(32)+".r2.cloudflarestorage.com/synthetic-bucket/files/"+space+"/"+id+"?X-Amz-Expires=300&X-Amz-Signature="+"b".repeat(64);
function outcome(body=bytes,type="application/pdf",extra={}){
  return {payload:{data:{id,contentType:type,size:body.length,url:transfer,expiresAt:new Date(Date.now()+120000).toISOString(),...extra}}};
}
test("PDF bytes are embedded as a resource; no bearer URL or base64 in text or structuredContent",async()=>{
  let called=0;
  const result=await fileReadResult(outcome(),space,id,async(url,init)=>{
    called++;
    assert.equal(url,transfer);assert.equal(init.method,"GET");
    assert.equal(init.redirect,"manual");assert.equal(init.headers,undefined);
    return new Response(bytes,{headers:{"content-type":"application/pdf","content-length":String(bytes.length)}});
  });
  assert.equal(called,1);
  assert.equal(result.isError,undefined);
  assert.equal(result.content[1].type,"resource");
  assert.equal(result.content[1].resource.mimeType,"application/pdf");
  assert.deepEqual(Buffer.from(result.content[1].resource.blob,"base64"),Buffer.from(bytes));
  assert.deepEqual(result.structuredContent,{id,contentType:"application/pdf",size:bytes.length});
  assert.ok(!JSON.stringify(result).includes("X-Amz"));
});
test("raster image bytes are delivered in standard image content",async()=>{
  const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,1,2]);
  const result=await fileReadResult(outcome(png,"image/png"),space,id,async()=>new Response(png,{headers:{"content-type":"image/png"}}));
  assert.equal(result.content[1].type,"image");
  assert.deepEqual(Buffer.from(result.content[1].data,"base64"),Buffer.from(png));
});
test("rejects foreign/malformed URLs, wrong File, unsupported types, expired and oversized descriptors before fetch",async()=>{
  let calls=0;
  const fetch=async()=>{calls++;throw Error("must not fetch");};
  for(const extra of [
    {url:"https://example.com/private"},
    {url:transfer.replace("spc_synthetic","spc_other")},
    {url:transfer.replace(".r2.cloudflarestorage.com",".r2.cloudflarestorage.com.example.com")},
    {url:transfer.replace("https:","http:")},
    {id:"fil_"+"c".repeat(32)}, {size:11*1024*1024},
    {expiresAt:"2000-01-01T00:00:00Z"}, {contentType:"text/html"},
  ]){
    const result=await fileReadResult(outcome(bytes,"application/pdf",extra),space,id,fetch);
    assert.equal(result.isError,true);assert.ok(!JSON.stringify(result).includes("X-Amz"));
  }
  assert.equal(calls,0);
  assert.deepEqual(await fileReadResult({error:"CORE_PERMISSION_DENIED"},space,id,fetch),{isError:true,content:[{type:"text",text:"CORE_PERMISSION_DENIED"}]});
});
test("rejects redirects, bad magic, truncated and excess bytes, MIME mismatch and upstream errors",async()=>{
  for(const response of [
    ()=>new Response(null,{status:302,headers:{location:"https://example.com/"}}),
    ()=>new Response(bytes,{headers:{"content-type":"text/html"}}),
    ()=>new Response(bytes.subarray(0,4),{headers:{"content-type":"application/pdf"}}),
    ()=>new Response(new Uint8Array(bytes.length+1),{headers:{"content-type":"application/pdf"}}),
    ()=>new Response(new Uint8Array(bytes.length),{headers:{"content-type":"application/pdf"}}),
    ()=>new Response(null,{status:403}),
  ]){
    const result=await fileReadResult(outcome(),space,id,async()=>response());
    assert.equal(result.isError,true);assert.ok(!JSON.stringify(result).includes("X-Amz"));
  }
  const result=await fileReadResult(outcome(),space,id,async()=>{throw Error(transfer)});
  assert.equal(result.isError,true);assert.ok(!JSON.stringify(result).includes("X-Amz"));
});
