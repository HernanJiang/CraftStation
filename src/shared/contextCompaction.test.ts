import { describe, expect, it } from "vitest";
import { isContextCompactionToolName } from "./contextCompaction";

describe("isContextCompactionToolName", () => {
  it("matches Codex and generic compact labels", () => {
    expect(isContextCompactionToolName("contextCompaction")).toBe(true);
    expect(isContextCompactionToolName("ContextCompaction")).toBe(true);
    expect(isContextCompactionToolName("compact_context")).toBe(true);
    expect(isContextCompactionToolName("conversationCompaction")).toBe(true);
  });

  it("does not match slash commands or unrelated tools", () => {
    expect(isContextCompactionToolName("compact")).toBe(false);
    expect(isContextCompactionToolName("compaction")).toBe(false);
    expect(isContextCompactionToolName("bash")).toBe(false);
    expect(isContextCompactionToolName("compact_file")).toBe(false);
    expect(isContextCompactionToolName(undefined)).toBe(false);
  });
});
