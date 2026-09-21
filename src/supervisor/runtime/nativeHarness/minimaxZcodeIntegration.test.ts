import { describe, expect, it } from "vitest";
import type { ProjectLocation } from "@/shared/contracts";
import {
  createNativeHarnessRuntimeAdapter,
  MINIMAX_NATIVE_HARNESS_DESCRIPTOR,
  PtyNativeHarnessRuntimeAdapter,
  StructuredNativeHarnessRuntimeAdapter,
  ZCODE_NATIVE_HARNESS_DESCRIPTOR,
} from "./index";

const location: ProjectLocation = { kind: "windows", path: "D:\\repo" };

describe("MiniMax Code and ZCode native harness integration", () => {
  it("routes MiniMax Code through its official ACP carrier", () => {
    const adapter = createNativeHarnessRuntimeAdapter("minimax", { projectLocation: location });
    if (!adapter?.descriptor) throw new Error("expected MiniMax native runtime adapter");

    expect(adapter).toBeInstanceOf(StructuredNativeHarnessRuntimeAdapter);
    expect(adapter.harnessKind).toBe("minimax");
    expect(adapter.descriptor).toBe(MINIMAX_NATIVE_HARNESS_DESCRIPTOR);
    expect(adapter.descriptor.transport).toBe("acp-stdio");
  });

  it("routes ZCode through PTY without claiming ACP compatibility", () => {
    const adapter = createNativeHarnessRuntimeAdapter("zcode", { projectLocation: location });
    if (!adapter?.descriptor) throw new Error("expected ZCode native runtime adapter");

    expect(adapter).toBeInstanceOf(PtyNativeHarnessRuntimeAdapter);
    expect(adapter.harnessKind).toBe("zcode");
    expect(adapter.descriptor).toBe(ZCODE_NATIVE_HARNESS_DESCRIPTOR);
    expect(adapter.descriptor.transport).toBe("official-pty");
    expect(adapter.descriptor.capabilities.events).toBe("implementation missing");
  });
});
