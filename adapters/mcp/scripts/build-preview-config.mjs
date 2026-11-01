import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Deploy-time *publicly safe* configuration generator; no account IDs, paths,
// credentials or real Worker names live in version control. This script never
// deploys, changes a Service, or installs a credential.
export function buildPreviewConfig(values) {
  const workerName = String(values.MCP_WORKER_NAME ?? "");
  const identity = String(values.MCP_PREVIEW_IDENTITY_SERVICE ?? "");
  const core = String(values.MCP_PREVIEW_CORE_SERVICE ?? "");
  const modelKeys = String(values.MCP_PREVIEW_MODEL_KEYS ?? "task,event");
  const validName = name => /^[a-z][a-z0-9-]{2,62}$/u.test(name);
  if (!validName(workerName)) throw new Error("Invalid MCP Worker name");
  // Guardrail, not a substitute for reviewing Cloudflare account + bindings.
  if (!validName(identity) || !identity.endsWith("-staging")
    || !validName(core) || !core.endsWith("-staging") || identity === core) {
    throw new Error("Preview requires two distinct Staging-only Service Bindings");
  }
  const keys = modelKeys.split(",").map(k => k.trim());
  if (keys.length < 1 || keys.length > 16 || new Set(keys).size !== keys.length
    || keys.some(k => !/^[a-z][a-z0-9_-]{0,63}$/u.test(k))) {
    throw new Error("Invalid read-only MCP model selection");
  }
  return {
    name: workerName,
    main: "src/worker.mjs",
    compatibility_date: "2026-10-31",
    // No production public hostname. Preview URLs are an explicit opt-in and
    // MUST already be protected by Access Managed OAuth before deployment.
    workers_dev: false,
    preview_urls: true,
    observability: { enabled: true },
    previews: {
      vars: { MCP_MODEL_KEYS: keys.join(",") },
      services: [
        { binding: "IDENTITY", service: identity },
        { binding: "CORE", service: core },
      ],
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dest = resolve(fileURLToPath(new URL("../.wrangler.preview.generated.json", import.meta.url)));
  const config = buildPreviewConfig(process.env);
  if (dirname(dest) !== resolve(fileURLToPath(new URL("../", import.meta.url)))) {
    throw new Error("Generated preview config path changed");
  }
  writeFileSync(dest, JSON.stringify(config, null, 2) + "\n", { mode: 0o600, flag: "w" });
  console.log("MCP Preview config generated without secrets or private infrastructure output.");
}
