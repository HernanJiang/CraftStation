import { describe, expect, it } from "vitest";
import { isComposerPickerExcludedAgent } from "./useManagedComposerProviders";

describe("isComposerPickerExcludedAgent", () => {
  it("hides only the DeepSeek native harness from composer model lists", () => {
    expect(isComposerPickerExcludedAgent("deepseek")).toBe(true);
    expect(isComposerPickerExcludedAgent("deepseek-harness")).toBe(true);
    for (const kind of ["codex", "grok", "kimi", "antigravity", "opencode", "commandcode"]) {
      expect(isComposerPickerExcludedAgent(kind)).toBe(false);
    }
  });
});
