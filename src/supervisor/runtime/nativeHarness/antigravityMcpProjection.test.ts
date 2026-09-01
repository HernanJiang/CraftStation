import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedMcpServer } from "@/shared/contracts";
import {
  createAntigravityMcpProjection,
  type AntigravityMcpProjection,
} from "./antigravityMcpProjection";

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

function temporaryProjectionRoot(): {
  root: string;
  nativeHomeDir: string;
  options: { nativeHomeDir: string; temporaryBaseDir: string };
} {
  const root = mkdtempSync(join(tmpdir(), "antigravity-projection-test-"));
  const nativeHomeDir = join(root, "native-antigravity-home");
  return {
    root,
    nativeHomeDir,
    options: { nativeHomeDir, temporaryBaseDir: root },
  };
}

describe("Antigravity selected MCP projection", () => {
  it("keeps first-conversation writes in the persistent native store after dispose", () => {
    const temporary = temporaryProjectionRoot();
    let projection: AntigravityMcpProjection | undefined;
    try {
      projection = createAntigravityMcpProjection(
        [stdioServer("craft-probe", { CRAFTSTATION_PROBE_SECRET: "env-only-value" })],
        temporary.options,
      );
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

      const isolatedConversations = join(
        projection.homeDir,
        ".gemini",
        "antigravity-cli",
        "conversations",
      );
      const persistentConversations = join(temporary.nativeHomeDir, "conversations");
      expect(existsSync(persistentConversations)).toBe(true);
      expect(lstatSync(isolatedConversations).isSymbolicLink()).toBe(true);
      writeFileSync(join(isolatedConversations, "first-conversation.db"), "persistent");

      projection.dispose();
      projection.dispose();
      expect(existsSync(projection.homeDir)).toBe(false);
      expect(readFileSync(join(persistentConversations, "first-conversation.db"), "utf8")).toBe(
        "persistent",
      );
    } finally {
      projection?.dispose();
      rmSync(temporary.root, { recursive: true, force: true });
    }
  });

  it("filters header-bearing and credential-like servers without logging secrets", () => {
    const temporary = temporaryProjectionRoot();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let projection: AntigravityMcpProjection | undefined;
    try {
      projection = createAntigravityMcpProjection(
        [
          stdioServer("safe-server"),
          {
            id: "app-controls",
            name: "craftstation",
            timeoutMs: 30_000,
            transport: {
              type: "http",
              url: "http://127.0.0.1:49152/mcp",
              headers: { Authorization: "Bearer app-controls-secret" },
            },
          },
          {
            id: "query-server",
            name: "query-server",
            timeoutMs: 30_000,
            transport: {
              type: "http",
              url: "https://example.test/mcp?api_key=query-secret",
              headers: {},
            },
          },
        ],
        temporary.options,
      );
      expect(projection).toBeDefined();
      if (!projection) throw new Error("Projection was not created.");

      const config = readFileSync(projection.configPath, "utf8");
      expect(Object.keys(JSON.parse(config).mcpServers as Record<string, unknown>)).toEqual([
        "safe-server",
      ]);
      expect(config).not.toContain("app-controls-secret");
      expect(config).not.toContain("query-secret");

      const warnings = warn.mock.calls.flat().join(" ");
      expect(warnings).toContain("craftstation");
      expect(warnings).toContain("query-server");
      expect(warnings).not.toContain("app-controls-secret");
      expect(warnings).not.toContain("query-secret");
    } finally {
      projection?.dispose();
      warn.mockRestore();
      rmSync(temporary.root, { recursive: true, force: true });
    }
  });

  it("does not create an isolated home when every selected server is unsupported", () => {
    const temporary = temporaryProjectionRoot();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(
        createAntigravityMcpProjection(
          [
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
          ],
          temporary.options,
        ),
      ).toBeUndefined();
      expect(existsSync(temporary.nativeHomeDir)).toBe(false);
    } finally {
      warn.mockRestore();
      rmSync(temporary.root, { recursive: true, force: true });
    }
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
