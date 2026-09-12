import { describe, expect, it } from "vitest";
import {
  buildDeepSeekProbeCapabilities,
  DEEPSEEK_ACP_ARGS,
  DEEPSEEK_V4_CONTEXT_TOKENS,
  deepseekContextTokensForModel,
  deepseekDefaultCapabilities,
  deepseekDetectionSpec,
} from "./detection";

describe("deepseekDetectionSpec", () => {
  it("launches the official ACP profile", () => {
    expect(deepseekDetectionSpec.kind).toBe("deepseek");
    expect(deepseekDetectionSpec.binary).toBe("dsh");
    expect(deepseekDetectionSpec.label).toBe("DeepSeek Harness");
    expect([...DEEPSEEK_ACP_ARGS]).toEqual(["--profile", "acp"]);
    expect(deepseekDetectionSpec.update?.npm).toBe("@deepseek-ai/dsh");
  });
});

describe("deepseekContextTokensForModel", () => {
  it("maps V4 / V4.1 Flash and Pro to the official 1M window", () => {
    expect(deepseekContextTokensForModel("deepseek-v4-flash")).toBe(DEEPSEEK_V4_CONTEXT_TOKENS);
    expect(deepseekContextTokensForModel("deepseek/deepseek-v4-flash")).toBe(
      DEEPSEEK_V4_CONTEXT_TOKENS,
    );
    expect(deepseekContextTokensForModel("deepseek-v4.1-pro")).toBe(DEEPSEEK_V4_CONTEXT_TOKENS);
  });
});

describe("deepseekDefaultCapabilities", () => {
  it("advertises 1M context and high/max thinking", () => {
    expect(deepseekDefaultCapabilities.defaultContextSize).toBe("1M");
    expect(deepseekDefaultCapabilities.contextSizes?.some((size) => size.id === "1M")).toBe(true);
    expect(deepseekDefaultCapabilities.modelContextSizes?.["deepseek-v4-flash"]).toEqual(["1M"]);
    expect(deepseekDefaultCapabilities.efforts).toEqual(["high", "max"]);
    expect(deepseekDefaultCapabilities.defaultApprovalPolicy).toBe("auto");
    expect(deepseekDefaultCapabilities.slashCommands?.map((command) => command.id)).toContain(
      "compact",
    );
  });
});

describe("buildDeepSeekProbeCapabilities", () => {
  it("treats a host credential as authenticated when ACP cannot decide", () => {
    expect(buildDeepSeekProbeCapabilities(undefined, { hasCredential: true }).authState).toBe(
      "authenticated",
    );
    expect(
      buildDeepSeekProbeCapabilities({ authState: "missing" }, { hasCredential: false }).authState,
    ).toBe("missing");
  });

  it("fills 1M context for probed models that omit metadata", () => {
    const caps = buildDeepSeekProbeCapabilities(
      { models: [{ id: "deepseek-v4-flash", label: "Flash" }] },
      { hasCredential: true },
    );
    expect(caps.modelContextSizes?.["deepseek-v4-flash"]).toEqual(["1M"]);
  });
});
