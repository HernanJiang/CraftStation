import { describe, expect, it } from "vitest";
import type { AgentStatus } from "@/shared/contracts";
import {
  nativeHarnessControlPlaneEntrySchema,
  type NativeHarnessDiagnostic,
} from "@/shared/crafting";
import { ipcProcedureMap } from "@/shared/ipc";
import {
  ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
  CODEX_NATIVE_HARNESS_DESCRIPTOR,
  DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
  GROK_NATIVE_HARNESS_DESCRIPTOR,
  KIMI_NATIVE_HARNESS_DESCRIPTOR,
  MUSE_NATIVE_HARNESS_DESCRIPTOR,
  OPENCODE_NATIVE_HARNESS_DESCRIPTOR,
} from "./descriptors";
import { projectNativeHarnessControlPlane } from "./controlPlane";

function status(overrides: Partial<AgentStatus>): AgentStatus {
  return {
    kind: "grok",
    label: "Grok",
    installed: true,
    authState: "authenticated",
    capabilities: {},
    ...overrides,
  } as AgentStatus;
}

describe("Native Harness control-plane projection", () => {
  it("is exposed through the typed Supervisor IPC seam with a bounded payload", () => {
    const procedure = ipcProcedureMap.getNativeHarnessControlPlane;
    expect(procedure.transport).toBe("supervisor");
    expect(procedure.parseArgs({ harnessKind: "grok" })).toEqual({ harnessKind: "grok" });
    expect(procedure.parseArgs({})).toEqual({});
    expect(() => procedure.parseArgs({ harnessKind: "C:\\secret\\profile" })).toThrow(
      "must match pattern",
    );
  });

  it("exposes official Crafting model discovery through a typed project-location payload", () => {
    const procedure = ipcProcedureMap.getCraftingModelInventory;
    expect(procedure.transport).toBe("supervisor");
    expect(procedure.parseArgs({ projectLocation: { kind: "windows", path: "C:\\repo" } })).toEqual(
      { projectLocation: { kind: "windows", path: "C:\\repo" } },
    );
    expect(() => procedure.parseArgs({ projectLocation: { kind: "windows", path: "" } })).toThrow(
      "Too small",
    );
  });

  it("returns safe public descriptors and readiness without exposing paths or profile identity", () => {
    const result = projectNativeHarnessControlPlane({
      descriptors: [
        {
          ...GROK_NATIVE_HARNESS_DESCRIPTOR,
          machineFacingBoundary: "C:\\Users\\haona\\.craftstation\\bin\\grok.exe --stdio",
        },
      ],
      statuses: [
        status({
          executablePath: "C:\\Users\\haona\\secret\\grok.exe",
          envKind: "windows",
        }),
      ],
      profileConfigured: new Set(["grok"]),
      environmentKind: "windows",
    });

    expect(result).toEqual([
      expect.objectContaining({
        status: "ready",
        profileConfigured: true,
        environmentKind: "windows",
        descriptor: expect.objectContaining({
          harnessKind: "grok",
          machineFacingBoundary: "native runtime boundary",
        }),
      }),
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("C:\\\\Users");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("profileRef");
    expect(serialized).not.toContain("executablePath");
    expect(nativeHarnessControlPlaneEntrySchema.array().parse(result)).toEqual(result);
  });

  it("distinguishes authenticated, missing, uninstalled and unavailable runtimes", () => {
    const result = projectNativeHarnessControlPlane({
      descriptors: [
        CODEX_NATIVE_HARNESS_DESCRIPTOR,
        GROK_NATIVE_HARNESS_DESCRIPTOR,
        KIMI_NATIVE_HARNESS_DESCRIPTOR,
        ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
        DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
      ],
      statuses: [
        status({ kind: "codex", authState: "authenticated" }),
        status({ kind: "grok", authState: "missing" }),
        status({ kind: "kimi", installed: false, authState: "unknown" }),
      ],
      profileConfigured: new Set(["codex"]),
      environmentKind: "posix",
    });

    expect(result.map((entry) => [entry.descriptor.harnessKind, entry.status])).toEqual([
      ["codex", "ready"],
      ["grok", "not-configured"],
      ["kimi", "unavailable"],
      ["antigravity", "not-configured"],
      ["deepseek", "unavailable"],
    ]);
    expect(result.find((entry) => entry.descriptor.harnessKind === "grok")?.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "AUTH_REQUIRED" })]),
    );
    expect(
      result.find((entry) => entry.descriptor.harnessKind === "deepseek")?.diagnostics,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: "RUNTIME_UNAVAILABLE" })]));
  });

  it("does not treat a pending empty account profile as an authenticated signal", () => {
    const result = projectNativeHarnessControlPlane({
      descriptors: [CODEX_NATIVE_HARNESS_DESCRIPTOR],
      statuses: [status({ kind: "codex", authState: "unknown" })],
      profileConfigured: new Set(),
      environmentKind: "windows",
    });

    expect(result[0]).toMatchObject({
      status: "not-configured",
      profileConfigured: false,
    });
  });

  it("redacts provider diagnostic details while retaining stable codes and remediation", () => {
    const diagnostic: NativeHarnessDiagnostic = {
      code: "PROTOCOL_MISMATCH",
      harnessKind: "grok",
      phase: "readiness",
      operation: "initialize",
      message: "protocol failed with token=super-secret at C:\\private\\runtime",
      providerCode: "VENDOR_PRIVATE_CODE",
      remediation: "Update the runtime",
      details: {
        executablePath: "C:\\private\\runtime\\grok.exe",
        token: "super-secret",
      },
      occurredAt: new Date().toISOString(),
    };
    const result = projectNativeHarnessControlPlane({
      descriptors: [GROK_NATIVE_HARNESS_DESCRIPTOR],
      statuses: [status({ kind: "grok", authState: "authenticated" })],
      profileConfigured: new Set(),
      environmentKind: "windows",
      diagnostics: new Map([["grok", [diagnostic, diagnostic]]]),
    });

    expect(result[0]?.diagnostics).toEqual([
      {
        code: "PROTOCOL_MISMATCH",
        harnessKind: "grok",
        phase: "readiness",
        operation: "initialize",
        message: "grok native protocol is incompatible.",
        remediation: "Update the official runtime and retry discovery.",
      },
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("VENDOR_PRIVATE_CODE");
    expect(serialized).not.toContain("executablePath");
  });

  it("projects native execution failures as error instead of hiding them as ready", () => {
    const result = projectNativeHarnessControlPlane({
      descriptors: [GROK_NATIVE_HARNESS_DESCRIPTOR],
      statuses: [status({ kind: "grok", authState: "authenticated" })],
      profileConfigured: new Set(["grok"]),
      environmentKind: "windows",
      diagnostics: new Map([
        [
          "grok",
          [
            {
              code: "NATIVE_EXECUTION_FAILED",
              harnessKind: "grok",
              phase: "turn",
              operation: "send",
              message: "private provider failure",
              occurredAt: new Date().toISOString(),
            },
          ],
        ],
      ]),
    });

    expect(result[0]?.status).toBe("error");
  });

  it("treats a WSL Muse install as ready on Windows", () => {
    const result = projectNativeHarnessControlPlane({
      descriptors: [MUSE_NATIVE_HARNESS_DESCRIPTOR],
      statuses: [
        status({
          kind: "muse",
          label: "Muse Code",
          installed: false,
          authState: "missing",
          envKind: "windows",
        }),
        status({
          kind: "muse",
          label: "Muse Code",
          installed: true,
          authState: "authenticated",
          envKind: "wsl",
          envDistro: "Ubuntu",
        }),
      ],
      profileConfigured: new Set(["muse"]),
      environmentKind: "windows",
    });

    expect(result[0]).toMatchObject({
      status: "ready",
      environmentKind: "wsl",
      descriptor: expect.objectContaining({ harnessKind: "muse" }),
    });
  });

  it("treats installed Muse as ready when a third-party OpenAI-compatible profile exists", () => {
    const result = projectNativeHarnessControlPlane({
      descriptors: [MUSE_NATIVE_HARNESS_DESCRIPTOR],
      statuses: [
        status({
          kind: "muse",
          label: "Muse Code",
          installed: true,
          authState: "missing",
          envKind: "wsl",
          envDistro: "Ubuntu",
        }),
      ],
      profileConfigured: new Set(["openai-compatible"]),
      environmentKind: "windows",
    });

    expect(result[0]).toMatchObject({
      status: "ready",
      environmentKind: "wsl",
      descriptor: expect.objectContaining({ harnessKind: "muse" }),
    });
    expect(result[0]?.diagnostics.some((entry) => entry.code === "AUTH_REQUIRED")).toBe(false);
  });

  it("keeps installed Muse not-configured without official login or a third-party profile", () => {
    const result = projectNativeHarnessControlPlane({
      descriptors: [MUSE_NATIVE_HARNESS_DESCRIPTOR],
      statuses: [
        status({
          kind: "muse",
          label: "Muse Code",
          installed: true,
          authState: "missing",
          envKind: "wsl",
          envDistro: "Ubuntu",
        }),
      ],
      profileConfigured: new Set(),
      environmentKind: "windows",
    });

    expect(result[0]?.status).toBe("not-configured");
    expect(result[0]?.diagnostics.some((entry) => entry.code === "AUTH_REQUIRED")).toBe(true);
  });

  it("exposes OpenCode through the existing safe control-plane seam without claiming integration", () => {
    const result = projectNativeHarnessControlPlane({
      descriptors: [OPENCODE_NATIVE_HARNESS_DESCRIPTOR],
      statuses: [],
      profileConfigured: new Set(["opencode"]),
      environmentKind: "windows",
      diagnostics: new Map([
        [
          "opencode",
          [
            {
              code: "RUNTIME_UNAVAILABLE",
              harnessKind: "opencode",
              phase: "discovery",
              operation: "discover",
              message: "opencode binary unavailable",
              details: { token: "must-not-cross-ipc" },
              occurredAt: new Date(0).toISOString(),
            },
          ],
        ],
      ]),
    });

    expect(result[0]).toMatchObject({
      status: "unavailable",
      profileConfigured: true,
      descriptor: {
        harnessKind: "opencode",
        transport: "official-http-sse",
        capabilities: { streaming: "implementation missing", compaction: "implementation missing" },
      },
    });
    expect(JSON.stringify(result)).not.toContain("must-not-cross-ipc");
    expect(JSON.stringify(result)).not.toContain("details");
  });
});
