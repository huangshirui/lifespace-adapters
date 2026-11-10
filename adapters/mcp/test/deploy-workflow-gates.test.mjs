import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = name => readFileSync(
  new URL("../../../.github/workflows/" + name, import.meta.url), "utf8",
);

const staging = read("deploy-mcp-staging.yml");
const production = read("deploy-mcp-production-private.yml");

test("both MCP release workflows require exact successful main CI, not PR-only checks", () => {
  for (const [label, workflow] of [["staging", staging], ["production", production]]) {
    assert.match(workflow, /actions: read/u, label);
    assert.match(workflow, /Require successful exact-SHA main CI/u, label);
    assert.match(workflow, /actions\/workflows\/ci\.yml\/runs/u, label);
    assert.match(workflow, /-f head_sha="\$GITHUB_SHA"/u, label);
    assert.match(workflow, /\.event == "push"/u, label);
    assert.match(workflow, /\.status == "completed"/u, label);
    assert.match(workflow, /\.conclusion == "success"/u, label);
    assert.match(workflow, /\$GITHUB_REF_NAME" = main/u, label);
    assert.match(workflow, /\$GITHUB_ACTOR" = huangshirui/u, label);
    assert.match(workflow, /\$GITHUB_TRIGGERING_ACTOR" = huangshirui/u, label);
  }
});

test("private Production release keeps explicit confirmation and same-SHA Staging evidence", () => {
  assert.match(production, /PREPARE_PRIVATE_MCP_PRODUCTION/u);
  assert.match(production, /STAGING_MCP_E2E_VERIFIED/u);
  assert.match(production, /deploy-mcp-staging\.yml\/runs/u);
  assert.match(production, /\.head_sha == \$sha/u);
  assert.match(production, /workers\.dev, preview URLs, public routes disabled/u);
});

test("Production summary never executes a candidate SHA as a shell command", () => {
  assert.ok(production.includes('echo "- Candidate SHA: $GITHUB_SHA (exact successful Staging deploy)"'));
  assert.ok(!production.includes('echo "- Candidate SHA: `$GITHUB_SHA`'));
});


test("private Production first deploy atomically installs the protected OAuth secret", () => {
  assert.match(production, /secrets\.MCP_PRODUCTION_OAUTH_RESOURCE_SERVER_SECRET/u);
  assert.match(production, /--secrets-file "\$SECRET_FILE"/u);
  assert.match(production, /trap 'rm -f "\$SECRET_FILE"' EXIT/u);
  assert.match(production, /OAUTH_RESOURCE_SERVER_SECRET:value/u);
  assert.doesNotMatch(production, /wrangler secret put OAUTH_RESOURCE_SERVER_SECRET/u);
  assert.doesNotMatch(production, /workers_dev: true/u);
});
