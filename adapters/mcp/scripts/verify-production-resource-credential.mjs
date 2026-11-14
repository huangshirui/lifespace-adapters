// Deployment safety only. No user credentials or data; private environment
// values are never printed. Verify an existing Adapter's candidate secret
// against live Identity before allowing a redeploy to replace that secret.
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { privateProductionConfig } from "./generate-private-production-config.mjs";

export async function verifyProductionResourceCredential({env=process.env,request=fetch}={}) {
  const config=privateProductionConfig(env);
  const account=env.CLOUDFLARE_ACCOUNT_ID, token=env.CLOUDFLARE_API_TOKEN;
  const secret=env.MCP_PRODUCTION_OAUTH_RESOURCE_SERVER_SECRET;
  if(!/^[a-f0-9]{32}$/u.test(account||"")||typeof token!=="string"||token.length<20
    ||typeof secret!=="string"||secret.length<32)throw new Error("Protected deployment inputs missing");
  const call=async(url,options)=>{
    try{return await request(url,{...options,redirect:"manual",signal:AbortSignal.timeout(10000)});}
    catch{throw new Error("Production credential preflight request failed");}
  };
  const inventory=await call("https://api.cloudflare.com/client/v4/accounts/"+account+
    "/workers/scripts/"+encodeURIComponent(config.name)+"/settings",{
    method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
  });
  const payload=await inventory.json().catch(()=>null);
  if(inventory.status===404&&payload?.success===false&&payload.errors?.some(e=>e.code===10007)){
    // First use is independently owner-gated; Identity may not yet have the
    // paired secret installed. Never infer first use from a generic failure.
    return {ok:true,firstUse:true,pairVerified:false};
  }
  if(!inventory.ok||payload?.success!==true||!Array.isArray(payload.result?.bindings))
    throw new Error("Unable to establish existing private Adapter inventory");
  const bindings=payload.result.bindings;
  if(!config.services.every(s=>bindings.some(b=>b.name===s.binding&&b.type==="service"&&b.service===s.service)))
    throw new Error("Existing Adapter service targets do not match reviewed configuration");
  const resource=config.vars.MCP_RESOURCE_ORIGIN+"/mcp/mcp_"+randomBytes(16).toString("hex");
  const synthetic="lsp_oat_"+randomBytes(32).toString("base64url");
  const response=await call(config.vars.MCP_OAUTH_ISSUER+"/oauth/introspect",{
    method:"POST",headers:{"content-type":"application/x-www-form-urlencoded","x-lifespace-resource-secret":secret},
    body:new URLSearchParams({token:synthetic,resource}),
  });
  const result=await response.json().catch(()=>null);
  if(response.status!==200||result?.active!==false)
    throw new Error("Candidate Resource Secret does not authenticate to live Identity; deployment stopped");
  return {ok:true,firstUse:false,pairVerified:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  console.log(JSON.stringify(await verifyProductionResourceCredential()));
}
