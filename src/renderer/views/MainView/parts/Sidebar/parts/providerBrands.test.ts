import { describe, expect, it } from "vitest";
import { brandIdForVendorKind, PROVIDER_BRANDS, PROVIDER_LABELS } from "./providerBrands";

describe("brandIdForVendorKind", () => {
  it("maps model vendors to their brand keys", () => {
    expect(brandIdForVendorKind("openai")).toBe("codex");
    expect(brandIdForVendorKind("xai")).toBe("grok");
    expect(brandIdForVendorKind("moonshot")).toBe("kimi");
    expect(brandIdForVendorKind("google")).toBe("gemini");
    expect(brandIdForVendorKind("deepseek-api")).toBe("deepseek");
    expect(brandIdForVendorKind("opencode-go")).toBe("opencode");
    expect(brandIdForVendorKind("meta")).toBe("muse");
    expect(brandIdForVendorKind("cognition")).toBe("devin");
    expect(brandIdForVendorKind("devin")).toBe("devin");
  });

  it("passes brand keys and unknowns through, normalizes case", () => {
    expect(brandIdForVendorKind("codex")).toBe("codex");
    expect(brandIdForVendorKind("kimi")).toBe("kimi");
    expect(brandIdForVendorKind("XAI")).toBe("grok");
    expect(brandIdForVendorKind("some-new-vendor")).toBe("some-new-vendor");
    expect(brandIdForVendorKind("")).toBe("");
    expect(brandIdForVendorKind(undefined)).toBe("");
  });

  it("every mapped target resolves to a real brand or honest fallback", () => {
    for (const target of [
      "codex",
      "grok",
      "kimi",
      "gemini",
      "deepseek",
      "muse",
      "opencode",
      "devin",
    ]) {
      expect(PROVIDER_BRANDS[target]).toBeDefined();
      expect(PROVIDER_LABELS[target]).toBeDefined();
    }
    expect(PROVIDER_BRANDS["deepseek"]?.logo).not.toBe("");
    // Muse still has no licensed color mark vendored.
    expect(PROVIDER_BRANDS["muse"]?.logo).toBe("");
    // Grok uses the real vendored X mark.
    expect(PROVIDER_BRANDS["grok"]?.logo).not.toBe("");
  });
});
