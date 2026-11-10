// Private MCP Production Worker config: purely protocol transport.
// Live Worker/service/issuer names are provided by a protected GitHub Environment,
// never stored in this public repository or printed to workflow logs.
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function scriptName(value,label) {
  if(typeof value!=="string" || !/^[a-z][a-z0-9-]{2,120}$/u.test(value)
    || /(?:^|-)staging(?:-|$)/u.test(value))
    throw new Error("Invalid Production " + label);
  return value;
}
function httpsOrigin(raw,label) {
  if(typeof raw!=="string")throw new Error("Missing Production " + label);
  let url; try { url=new URL(raw); }catch{throw new Error("Invalid Production "+label);}
  if(url.protocol!=="https:" || url.href!==url.origin+"/"
    || url.username || url.password || url.search || url.hash
    || url.hostname==="localhost" || url.hostname.includes("staging")
    || /^(?:127\.|10\.|192\.168\.)/u.test(url.hostname))
    throw new Error("Invalid Production " + label);
  return url.origin;
}
export function privateProductionConfig(env) {
  const name=scriptName(env.MCP_PRODUCTION_WORKER_NAME,"worker name");
  const core=scriptName(env.MCP_PRODUCTION_CORE_SERVICE,"Core binding target");
  const identity=scriptName(env.MCP_PRODUCTION_IDENTITY_SERVICE,"Identity binding target");
  if(new Set([name,core,identity]).size!==3)
    throw new Error("Production services must remain separate");
  const resource=httpsOrigin(env.MCP_PRODUCTION_RESOURCE_ORIGIN,"Resource origin");
  const issuer=httpsOrigin(env.MCP_PRODUCTION_OAUTH_ISSUER,"OAuth issuer");
  if(resource===issuer)throw new Error("OAuth issuer must differ from Core Resource origin");
  return {
    name,main:"src/identity-oauth-worker.mjs",compatibility_date:"2026-11-06",
    workers_dev:false,preview_urls:false,
    vars:{ENVIRONMENT:"production",MCP_RESOURCE_ORIGIN:resource,
      MCP_OAUTH_ISSUER:issuer},
    services:[{binding:"CORE",service:core},{binding:"IDENTITY",service:identity}],
    observability:{enabled:true},
  };
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if(process.argv.length!==3 || !process.argv[2].endsWith("/wrangler.production.generated.jsonc"))
    throw new Error("Only generated private Production Wrangler config output is allowed");
  const config=privateProductionConfig(process.env);
  writeFileSync(process.argv[2],JSON.stringify(config,null,2)+"\n",{flag:"wx",mode:0o600});
  process.stdout.write("Private Production Worker configuration generated (environment-specific values withheld)\n");
}
