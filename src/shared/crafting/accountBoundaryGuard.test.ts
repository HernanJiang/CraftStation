import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function listCraftingSources(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return listCraftingSources(path);
    if (entry.isFile() && path.endsWith(".ts") && !path.endsWith(".test.ts")) return [path];
    return [];
  });
}

describe("v0.4 account boundary guard", () => {
  it("keeps account/sidecar control-plane implementation out of Crafting core", () => {
    const root = join(process.cwd(), "src", "shared", "crafting");
    const files = listCraftingSources(root);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(
        /AccountStore|AccountResolver|TokenUsage|peripheralSidecar|CODEX_HOME|accountBinding/,
      );
    }
  });

  it("does not place CLIProxyAPI in official Codex runtime modules", () => {
    const root = join(process.cwd(), "src", "supervisor", "runtime", "nativeCodex");
    const source = ["appServerClient.ts", "appServerProcessHost.ts", "nativeCodexRuntimeAdapter.ts"]
      .map((file) => readFileSync(join(root, file), "utf8"))
      .join("\n");
    expect(source).not.toMatch(/CLIProxyAPI|cliproxyapi/i);
  });
});
