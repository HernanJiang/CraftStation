import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function productionSources(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) return productionSources(fullPath);
    return entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name) && !/\.test\.(?:ts|tsx)$/u.test(entry.name)
      ? [fullPath]
      : [];
  });
}

function importSurface(source: string): string {
  return source
    .split(/\r?\n/u)
    .filter((line) => /^\s*(?:import|export)\b/u.test(line))
    .join("\n");
}

// Prevents renderer/browser bundles from dragging Node-only implementations
// (node: builtins via shared helpers) into Vite. Main/Supervisor keep using
// the Node helpers directly; renderer must go through the typed bridge/IPC.
const NODE_ONLY_SHARED = [
  "@/shared/atomicFile",
  "@/shared/craftstationPaths",
  "@/shared/processTree",
  "@/shared/secretStorage",
  "@/shared/usageSecretStore",
];

describe("Node boundary guard", () => {
  it("keeps renderer production sources off Node-only shared implementations", () => {
    const files = productionSources(path.resolve(__dirname, "../renderer"));
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const surface = importSurface(fs.readFileSync(file, "utf8"));
      if (/(?:from\s+["']node:|require\(\s*["']node:)/u.test(surface)) {
        offenders.push(file);
      }
      for (const spec of NODE_ONLY_SHARED) {
        if (surface.includes(spec)) offenders.push(`${file} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
