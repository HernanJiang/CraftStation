// Vercel build entry for the hosted PWA. Stable and nightly deployments each
// own a dedicated origin (app.craftstation.com and app-nightly.craftstation.com), so
// both builds are rooted at `/` and get origin-isolated storage, permissions,
// assets, and service workers.
import { spawnSync } from "node:child_process";

const channel = process.env.VERCEL_ENV === "preview" ? "nightly" : "stable";
const basePath = "/";
console.log(
  `[vercel-build-mobile] VERCEL_ENV=${process.env.VERCEL_ENV} channel=${channel} base=${basePath}`,
);

const result = spawnSync("pnpm", ["run", "build:mobile"], {
  stdio: "inherit",
  env: {
    ...process.env,
    CRAFTSTATION_MOBILE_CHANNEL: channel,
    CRAFTSTATION_MOBILE_BASE_PATH: basePath,
    npm_config_enable_global_virtual_store: "false",
    npm_config_node_linker: "isolated",
    pnpm_config_verify_deps_before_run: "false",
  },
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
