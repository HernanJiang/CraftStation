import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { createDeepSeekMcpProjection } from "./deepSeekMcpProjection";

const server = {
  id: "craft-goal",
  name: "craft_goal",
  timeoutMs: 30000,
  transport: {
    type: "http" as const,
    url: "http://127.0.0.1:1234/mcp",
    headers: { Authorization: "Bearer fixture-secret" },
  },
};
describe("DSH MCP injection", () => {
  it("uses the official plugin schema and keeps headers in child env", () => {
    const projection = createDeepSeekMcpProjection([server])!;
    try {
      const text = readFileSync(projection.configPath, "utf8");
      expect(text).not.toContain("fixture-secret");
      const parsed = parseDocument(text).toJS();
      expect(parsed[0].insert[0]).toMatchObject({
        name: "@deepseek-ai/dsh-mcp-client",
        config: {
          serverName: "craft_goal",
          transport: "streamable-http",
          failOnStartupError: true,
        },
      });
      expect(projection.env.CRAFTSTATION_DSH_MCP_0_HEADERS).toContain("fixture-secret");
    } finally {
      projection.dispose();
    }
    expect(existsSync(projection.configPath)).toBe(false);
  });
  it("preserves a legacy plugin sequence and rejects unsupported config shapes", () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-mcp-test-"));
    try {
      const base = join(dir, "base.yml");
      const original =
        "- id: original\n  name: '@deepseek-ai/dsh-sdk-jsonrpc-server'\n  config:\n    cwd: !!js process.cwd()\n";
      writeFileSync(base, original);
      const projected = createDeepSeekMcpProjection([server], base)!;
      try {
        expect(readFileSync(projected.configPath, "utf8")).toContain(original);
      } finally {
        projected.dispose();
      }
      writeFileSync(base, "plugins: []\n");
      expect(() => createDeepSeekMcpProjection([server], base)).toThrow(
        "DSH_MCP_CONFIG_REQUIRES_PLUGIN_SEQUENCE",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
