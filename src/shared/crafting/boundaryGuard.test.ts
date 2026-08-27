import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function getFilesRecursively(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getFilesRecursively(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("Deep Module Boundary Guards", () => {
  const forbiddenPatternsInDomain = [
    "agents/codex/acp",
    "agents/codex/appServerRpc",
    "agents/codex/serverPool",
    "agents/codex/protocol",
    "node-pty",
    "child_process",
  ];

  it("ensures src/shared/crafting has no deep imports to codex low-level transport", () => {
    const craftingDir = path.resolve(__dirname);
    const files = getFilesRecursively(craftingDir).filter((f) => !f.endsWith(".test.ts"));

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      for (const forbidden of forbiddenPatternsInDomain) {
        expect(
          content.includes(forbidden),
          `File '${file}' violates deep-module boundary by importing '${forbidden}'`,
        ).toBe(false);
      }
    }
  });

  it("ensures src/renderer/components/crafting only imports shared crafting contracts", () => {
    const uiDir = path.resolve(__dirname, "../../renderer/components/crafting");
    const files = getFilesRecursively(uiDir);

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      for (const forbidden of forbiddenPatternsInDomain) {
        expect(
          content.includes(forbidden),
          `UI component '${file}' violates boundary by importing '${forbidden}'`,
        ).toBe(false);
      }
    }
  });

  it("ensures nativeCodex runtime has no dependencies on legacy PoraCode ThreadSessionManager or SpawnPipeline", () => {
    const nativeCodexDir = path.resolve(__dirname, "../../supervisor/runtime/nativeCodex");
    const files = getFilesRecursively(nativeCodexDir);

    expect(files.length).toBeGreaterThan(0);

    const legacyPoraCodePatterns = [
      "threadSessionManager",
      "spawnPipeline",
      "ThreadSessionManager",
      "SpawnPipeline",
      "CodexStructuredSession",
      "agents/codex",
    ];

    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      for (const pattern of legacyPoraCodePatterns) {
        expect(
          content.includes(pattern),
          `Native Codex file '${file}' violates isolation by referencing legacy pattern '${pattern}'`,
        ).toBe(false);
      }
    }
  });
});
