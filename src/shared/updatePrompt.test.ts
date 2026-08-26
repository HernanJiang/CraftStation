import { describe, expect, it } from "vitest";
import { detectUpdatePrompt } from "./updatePrompt";

describe("detectUpdatePrompt", () => {
  const SAMPLE_TEXT = [
    "🎉Update available! 0.116.0 -> 0.117.0",
    "",
    "Release notes: https://github.com/openai/codex/releases/latest",
    "",
    "> 1. Update now (runs `npm install -g @openai/codex`)",
    "  2. Skip",
    "  3. Skip until next version",
    "",
    "Press enter to continue",
  ].join("\n");

  it("detects the update prompt", () => {
    expect(detectUpdatePrompt(SAMPLE_TEXT)).toBe(true);
  });

  it("returns false for unrelated text", () => {
    expect(detectUpdatePrompt("hello world")).toBe(false);
  });

  it("returns false for empty text", () => {
    expect(detectUpdatePrompt("")).toBe(false);
  });

  it("detects without emoji prefix", () => {
    const text = SAMPLE_TEXT.replace("🎉", "");
    expect(detectUpdatePrompt(text)).toBe(true);
  });
});
