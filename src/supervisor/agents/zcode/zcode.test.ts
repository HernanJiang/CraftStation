import { describe, expect, it } from "vitest";
import { createZCodeAdapter } from ".";
import { buildZCodeArgs } from "./argv";
import { zcodeDetectionSpec } from "./detection";
import { detectZCodeTerminalStatus } from "./terminal";

describe("ZCode adapter", () => {
  it("uses documented prompt, exact resume, and continue flags", () => {
    expect(buildZCodeArgs({ model: "GLM-5.3", mode: "plan" }, "inspect", "session-1")).toEqual([
      "--resume",
      "session-1",
      "--mode",
      "plan",
      "--prompt",
      "inspect",
    ]);
    expect(buildZCodeArgs({ model: "GLM-5.3" }, "", "")).toEqual(["--continue"]);
    expect(createZCodeAdapter().capabilities.presentationModes).toEqual(["terminal"]);
    expect(zcodeDetectionSpec.binary).toBe("zcode");
  });

  it("projects terminal work and permission states without claiming ACP", () => {
    expect(detectZCodeTerminalStatus("Thinking…")).toMatchObject({ status: "working" });
    expect(detectZCodeTerminalStatus("Allow once / deny")).toMatchObject({
      attention: "needs_approval",
    });
    expect(createZCodeAdapter().createStructuredSession).toBeUndefined();
  });
});
