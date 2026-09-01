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

  it("declares only product-path-proven app-server capabilities", () => {
    expect(CODEX_NATIVE_HARNESS_DESCRIPTOR).toMatchObject({
      official: true,
      transport: "codex-app-server-json-rpc",
      machineFacingBoundary: "codex app-server --stdio",
    });
    expect(CODEX_NATIVE_HARNESS_DESCRIPTOR.capabilities).toMatchObject({
      start: "supported+integrated",
      resume: "supported+integrated",
      multi_turn: "supported+integrated",
      streaming: "supported+integrated",
      tool_execution: "supported+integrated",
      permission: "implementation missing",
      mcp: "supported+integrated",
      skills: "supported+integrated",
      subagents: "supported+integrated",
      context: "supported+integrated",
      compaction: "implementation missing",
      interrupt: "implementation missing",
      cleanup: "supported+integrated",
    });
  });
});
