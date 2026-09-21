import { describe, expect, it } from "vitest";
import { createMiniMaxAdapter } from ".";
import { buildMiniMaxArgs } from "./argv";
import { buildMiniMaxProbeCapabilities, minimaxDetectionSpec } from "./detection";

describe("MiniMax Code adapter", () => {
  it("uses the official TUI, headless, and ACP entry points", () => {
    const adapter = createMiniMaxAdapter();
    expect(
      adapter.buildLaunchArgv({ kind: "posix", path: "/repo" }, { model: "MiniMax-M3" }, "fix it"),
    ).toEqual({
      binary: "mcode",
      args: ["fix it"],
    });
    expect(buildMiniMaxArgs({ model: "MiniMax-M3" }, "continue", true)).toEqual([
      "--continue",
      "continue",
    ]);
    expect(adapter.buildOneShotCommand?.("MiniMax-M3", "", "summarize")).toEqual({
      command: "mcode",
      args: ["exec", "summarize"],
      stdin: "",
    });
    expect(minimaxDetectionSpec.update?.npm).toBe("@minimax-ai/code");
  });

  it("merges the ACP capability catalog over the safe fallback", () => {
    expect(
      buildMiniMaxProbeCapabilities({
        models: [{ id: "minimax/MiniMax-M3", label: "MiniMax M3" }],
        modes: ["plan"],
      }).models,
    ).toEqual([{ id: "minimax/MiniMax-M3", label: "MiniMax M3" }]);
  });
});
