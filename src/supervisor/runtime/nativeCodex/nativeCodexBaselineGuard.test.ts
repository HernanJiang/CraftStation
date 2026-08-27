import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CODEX_NATIVE_HARNESS_DESCRIPTOR } from "../nativeHarness/descriptors";

describe("Codex native baseline guard", () => {
  it("keeps the production Codex composition path on the official app-server adapter", () => {
    const supervisorSource = fs.readFileSync(
      path.resolve(__dirname, "../../supervisorRuntime.ts"),
      "utf8",
    );

    expect(supervisorSource).toContain("new NativeCodexRuntimeAdapter");
    expect(supervisorSource).not.toMatch(/CodexHarnessRuntimeAdapter/u);
    expect(supervisorSource).not.toMatch(/CLIProxyAPI|cliproxyapi/iu);
  });

  it("declares the official app-server stdio transport without claiming unprobed capabilities", () => {
    expect(CODEX_NATIVE_HARNESS_DESCRIPTOR).toMatchObject({
      official: true,
      transport: "codex-app-server-json-rpc",
      machineFacingBoundary: "codex app-server --stdio",
    });
    expect(CODEX_NATIVE_HARNESS_DESCRIPTOR.capabilities).toMatchObject({
      start: "implementation missing",
      resume: "implementation missing",
      multi_turn: "implementation missing",
      streaming: "implementation missing",
      tool_execution: "implementation missing",
      permission: "implementation missing",
      mcp: "implementation missing",
      skills: "implementation missing",
      subagents: "implementation missing",
      context: "implementation missing",
      compaction: "implementation missing",
      interrupt: "implementation missing",
      cleanup: "implementation missing",
    });
    expect(Object.values(CODEX_NATIVE_HARNESS_DESCRIPTOR.capabilities)).not.toContain(
      "supported+integrated",
    );
  });
});
