import { describe, expect, it } from "vitest";
import { createDeepSeekAdapter } from "./index";
import { DEEPSEEK_ACP_ARGS } from "./detection";

describe("createDeepSeekAdapter", () => {
  it("exposes ACP identity and launch argv", () => {
    const adapter = createDeepSeekAdapter();
    expect(adapter.kind).toBe("deepseek");
    expect(adapter.label).toBe("DeepSeek Harness");
    expect(adapter.binary).toBe("dsh");
    expect(
      adapter.buildLaunchArgv?.(
        { kind: "windows", path: "C:\\tmp" },
        { model: "deepseek-chat" },
        "",
      ),
    ).toEqual({
      binary: "dsh",
      args: [...DEEPSEEK_ACP_ARGS],
    });
    expect(typeof adapter.createStructuredSession).toBe("function");
    expect(adapter.capabilities.presentationModes).toEqual(["gui"]);
    expect(adapter.capabilities.liveInputMode).toBe("server");
  });
});
