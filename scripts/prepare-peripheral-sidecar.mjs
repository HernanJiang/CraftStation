import { existsSync, mkdirSync, cpSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const crate = join(root, "native", "peripheral-sidecar");
const target = process.platform === "win32" ? "release" : "release";
const binaryName =
  process.platform === "win32"
    ? "craftstation-peripheral-sidecar.exe"
    : "craftstation-peripheral-sidecar";
const binary = join(crate, "target", target, binaryName);
const output = join(
  root,
  "resources",
  "peripheral-sidecar",
  `${process.platform}-${process.arch}`,
  binaryName,
);

const result = spawnSync(
  "cargo",
  ["build", "--release", "--manifest-path", join(crate, "Cargo.toml")],
  {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);
if (result.status !== 0 || !existsSync(binary)) {
  throw new Error("Peripheral sidecar build failed or produced no binary.");
}
mkdirSync(dirname(output), { recursive: true });
cpSync(binary, output);
if (process.platform !== "win32") chmodSync(output, 0o755);
console.log(`[peripheral-sidecar] staged ${output}`);
