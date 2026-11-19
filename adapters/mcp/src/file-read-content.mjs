// Transport-only: consume the private Core FileDownloadResponse, never
// return the signed URL to the MCP client. Core is the sole authority.
const MAX_BYTES=10*1024*1024;
const FILE=/^fil_[a-f0-9]{32}$/u;
const SPACE=/^spc_[A-Za-z0-9_-]+$/u;
const TYPES=new Map([["application/pdf","pdf"],["image/png","png"],["image/jpeg","jpg"],["image/webp","webp"]]);
const fail=code=>({isError:true,content:[{type:"text",text:code}]});
function mime(value){return typeof value==="string"?value.split(";")[0].trim().toLowerCase():"";}
function matchesMagic(bytes,type){
  const at=(offset,values)=>values.every((n,i)=>bytes[offset+i]===n);
  if(type==="application/pdf")return at(0,[37,80,68,70,45]);
  if(type==="image/png")return at(0,[137,80,78,71,13,10,26,10]);
  if(type==="image/jpeg")return at(0,[255,216,255]);
  if(type==="image/webp")return at(0,[82,73,70,70])&&at(8,[87,69,66,80]);
  return false;
}
function transferUrl(value,spaceId,fileId){
  if(typeof value!=="string"||value.length>4096)return null;
  try{
    const u=new URL(value);
    if(u.protocol!=="https:"||u.username||u.password||u.port||u.hash
      ||!/^([a-f0-9]{32})\.r2\.cloudflarestorage\.com$/u.test(u.hostname)
      ||!/^\/[a-z0-9][a-z0-9-]{1,62}\/files\/spc_[A-Za-z0-9_-]+\/fil_[a-f0-9]{32}$/u.test(u.pathname)
      ||!u.pathname.endsWith("/files/"+spaceId+"/"+fileId)
      ||u.searchParams.getAll("X-Amz-Signature").length!==1
      ||! /^[a-f0-9]{64}$/u.test(u.searchParams.get("X-Amz-Signature")||"")
      ||u.searchParams.getAll("X-Amz-Expires").length!==1
      ||! /^[1-9][0-9]{0,2}$/u.test(u.searchParams.get("X-Amz-Expires")||"")
      ||Number(u.searchParams.get("X-Amz-Expires"))>300)return null;
    return u;
  }catch{return null;}
}
function base64(bytes){
  let result="";
  for(let i=0;i<bytes.length;i+=32766){
    result+=btoa(String.fromCharCode(...bytes.subarray(i,i+32766)));
  }
  return result;
}
export async function fileReadResult(outcome,spaceId,fileId,fetchFile=fetch){
  if(outcome.error)return fail(outcome.error);
  const item=outcome.payload?.data;
  if(!SPACE.test(spaceId)||!FILE.test(fileId)||!item||item.id!==fileId
    ||!Number.isSafeInteger(item.size)||item.size<1)return fail("FILE_TRANSFER_INVALID");
  if(item.size>MAX_BYTES)return fail("FILE_TOO_LARGE");
  const type=mime(item.contentType),ext=TYPES.get(type);
  if(!ext)return fail("FILE_TYPE_UNSUPPORTED");
  const url=transferUrl(item.url,spaceId,fileId);
  const expiry=typeof item.expiresAt==="string"?Date.parse(item.expiresAt):NaN;
  if(!url||!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+310000)
    return fail("FILE_TRANSFER_INVALID");
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);
  let reader,received=0;
  try{
    // No OAuth, Core or user credentials are sent to the object host.
    // Reject redirects and never log a request or underlying exception.
    const response=await fetchFile(url.href,{method:"GET",redirect:"manual",signal:controller.signal});
    if(response.status!==200||!response.body||mime(response.headers.get("content-type"))!==type){
      await response.body?.cancel().catch(()=>{});
      return fail("FILE_TRANSFER_UNAVAILABLE");
    }
    const length=response.headers.get("content-length");
    if(length!==null&&(!/^[0-9]+$/u.test(length)||Number(length)!==item.size)){
      await response.body.cancel().catch(()=>{});
      return fail("FILE_TRANSFER_INVALID");
    }
    const bytes=new Uint8Array(item.size);
    reader=response.body.getReader();
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      if(!(value instanceof Uint8Array)||received+value.length>item.size)return fail("FILE_TRANSFER_INVALID");
      bytes.set(value,received);received+=value.length;
    }
    if(received!==item.size||!matchesMagic(bytes,type))return fail("FILE_TRANSFER_INVALID");
    const data=base64(bytes);
    const info={id:fileId,contentType:type,size:received};
    const content=type.startsWith("image/")
      ?{type:"image",mimeType:type,data}
      :{type:"resource",resource:{uri:"lifespace://spaces/"+spaceId+"/files/"+fileId+"."+ext,mimeType:type,blob:data}};
    return {content:[{type:"text",text:JSON.stringify(info)},content],structuredContent:info};
  }catch{return fail("FILE_TRANSFER_UNAVAILABLE");}
  finally{
    clearTimeout(timer);
    if(reader)await reader.cancel().catch(()=>{});
    controller.abort();
  }
}
