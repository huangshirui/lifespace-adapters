import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("provider deployment profiles are private and independently named", () => {
  const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  const names = [config.name];
  for (const environment of ["staging", "production"]) {
    const profile = config.env[environment];
    names.push(profile.name);
    assert.equal(profile.workers_dev, false);
    assert.equal(profile.preview_urls, false);
    assert.deepEqual(profile.routes, []);
    for (const forbidden of ["services", "d1_databases", "r2_buckets", "vars"]) {
      assert.equal(profile[forbidden], undefined);
    }
  }
  assert.equal(new Set(names).size, 3);
});
