import { describe, expect, it, vi } from "vitest";
import {
  DEEPSEEK_ACP_UPSTREAM,
  buildDeepSeekProfileArgs,
  getDeepSeekCapabilitySummary,
  isDeepSeekNativeHarnessKind,
  normalizeDeepSeekProfileName,
  resolveDeepSeekTransport,
} from "./deepseekCapabilityProfile";
import { createNativeHarnessRuntimeAdapter } from "./index";
import { buildDeepSeekProfileArgs as buildTransportProfileArgs } from "./nativeTransport";
import type { ProjectLocation } from "@/shared/contracts";

const location: ProjectLocation = { kind: "windows", path: "D:\\tmp" };

describe("deepseek harness first-class profile", () => {
  it("recognizes both native spellings, excluding the API runtime", () => {
    expect(isDeepSeekNativeHarnessKind("deepseek")).toBe(true);
    expect(isDeepSeekNativeHarnessKind("deepseek-harness")).toBe(true);
    expect(isDeepSeekNativeHarnessKind("deepseek-api")).toBe(false);
    expect(isDeepSeekNativeHarnessKind("codex")).toBe(false);
  });

  it("tracks upstream master: persistent ACP sessions, no private UI", () => {
    expect(DEEPSEEK_ACP_UPSTREAM.freshSessionsOnly).toBe(false);
    for (const method of ["session/new", "session/list", "session/resume", "session/close"]) {
      expect(DEEPSEEK_ACP_UPSTREAM.supportedMethods).toContain(method);
    }
    for (const unsupported of ["session/delete", "session/fork", "elicitation"]) {
      expect(DEEPSEEK_ACP_UPSTREAM.unsupportedMethods).toContain(unsupported);
    }
    expect(DEEPSEEK_ACP_UPSTREAM.mcpTransports).toEqual(["stdio", "streamable-http"]);
  });

  it("normalizes profiles (unknown -> sdk) and resolves transports", () => {
    expect(normalizeDeepSeekProfileName("acp")).toBe("acp");
    expect(normalizeDeepSeekProfileName(undefined)).toBe("sdk");
    expect(normalizeDeepSeekProfileName("headless")).toBe("sdk");
    expect(
      resolveDeepSeekTransport({ executablePath: "C:\\bin\\dsh.cmd", profileRef: "acp" }),
    ).toBe("acp-stdio");
    expect(
      resolveDeepSeekTransport({
        executablePath: "C:\\bin\\dsh.cmd",
        profileRef: "sdk",
        sdkClientAvailable: true,
      }),
    ).toBe("sdk-client");
    expect(resolveDeepSeekTransport({ executablePath: "dsh-jsonrpc-agent" })).toBe("jsonrpc-stdio");
  });

  it("mirrors the SDK launch spec: --profile first, ordered --patch", () => {
    expect(buildDeepSeekProfileArgs("sdk", [], "C:\\repo\\cordis.yml")).toEqual([
      "--profile",
      "sdk",
      "--patch",
      "C:\\repo\\cordis.yml",
    ]);
    // acp ships ready-to-use: patch optional, never invented.
    expect(buildDeepSeekProfileArgs("acp")).toEqual(["--profile", "acp"]);
    expect(buildTransportProfileArgs("acp", ["--verbose"], "C:\\repo\\cordis.yml")).toEqual([
      "--profile",
      "acp",
      "--verbose",
      "--patch",
      "C:\\repo\\cordis.yml",
    ]);
  });

  it("sdk summary uses cordis-config MCP; acp summary uses ACP sessions", () => {
    const sdk = getDeepSeekCapabilitySummary("deepseek");
    expect(sdk.transport).toBe("sdk-client");
    expect(sdk.profile).toBe("sdk");
    expect(sdk.mcpInjection).toBe("cordis-config");
    expect(sdk.supportsResume).toBe(true);
    const acp = getDeepSeekCapabilitySummary("deepseek", "acp");
    expect(acp.transport).toBe("acp-stdio");
    expect(acp.supportsList).toBe(true);
    expect(acp.supportsClose).toBe(true);
    expect(acp.mcpInjection).toBe("acp-session");
  });

  it("deepseek-harness alias resolves to the same native factory", () => {
    const resolveExecutable = vi.fn<(cmd: string) => string | undefined>((cmd: string) =>
      cmd === "dsh-jsonrpc-agent" ? "C:\\bin\\dsh-jsonrpc-agent.exe" : undefined,
    );
    const a = createNativeHarnessRuntimeAdapter("deepseek", {
      projectLocation: location,
      resolveExecutable,
    });
    const b = createNativeHarnessRuntimeAdapter("deepseek-harness", {
      projectLocation: location,
      resolveExecutable,
    });
    expect(a?.harnessKind).toBe("deepseek");
    expect(b?.harnessKind).toBe("deepseek");
    expect(a?.descriptor?.id).toBe(b?.descriptor?.id);
  });

  it("missing executable reports Not installed instead of handshake failure", async () => {
    const adapter = createNativeHarnessRuntimeAdapter("deepseek", {
      projectLocation: location,
      resolveExecutable: () => undefined,
    });
    expect(adapter?.harnessKind).toBe("deepseek");
    // Unavailable adapter keeps the explicit discovery reason in diagnostics
    // (spawnEntity stays generic on purpose: no synthetic Entity). The
    // discovery wording must name the missing executable, never a protocol
    // handshake failure.
    if (!adapter?.getDiagnostics) throw new Error("expected deepseek adapter diagnostics");
    const diagnostics = adapter.getDiagnostics();
    expect(diagnostics[0]?.message).toMatch(/Not installed \/ executable not found/i);
    await expect(adapter.createSession({ id: "entity" } as never)).rejects.toThrow(
      /Not installed \/ executable not found/i,
    );
  });

  it("acp profile boots without an explicit Cordis config (ready-to-use)", async () => {
    const { NativeProcessHarnessRuntimeAdapter } = await import("./nativeAdapter");
    const { DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR } = await import("./descriptors");
    const adapter = new NativeProcessHarnessRuntimeAdapter({
      descriptor: DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation: location,
      mode: "deepseek",
      runtimeCommand: "dsh",
      profileRef: "acp",
    });
    const entity = await adapter.spawnEntity({
      resultItemId: "result:deepseek",
      runtimeBinding: { harnessKind: "deepseek", modelId: "deepseek-v4-flash", vendor: "deepseek" },
    } as never);
    expect(entity.status).toBe("spawned");
    await adapter.dispose();
  });

  it("sdk profile still fails closed without a Cordis config", async () => {
    const { NativeProcessHarnessRuntimeAdapter } = await import("./nativeAdapter");
    const { DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR } = await import("./descriptors");
    const adapter = new NativeProcessHarnessRuntimeAdapter({
      descriptor: DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation: location,
      mode: "deepseek",
      runtimeCommand: "dsh",
      profileRef: "sdk",
    });
    const previous = process.env.DSH_CORDIS_CONFIG;
    delete process.env.DSH_CORDIS_CONFIG;
    try {
      await expect(
        adapter.spawnEntity({
          resultItemId: "result:deepseek",
          runtimeBinding: {
            harnessKind: "deepseek",
            modelId: "deepseek-v4-flash",
            vendor: "deepseek",
          },
        } as never),
      ).rejects.toThrow(/explicit Cordis config path/i);
    } finally {
      if (previous === undefined) delete process.env.DSH_CORDIS_CONFIG;
      else process.env.DSH_CORDIS_CONFIG = previous;
      await adapter.dispose();
    }
  });
});
