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

    // Since v1.1.3, compatibility plans are fenced off BEFORE native adapter
    // selection and route through the independent Compatibility runtime adapter
    // factory; the Codex native path below that fence must stay free of any
    // Compatibility/CLIProxyAPI wiring.
    const fenceIndex = supervisorSource.indexOf('routeType === "compatibility"');
    expect(fenceIndex).toBeGreaterThan(-1);
    const compatibilityBranch = supervisorSource.slice(
      fenceIndex,
      supervisorSource.indexOf("let accountRoot"),
    );
    expect(compatibilityBranch).toContain("_compatibilityRuntimeAdapterFactory");
    expect(compatibilityBranch).not.toContain("new NativeCodexRuntimeAdapter");
    const nativePath = supervisorSource.slice(supervisorSource.indexOf("let accountRoot"));
    expect(nativePath).not.toMatch(/new CompatibilityBridgeService|CompatibilityRuntimeAdapter/u);
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
