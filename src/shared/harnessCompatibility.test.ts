import { describe, expect, it } from "vitest";
import {
  COMPATIBILITY_HARNESS_LABELS,
  applyAutoDeepseekHarnessLaunch,
  applyAutoMuseHarnessLaunch,
  isNativeModelHarnessPair,
  preferredHarnessForCompatibilityFamily,
  resolveAutoCompatibilityRoute,
  resolveCompatibilityFamily,
  resolveHarnessCompatibility,
  shouldAutoRemapToDeepseekHarness,
  shouldAutoRemapToMuseHarness,
  stripModelProviderPrefix,
} from "./harnessCompatibility";

describe("harnessCompatibility", () => {
  describe("harness labels (CLI product names, never model family names)", () => {
    it("names Harness after the CLI runtime product", () => {
      expect(COMPATIBILITY_HARNESS_LABELS).toMatchObject({
        codex: "Codex",
        kimi: "Kimi Code",
        grok: "Grok Build",
        antigravity: "Antigravity",
        opencode: "OpenCode",
        deepseek: "DeepSeek Harness",
        muse: "Muse",
      });
    });
  });

  describe("native bypass (regression: native flow never touches CPA)", () => {
    it("routes official provider + official model + official harness to native", () => {
      const result = resolveHarnessCompatibility({
        providerId: "codex",
        modelId: "gpt-5.6-sol",
        harnessId: "codex",
        nativeCompatible: true,
        upstreamProtocol: "responses",
        cpaAvailable: true,
      });
      expect(result.route).toBe("native");
      expect(result.requiresCPA).toBe(false);
      expect(result.translation).toBe(false);
    });

    it("native Meta Muse triple stays native even with CPA available", () => {
      const result = resolveAutoCompatibilityRoute({
        providerId: "muse",
        modelId: "muse-spark-1.2",
        nativeCompatible: true,
        upstreamProtocol: "responses",
        cpaAvailable: true,
      });
      expect(result.route).toBe("native");
      expect(result.requiresCPA).toBe(false);
      expect(result.modelFamily).toBe("muse");
      expect(result.affinityHarness).toBe("muse");
    });

    it("openai-compatible provider is never a native pair", () => {
      expect(
        isNativeModelHarnessPair({ providerId: "openai-compatible", harnessId: "codex" }),
      ).toBe(false);
      expect(isNativeModelHarnessPair({ providerId: "codex", harnessId: "codex" })).toBe(true);
      expect(isNativeModelHarnessPair({ providerId: "muse", harnessId: "muse" })).toBe(true);
      expect(isNativeModelHarnessPair({ providerId: "kimi", harnessId: "codex" })).toBe(false);
    });
  });

  describe("Muse family affinity (by model, not provider)", () => {
    it.each([
      "muse-spark-1.3-contributor",
      "muse-spark-1.2",
      "MUSE-SPARK-1.3-CONTRIBUTOR",
      "muse/codex-task",
      "opencode-go/muse-spark-1.3-contributor",
      "opencode-go/opencode-go/muse-spark-1.3-contributor",
      "openai-compatible/muse-spark-1.3",
    ])("classifies %s as muse family", (modelId) => {
      expect(resolveCompatibilityFamily(modelId)).toBe("muse");
      expect(preferredHarnessForCompatibilityFamily("muse")).toBe("muse");
    });

    it("strips catalog provider prefixes", () => {
      expect(stripModelProviderPrefix("opencode-go/muse-spark-1.3-contributor")).toBe(
        "muse-spark-1.3-contributor",
      );
      expect(stripModelProviderPrefix("muse-spark-1.3-contributor")).toBe(
        "muse-spark-1.3-contributor",
      );
    });

    it("remaps OpenCode Go Muse Spark onto Muse Code even when muse.exe is missing", () => {
      expect(
        applyAutoMuseHarnessLaunch(
          { agentKind: "opencode", model: "opencode-go/muse-spark-1.3-contributor" },
          false,
        ),
      ).toEqual({ agentKind: "muse", model: "opencode-go/muse-spark-1.3-contributor" });
    });

    it("remaps OpenCode Go Muse Spark onto Muse Code in Auto mode", () => {
      expect(
        shouldAutoRemapToMuseHarness({
          agentKind: "opencode",
          modelId: "opencode-go/muse-spark-1.3-contributor",
        }),
      ).toBe(true);
      expect(
        applyAutoMuseHarnessLaunch(
          { agentKind: "opencode", model: "opencode-go/muse-spark-1.3-contributor" },
          true,
        ),
      ).toEqual({ agentKind: "muse", model: "opencode-go/muse-spark-1.3-contributor" });
    });

    it("does not remap a native Muse launch", () => {
      expect(shouldAutoRemapToMuseHarness({ agentKind: "muse", modelId: "muse-spark-1.2" })).toBe(
        false,
      );
    });

    it("does not remap Command Code Muse onto Muse Code (no Responses wire yet)", () => {
      expect(
        shouldAutoRemapToMuseHarness({
          agentKind: "commandcode",
          modelId: "meta/muse-spark-1.3",
        }),
      ).toBe(false);
    });

    it("remaps Command Code DeepSeek onto dsh in Auto mode", () => {
      expect(
        shouldAutoRemapToDeepseekHarness({
          agentKind: "commandcode",
          modelId: "deepseek/deepseek-v4.1-flash",
        }),
      ).toBe(true);
      expect(
        applyAutoDeepseekHarnessLaunch(
          { agentKind: "commandcode", model: "deepseek/deepseek-v4.1-flash" },
          true,
        ),
      ).toEqual({ agentKind: "deepseek", model: "deepseek/deepseek-v4.1-flash" });
    });

    it("does not remap a native DeepSeek launch", () => {
      expect(
        shouldAutoRemapToDeepseekHarness({
          agentKind: "deepseek",
          modelId: "deepseek-v4.1-flash",
        }),
      ).toBe(false);
    });

    it("keeps existing families delegating to the third-party rules", () => {
      expect(resolveCompatibilityFamily("gpt-5.6-sol")).toBe("openai");
      expect(resolveCompatibilityFamily("k3-256k")).toBe("kimi");
      expect(resolveCompatibilityFamily("grok-4.1")).toBe("grok");
      expect(resolveCompatibilityFamily("gemini-3.8-flash")).toBe("gemini");
      expect(resolveCompatibilityFamily("")).toBe("unknown");
    });
  });

  describe("OpenCode Go Muse default (gateway-direct)", () => {
    it("routes opencode-go muse-spark through Muse Harness without translation", () => {
      const result = resolveAutoCompatibilityRoute({
        providerId: "opencode-go",
        modelId: "opencode-go/muse-spark-1.3-contributor",
        nativeCompatible: false,
        upstreamProtocol: "responses",
        cpaAvailable: true,
      });
      expect(result.modelFamily).toBe("muse");
      expect(result.harnessId).toBe("muse");
      expect(result.route).toBe("gateway-direct");
      expect(result.requiresCPA).toBe(true);
      expect(result.translation).toBe(false);
      expect(result.downstreamProtocol).toBe("responses");
      expect(result.upstreamProtocol).toBe("responses");
    });
  });

  describe("chat-only Muse (cpa-translate)", () => {
    it("translates Responses downstream to Chat Completions upstream", () => {
      const result = resolveAutoCompatibilityRoute({
        providerId: "custom-muse-api",
        modelId: "muse-spark-1.3-contributor",
        nativeCompatible: false,
        upstreamProtocol: "chat-completions",
        cpaAvailable: true,
      });
      expect(result.harnessId).toBe("muse");
      expect(result.route).toBe("cpa-translate");
      expect(result.requiresCPA).toBe(true);
      expect(result.translation).toBe(true);
      expect(result.downstreamProtocol).toBe("responses");
    });
  });

  describe("efficiency mode decision tree", () => {
    it("native combination never requires CPA", () => {
      const result = resolveHarnessCompatibility({
        providerId: "grok",
        modelId: "grok-4.1",
        harnessId: "grok",
        nativeCompatible: true,
        cpaAvailable: true,
      });
      expect(result.route).toBe("native");
      expect(result.requiresCPA).toBe(false);
    });

    it("cross-provider same protocol → gateway-direct", () => {
      const result = resolveHarnessCompatibility({
        providerId: "vendor-a",
        modelId: "model-a",
        harnessId: "opencode",
        nativeCompatible: false,
        upstreamProtocol: "chat-completions",
        cpaAvailable: true,
      });
      expect(result.route).toBe("gateway-direct");
      expect(result.requiresCPA).toBe(true);
      expect(result.translation).toBe(false);
    });

    it("cross-protocol → cpa-translate", () => {
      const result = resolveHarnessCompatibility({
        providerId: "vendor-a",
        modelId: "model-a",
        harnessId: "codex",
        nativeCompatible: false,
        upstreamProtocol: "chat-completions",
        cpaAvailable: true,
      });
      expect(result.route).toBe("cpa-translate");
      expect(result.translation).toBe(true);
    });

    it("fails closed without CPA", () => {
      const result = resolveHarnessCompatibility({
        providerId: "vendor-a",
        modelId: "model-a",
        harnessId: "opencode",
        nativeCompatible: false,
        upstreamProtocol: "chat-completions",
      });
      expect(result.route).toBe("unsupported");
      expect(result.requiresCPA).toBe(false);
    });

    it("fails closed on unknown upstream protocol instead of guessing", () => {
      const result = resolveHarnessCompatibility({
        providerId: "vendor-a",
        modelId: "model-a",
        harnessId: "opencode",
        nativeCompatible: false,
        cpaAvailable: true,
      });
      expect(result.route).toBe("unsupported");
    });

    it("fails closed for harnesses that cannot consume foreign providers", () => {
      const result = resolveHarnessCompatibility({
        providerId: "vendor-a",
        modelId: "gemini-3.8-flash",
        harnessId: "antigravity",
        nativeCompatible: false,
        upstreamProtocol: "responses",
        cpaAvailable: true,
      });
      expect(result.route).toBe("unsupported");
    });

    it("explicit user harness wins over affinity but still validates", () => {
      const result = resolveAutoCompatibilityRoute({
        providerId: "opencode-go",
        modelId: "muse-spark-1.3-contributor",
        harnessId: "opencode",
        nativeCompatible: false,
        upstreamProtocol: "responses",
        cpaAvailable: true,
      });
      expect(result.harnessId).toBe("opencode");
      expect(result.affinityHarness).toBe("muse");
      expect(result.route).toBe("gateway-direct");
    });
  });
});
