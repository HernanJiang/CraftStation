import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ResolvedMcpServer } from "@/shared/contracts";
import { createAntigravityMcpProjection } from "./antigravityMcpProjection";

function stdioServer(name: string, env: Record<string, string> = {}): ResolvedMcpServer {
  return {
    id: name,
    name,
    timeoutMs: 30_000,
    transport: {
      type: "stdio",
      command: process.execPath,
      args: ["probe.mjs"],
      env,
    },
  };
}

describe("Antigravity selected MCP projection", () => {
  it("writes only non-secret launch fields and removes the isolated home on dispose", () => {
    const projection = createAntigravityMcpProjection([
      stdioServer("craft-probe", { CRAFTSTATION_PROBE_SECRET: "env-only-value" }),
    ]);
    expect(projection).toBeDefined();
    if (!projection) throw new Error("Projection was not created.");

    const config = readFileSync(projection.configPath, "utf8");
    expect(JSON.parse(config)).toEqual({
      mcpServers: {
        "craft-probe": {
          disabled: false,
          command: process.execPath,
          args: ["probe.mjs"],
        },
      },
    });
    expect(config).not.toContain("env-only-value");
    expect(projection.env).toMatchObject({
      HOME: projection.homeDir,
      USERPROFILE: projection.homeDir,
      CRAFTSTATION_PROBE_SECRET: "env-only-value",
    });

    projection.dispose();
    projection.dispose();
    expect(existsSync(projection.homeDir)).toBe(false);
  });

  it("rejects selected MCP fields that would persist credentials", () => {
    expect(() =>
      createAntigravityMcpProjection([
        {
          id: "header-server",
          name: "header-server",
          timeoutMs: 30_000,
          transport: {
            type: "http",
            url: "https://example.test/mcp",
            headers: { Authorization: "Bearer secret" },
          },
        },
      ]),
    ).toThrow("contains headers");
    expect(() =>
      createAntigravityMcpProjection([
        {
          id: "query-server",
          name: "query-server",
          timeoutMs: 30_000,
          transport: {
            type: "http",
            url: "https://example.test/mcp?api_key=secret",
            headers: {},
          },
        },
      ]),
    ).toThrow("credential-like URL fields");
  });

  it("rejects conflicting environment requirements instead of choosing one server", () => {
    expect(() =>
      createAntigravityMcpProjection([
        stdioServer("first", { SHARED_VALUE: "one" }),
        stdioServer("second", { SHARED_VALUE: "two" }),
      ]),
    ).toThrow("conflicting values");
  });
});
