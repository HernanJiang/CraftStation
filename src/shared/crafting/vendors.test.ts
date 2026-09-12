import { describe, expect, it } from "vitest";
import { canonicalModelVendor, isSameModelVendor } from "./vendors";

describe("crafting vendors", () => {
  it("maps agent kinds to their model vendors", () => {
    expect(canonicalModelVendor("codex")).toBe("openai");
    expect(canonicalModelVendor("grok")).toBe("xai");
    expect(canonicalModelVendor("kimi")).toBe("moonshot");
    expect(canonicalModelVendor("gemini")).toBe("google");
    expect(canonicalModelVendor("antigravity")).toBe("google");
    expect(canonicalModelVendor("deepseek")).toBe("deepseek");
    expect(canonicalModelVendor("opencode")).toBe("opencode");
    expect(canonicalModelVendor("muse")).toBe("muse");
    expect(canonicalModelVendor("CODEX")).toBe("openai");
  });

  it("keeps already-canonical vendors stable and passes unknowns through", () => {
    expect(canonicalModelVendor("openai")).toBe("openai");
    expect(canonicalModelVendor("xai")).toBe("xai");
    expect(canonicalModelVendor("some-new-vendor")).toBe("some-new-vendor");
    expect(canonicalModelVendor("")).toBe("");
    expect(canonicalModelVendor(undefined)).toBe("");
  });

  it("matches genuine native pairs across naming schemes", () => {
    expect(isSameModelVendor("codex", "openai")).toBe(true);
    expect(isSameModelVendor("grok", "xai")).toBe(true);
    expect(isSameModelVendor("kimi", "moonshot")).toBe(true);
    expect(isSameModelVendor("gemini", "google")).toBe(true);
    expect(isSameModelVendor("deepseek", "deepseek")).toBe(true);
    expect(isSameModelVendor("opencode", "opencode")).toBe(true);
  });

  it("rejects cross-vendor pairs and empty input", () => {
    expect(isSameModelVendor("codex", "xai")).toBe(false);
    expect(isSameModelVendor("kimi", "openai")).toBe(false);
    expect(isSameModelVendor("", "openai")).toBe(false);
    expect(isSameModelVendor("codex", "")).toBe(false);
  });
});
