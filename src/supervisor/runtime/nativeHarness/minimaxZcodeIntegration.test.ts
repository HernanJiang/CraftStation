import { describe, expect, it } from "vitest";
import type { ProjectLocation } from "@/shared/contracts";
import {
  createNativeHarnessRuntimeAdapter,
  MINIMAX_NATIVE_HARNESS_DESCRIPTOR,
  PtyNativeHarnessRuntimeAdapter,
  PI_NATIVE_HARNESS_DESCRIPTOR,
  STEPCODE_NATIVE_HARNESS_DESCRIPTOR,
  StructuredNativeHarnessRuntimeAdapter,
  ZCODE_NATIVE_HARNESS_DESCRIPTOR,
} from "./index";

const location: ProjectLocation = { kind: "windows", path: "D:\\repo" };

describe("MiniMax Code and ZCode native harness integration", () => {
  it("uses the installed Pi RPC adapter for the marketplace entry", () => {
    const adapter = createNativeHarnessRuntimeAdapter("pi", { projectLocation: location });
    expect(adapter).toBeInstanceOf(StructuredNativeHarnessRuntimeAdapter);
    expect(adapter?.descriptor).toBe(PI_NATIVE_HARNESS_DESCRIPTOR);
    expect(adapter?.harnessKind).toBe("pi");
    expect(adapter?.descriptor?.transport).toBe("pi-jsonl-rpc-stdio");
  });

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

  it("routes Step Code through the structured pi-family RPC session", () => {
    const adapter = createNativeHarnessRuntimeAdapter("stepcode", { projectLocation: location });
    if (!adapter?.descriptor) throw new Error("expected Step Code native runtime adapter");

    expect(adapter).toBeInstanceOf(StructuredNativeHarnessRuntimeAdapter);
    expect(adapter.harnessKind).toBe("stepcode");
    expect(adapter.descriptor).toBe(STEPCODE_NATIVE_HARNESS_DESCRIPTOR);
    expect(adapter.descriptor.transport).toBe("pi-jsonl-rpc-stdio");
    expect(adapter.descriptor.vendor).toBe("stepfun");
  });
});
