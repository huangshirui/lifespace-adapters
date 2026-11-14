import test from "node:test";
import assert from "node:assert/strict";
import {verifyProductionResourceCredential} from "../scripts/verify-production-resource-credential.mjs";
const env={CLOUDFLARE_ACCOUNT_ID:"a".repeat(32),CLOUDFLARE_API_TOKEN:"synthetic-api-token".repeat(3),
  MCP_PRODUCTION_WORKER_NAME:"example-adapter",MCP_PRODUCTION_CORE_SERVICE:"example-core",
  MCP_PRODUCTION_IDENTITY_SERVICE:"example-identity",MCP_PRODUCTION_RESOURCE_ORIGIN:"https://core.example.com",
  MCP_PRODUCTION_OAUTH_ISSUER:"https://issuer.example.com",MCP_PRODUCTION_OAUTH_RESOURCE_SERVER_SECRET:"synthetic-secret".repeat(4)};
function fixture({missing=false,status=200,active=false,mismatch=false,unknown=false}={}){
  const calls=[];
  const request=async(url,init)=>{
    calls.push({url,method:init.method});
    assert.equal(init.redirect,"manual");
    if(url.startsWith("https://api.cloudflare.com/")){
      if(missing||unknown)return Response.json({success:false,errors:[{code:missing?10007:12345}]},{status:404});
      return Response.json({success:true,result:{bindings:[
        {name:"CORE",type:"service",service:"example-core"},
        {name:"IDENTITY",type:"service",service:mismatch?"example-other":"example-identity"},
      ]}});
    }
    assert.equal(url,"https://issuer.example.com/oauth/introspect");
    assert.equal(init.headers["x-lifespace-resource-secret"],env.MCP_PRODUCTION_OAUTH_RESOURCE_SERVER_SECRET);
    assert.match(init.body.get("token"),/^lsp_oat_/u);
    assert.match(init.body.get("resource"),/^https:\/\/core\.example\.com\/mcp\/mcp_[a-f0-9]{32}$/u);
    return Response.json({active},{status});
  };
  return {calls,request};
}
test("existing Adapter requires current Identity credential acceptance without mutating or leaking anything",async()=>{
  const f=fixture();const r=await verifyProductionResourceCredential({env,request:f.request});
  assert.deepEqual(r,{ok:true,firstUse:false,pairVerified:true});
  assert.equal(f.calls.length,2);
  assert.equal(JSON.stringify(r).includes(env.MCP_PRODUCTION_OAUTH_RESOURCE_SERVER_SECRET),false);
});
test("first use is allowed only for the specific missing-worker API response",async()=>{
  const f=fixture({missing:true});assert.deepEqual(await verifyProductionResourceCredential({env,request:f.request}),
    {ok:true,firstUse:true,pairVerified:false});
  assert.equal(f.calls.length,1);
});
test("unpaired, unknown, cross-environment or unexpected positive responses block deploy",async()=>{
  for(const options of [{status:401},{status:503},{status:302},{active:true},{mismatch:true},{unknown:true}]){
    const f=fixture(options);
    await assert.rejects(verifyProductionResourceCredential({env,request:f.request}));
  }
});
