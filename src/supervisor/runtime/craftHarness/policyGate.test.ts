import { describe, expect, it } from "vitest";
import { isShellToolCall, policyGate } from "./policyGate";

describe("policyGate", () => {
  it("allows an unbound thread and ignores spend until the thread is bound", () => {
    policyGate.reset();
    expect(policyGate.decide("missing", { shell: true })).toEqual({ action: "allow" });
    policyGate.recordUsd("missing", 5);
    expect(policyGate.decide("missing", { shell: false })).toEqual({ action: "allow" });
  });

  it("counts allow and ask, and does not count a deny", () => {
    policyGate.reset();
    policyGate.bind("thread", { session: { maxToolCalls: 1, askBeforeShell: true } });
    expect(policyGate.decide("thread", { shell: true }).action).toBe("ask");
    const denied = policyGate.decide("thread", { shell: true });
    expect(denied.action).toBe("deny");
    expect(policyGate.decide("thread", { shell: false }).action).toBe("deny");
  });

  it("denies the next call after recorded dollars reach the cap", () => {
    policyGate.reset();
    policyGate.bind("thread", { global: { maxCostUsd: 2 } });
    expect(policyGate.decide("thread", { shell: false }).action).toBe("allow");
    policyGate.recordUsd("thread", 2);
    expect(policyGate.decide("thread", { shell: false })).toMatchObject({
      action: "deny",
      limit: "maxCostUsd",
    });
  });

  it("starts a fresh budget on reset and keeps counters when asked", () => {
    policyGate.reset();
    policyGate.bind("thread", { session: { maxToolCalls: 2 } });
    policyGate.decide("thread", { shell: false });
    policyGate.recordUsd("thread", 1);
    policyGate.bind("thread", { session: { maxCostUsd: 1, maxToolCalls: 2 } }, "keep");
    expect(policyGate.decide("thread", { shell: false })).toMatchObject({
      action: "deny",
      limit: "maxCostUsd",
    });
    policyGate.bind("thread", { session: { maxToolCalls: 2, maxCostUsd: 1 } }, "reset");
    expect(policyGate.decide("thread", { shell: false }).action).toBe("allow");
    policyGate.clear("thread");
    expect(policyGate.decide("thread", { shell: true }).action).toBe("allow");
  });

  it("treats execute and a command payload as shell", () => {
    expect(isShellToolCall({ kind: "execute" })).toBe(true);
    expect(isShellToolCall({ kind: "other", rawInput: { command: "pnpm test" } })).toBe(true);
    expect(isShellToolCall({ kind: "read", rawInput: { path: "a.ts" } })).toBe(false);
  });
});
