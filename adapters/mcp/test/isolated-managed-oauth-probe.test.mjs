import assert from "node:assert/strict";
import test from "node:test";
import { handle } from "../src/isolated-managed-oauth-probe.worker.mjs";

const env = {
  OAUTH_PROBE_ENABLED: "true",
  OAUTH_PROBE_KEY: "synthetic-32-byte-key-only-for-test-00000",
  OAUTH_ACCESS_AUD: "synthetic-access-audience",
};
function jwt(claims={}) {
  const encode = x => Buffer.from(JSON.stringify(x)).toString("base64url");
  // The tests use a fake assertion: validity is enforced at Cloudflare
  // Access in staging, not verified cryptographically in this probe.
  return [encode({alg:"RS256"}),encode({aud:env.OAUTH_ACCESS_AUD, sub:"usr_synthetic",...claims}),"synthetic-signature"].join(".");
}
function request(path="/mcp/calendar/conn_alpha/__oauth_probe", assertion=jwt(), headers={}) {
  return new Request("https://oauth-probe.example.com"+path,{
    method:"POST",headers:{...(assertion?{"cf-access-jwt-assertion":assertion}:{}),...headers},
  });
}
test("disabled and missing secret both fail-closed",async()=>{
  assert.equal((await handle(request(),{...env,OAUTH_PROBE_ENABLED:"false"})).status,404);
  assert.equal((await handle(request(),{...env,OAUTH_PROBE_KEY:""})).status,404);
});
test("rejects missing Access assertion or wrong audience",async()=>{
  assert.equal((await handle(request(undefined,null),env)).status,401);
  assert.equal((await handle(request(undefined,jwt({aud:"other-audience"})),env)).status,403);
});
test("allows only two synthetic Connection IDs; no real business routes",async()=>{
  for(const p of ["/mcp/calendar/conn_real/__oauth_probe","/mcp/tasks/conn_real/__oauth_probe","/mcp/health/conn_alpha/__oauth_probe","/mcp/calendar/conn_alpha/tools/list"]){
    assert.equal((await handle(request(p),env)).status,404);
  }
});
test("reports redacted client/grant claim presence but no raw values",async()=>{
  const a=jwt({client_id:"synthetic-client-a",azp:"synthetic-party-a"});
  const r=await handle(request(undefined,a),env);
  assert.equal(r.status,200);
  const b=await r.json();
  assert.equal(b.fields.client_id.present,true);
  assert.equal(b.fields.grant_id.present,false);
  assert.match(b.fields.client_id.fingerprint,/^[a-f0-9]{24}$/u);
  const serialized=JSON.stringify(b);
  for(const forbidden of [a,"synthetic-client-a","usr_synthetic","synthetic-party-a"]){
    assert(!serialized.includes(forbidden));
  }
});
test("same subject client yields same hash even when the Connection route changes (negative control)",async()=>{
  const a=jwt({client_id:"synthetic-client-a"});
  const first=await (await handle(request(undefined,a),env)).json();
  const second=await (await handle(request("/mcp/tasks/conn_beta/__oauth_probe",a),env)).json();
  assert.equal(first.fields.client_id.fingerprint,second.fields.client_id.fingerprint);
  assert.equal(second.resourcePath,"/mcp/tasks/conn_beta/__oauth_probe");
  const different=await (await handle(request(undefined,jwt({client_id:"synthetic-client-b"})),env)).json();
  assert.notEqual(first.fields.client_id.fingerprint,different.fields.client_id.fingerprint);
});
test("unauthenticated user-selected header must not invent client_id",async()=>{
  const r=await handle(request(undefined,jwt(),{"x-oauth-client-id":"pretend-ChatGPT"}),env);
  assert.equal(r.status,200);
  assert.equal((await r.json()).fields.client_id.present,false);
});
