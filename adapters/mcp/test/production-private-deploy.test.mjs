import test from "node:test";
import assert from "node:assert/strict";
import { privateProductionConfig } from "../scripts/generate-private-production-config.mjs";

const example=()=>({
  MCP_PRODUCTION_WORKER_NAME:"example-mcp-adapter",
  MCP_PRODUCTION_CORE_SERVICE:"example-core",
  MCP_PRODUCTION_IDENTITY_SERVICE:"example-identity",
  MCP_PRODUCTION_RESOURCE_ORIGIN:"https://core.example.test",
  MCP_PRODUCTION_OAUTH_ISSUER:"https://auth.example.test",
});

test("private Production deployment cannot accidentally create a public MCP endpoint",()=>{
  const config=privateProductionConfig(example());
  assert.equal(config.workers_dev,false);
  assert.equal(config.preview_urls,false);
  assert.equal(config.routes,undefined);
  assert.equal(config.route,undefined);
  assert.equal(config.vars.ENVIRONMENT,"production");
  assert.equal(config.vars.MCP_RESOURCE_ORIGIN,"https://core.example.test");
  assert.equal(config.services.length,2);
  assert.deepEqual(config.services.map(x=>x.binding),["CORE","IDENTITY"]);
  assert.equal(JSON.stringify(config).includes("OAUTH_RESOURCE_SERVER_SECRET"),false);
});

test("Production config refuses staging/cross-environment routing and invalid names",()=>{
  for(const [key,value] of [
    ["MCP_PRODUCTION_WORKER_NAME","example-mcp-adapter-staging"],
    ["MCP_PRODUCTION_CORE_SERVICE","lifespace-core-staging"],
    ["MCP_PRODUCTION_IDENTITY_SERVICE","example-identity-staging"],
    ["MCP_PRODUCTION_RESOURCE_ORIGIN","https://core-staging.example.test"],
    ["MCP_PRODUCTION_OAUTH_ISSUER","https://auth-staging.example.test"],
    ["MCP_PRODUCTION_RESOURCE_ORIGIN","http://core.example.test"],
    ["MCP_PRODUCTION_RESOURCE_ORIGIN","https://core.example.test/mcp"],
    ["MCP_PRODUCTION_OAUTH_ISSUER","https://user:pass@auth.example.test"],
    ["MCP_PRODUCTION_OAUTH_ISSUER","https://localhost"],
    ["MCP_PRODUCTION_WORKER_NAME","../example"],
    ["MCP_PRODUCTION_IDENTITY_SERVICE",""],
  ])assert.throws(()=>privateProductionConfig({...example(),[key]:value}),key);
  assert.throws(()=>privateProductionConfig({...example(),
    MCP_PRODUCTION_WORKER_NAME:"example-core"}));
  assert.throws(()=>privateProductionConfig({...example(),
    MCP_PRODUCTION_OAUTH_ISSUER:"https://core.example.test"}));
});

test("Production config must have each explicitly provided protected environment value",()=>{
  for(const key of Object.keys(example())) {
    const config=example();
    delete config[key];
    assert.throws(()=>privateProductionConfig(config),key);
  }
});
