import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("provider deployment profiles are private, independently named, and own isolated connection vaults", () => {
  const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.durable_objects?.bindings, [{ name: "CONNECTIONS", class_name: "NotionConnectionVault" }]);
  assert.deepEqual(config.migrations, [{ tag: "v1-dynamic-connections", new_sqlite_classes: ["NotionConnectionVault"] }]);
  const names = [config.name];
  for (const environment of ["staging", "production"]) {
    const profile = config.env[environment];
    names.push(profile.name);
    assert.equal(profile.workers_dev, false);
    assert.equal(profile.preview_urls, false);
    assert.deepEqual(profile.routes, []);
    assert.deepEqual(profile.durable_objects?.bindings, [{ name: "CONNECTIONS", class_name: "NotionConnectionVault" }]);
    for (const forbidden of ["services", "d1_databases", "r2_buckets", "vars"]) {
      assert.equal(profile[forbidden], undefined);
    }
  }
  assert.equal(new Set(names).size, 3);
});
