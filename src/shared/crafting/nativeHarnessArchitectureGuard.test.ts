import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function productionSources(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) return productionSources(fullPath);
    return entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name) && !entry.name.endsWith(".test.ts")
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

describe("Native Harness architecture guards", () => {
  it("keeps the shared crafting module independent from provider implementations", () => {
    const files = productionSources(path.resolve(__dirname));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      expect(importSurface(source)).not.toMatch(
        /(?:@\/supervisor|node-pty|child_process|CLIProxyAPI|cliproxyapi|ThreadSessionManager|SpawnPipeline)/iu,
      );
    }
  });

  it("keeps renderer imports on shared IPC/contracts instead of native runtime implementations", () => {
    const files = productionSources(path.resolve(__dirname, "../../renderer"));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      expect(importSurface(source)).not.toMatch(
        /(?:supervisor\/runtime\/nativeHarness|supervisor\/runtime\/nativeCodex|node-pty|child_process)/iu,
      );
    }
  });

  it("keeps the Native Harness adapter layer free of legacy execution and API-proxy fallbacks", () => {
    const files = productionSources(path.resolve(__dirname, "../../supervisor/runtime/nativeHarness"));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      expect(source).not.toMatch(
        /(?:ThreadSessionManager|SpawnPipeline|CodexStructuredSession|CLIProxyAPI|cliproxyapi|OpenAI-compatible gateway)/iu,
      );
    }
  });
});
