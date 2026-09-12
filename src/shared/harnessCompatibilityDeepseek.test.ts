import { describe, expect, it } from "vitest";
import {
  isNativeModelHarnessPair,
  preferredHarnessForCompatibilityFamily,
  resolveAutoCompatibilityRoute,
  resolveCompatibilityFamily,
  resolveHarnessCompatibility,
} from "./harnessCompatibility";

describe("deepseek default binding (DeepSeek model -> DeepSeek Harness)", () => {
  it.each([
    "deepseek-v4-flash",
    "deepseek-v4-pro",
    "deepseek-v4.1-flash",
    "deepseek/deepseek-v4-flash",
    "deepseek/deepseek-v4.1-flash",
    "DEEPSEEK-V4.1-FLASH",
    "deepseek:deepseek-v4.1-flash",
  ])("classifies %s as deepseek family with deepseek affinity", (modelId) => {
    expect(resolveCompatibilityFamily(modelId)).toBe("deepseek");
    expect(preferredHarnessForCompatibilityFamily("deepseek")).toBe("deepseek");
  });

  it("deepseek provider + deepseek harness is a native pair", () => {
    expect(isNativeModelHarnessPair({ providerId: "deepseek", harnessId: "deepseek" })).toBe(true);
    expect(isNativeModelHarnessPair({ providerId: "deepseek", harnessId: "opencode" })).toBe(false);
    expect(
      isNativeModelHarnessPair({ providerId: "openai-compatible", harnessId: "deepseek" }),
    ).toBe(false);
  });

  it("auto route prefers deepseek harness for deepseek models", () => {
    const result = resolveAutoCompatibilityRoute({
      providerId: "deepseek",
      modelId: "deepseek-v4.1-flash",
      nativeCompatible: true,
      upstreamProtocol: "chat-completions",
      cpaAvailable: false,
    });
    expect(result.modelFamily).toBe("deepseek");
    expect(result.affinityHarness).toBe("deepseek");
    expect(result.route).toBe("native");
    expect(result.requiresCPA).toBe(false);
  });

  it("native deepseek triple bypasses CPA entirely", () => {
    const result = resolveHarnessCompatibility({
      providerId: "deepseek",
      modelId: "deepseek-v4.1-flash",
      harnessId: "deepseek",
      nativeCompatible: true,
      upstreamProtocol: "chat-completions",
      cpaAvailable: true,
    });
    expect(result.route).toBe("native");
    expect(result.requiresCPA).toBe(false);
  });

  it("foreign provider through deepseek harness fails closed (native-only runtime)", () => {
    const result = resolveHarnessCompatibility({
      providerId: "vendor-a",
      modelId: "model-a",
      harnessId: "deepseek",
      nativeCompatible: false,
      upstreamProtocol: "chat-completions",
      cpaAvailable: true,
    });
    expect(result.route).toBe("unsupported");
    expect(result.requiresCPA).toBe(false);
  });
});
