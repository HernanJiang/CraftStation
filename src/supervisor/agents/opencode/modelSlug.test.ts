import { describe, expect, it } from "vitest";
import { formatOpenCodeModelFlag, parseOpenCodeModelSlug } from "./modelSlug";

describe("parseOpenCodeModelSlug", () => {
  it("keeps foreign slash model ids on the bound third-party endpoint", () => {
    expect(parseOpenCodeModelSlug("vendor/model", "craftstation-compat")).toEqual({
      providerID: "craftstation-compat",
      modelID: "vendor/model",
    });
    expect(
      parseOpenCodeModelSlug("craftstation-compat/vendor/model", "craftstation-compat"),
    ).toEqual({ providerID: "craftstation-compat", modelID: "vendor/model" });
  });
  it("keeps an explicit provider/model slug", () => {
    expect(parseOpenCodeModelSlug("google/gemini-3.8-flash")).toEqual({
      providerID: "google",
      modelID: "gemini-3.8-flash",
    });
  });

  it("infers google for a bare Gemini recipe id instead of dropping the model", () => {
    expect(parseOpenCodeModelSlug("gemini-3.8-flash")).toEqual({
      providerID: "google",
      modelID: "gemini-3.8-flash",
    });
  });

  it("infers the family provider for other unprefixed catalog ids", () => {
    expect(parseOpenCodeModelSlug("grok-4.6")).toEqual({
      providerID: "xai",
      modelID: "grok-4.6",
    });
    expect(parseOpenCodeModelSlug("gpt-5.4-mini")).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4-mini",
    });
    expect(parseOpenCodeModelSlug("deepseek-v4-flash")).toEqual({
      providerID: "deepseek",
      modelID: "deepseek-v4-flash",
    });
    expect(parseOpenCodeModelSlug("kimi-k2.5")).toEqual({
      providerID: "kimi-for-coding",
      modelID: "kimi-k2.5",
    });
  });

  it("binds a stripped craftstation prefix to the injected isolated provider", () => {
    expect(parseOpenCodeModelSlug("craftstation/glm-5.3-flash", "craftstation")).toEqual({
      providerID: "craftstation",
      modelID: "glm-5.3-flash",
    });
  });

  it("drops the reserved craftstation prefix on the shared pool", () => {
    expect(parseOpenCodeModelSlug("craftstation/glm-5.3-flash")).toBeUndefined();
  });

  it("returns undefined for an empty slug", () => {
    expect(parseOpenCodeModelSlug(undefined)).toBeUndefined();
    expect(parseOpenCodeModelSlug("")).toBeUndefined();
    expect(parseOpenCodeModelSlug("   ")).toBeUndefined();
  });
});

describe("formatOpenCodeModelFlag", () => {
  it("emits provider/model for a bare Gemini recipe id", () => {
    expect(formatOpenCodeModelFlag("gemini-3.8-flash")).toBe("google/gemini-3.8-flash");
  });

  it("passes through an already-prefixed slug", () => {
    expect(formatOpenCodeModelFlag("opencode/big-pickle")).toBe("opencode/big-pickle");
  });

  it("does not pass the reserved craftstation prefix through as a model name", () => {
    expect(formatOpenCodeModelFlag("craftstation/step-5-preview")).toBeUndefined();
  });
});
