import { describe, expect, it } from "vitest";
import { buildScheduleThreadContextText, extractScheduleRunSummary } from "./threadContext";

function item(id: string, type: string, text: string) {
  return {
    id,
    type,
    state: "completed",
    payload: { content: [{ kind: "text", text }] },
    streams: {},
  };
}

describe("buildScheduleThreadContextText", () => {
  it("returns null when there is no transcribable history", () => {
    expect(buildScheduleThreadContextText([])).toBeNull();
    expect(
      buildScheduleThreadContextText([item("r1", "reasoning", "internal")]),
    ).toBeNull();
  });

  it("keeps only user/assistant text and redacts secret-like tokens", () => {
    const text = buildScheduleThreadContextText([
      item("u1", "user_message", "Deploy with sk-abcdefghijklmnop now"),
      item("a1", "assistant_message", "Done"),
    ]);
    expect(text).toContain("User:");
    expect(text).toContain("Assistant:");
    expect(text).not.toContain("sk-abcdefghijklmnop");
  });

  it("truncates long transcripts", () => {
    const text = buildScheduleThreadContextText(
      [item("u1", "user_message", `TASK-${"u".repeat(9_000)}`)],
      { maxChars: 100 },
    );
    expect(text!.length).toBeLessThanOrEqual(101);
  });

  it("extracts the last completed assistant text and stays null without one", () => {
    expect(extractScheduleRunSummary([])).toBeNull();
    expect(
      extractScheduleRunSummary([
        item("u1", "user_message", "Go"),
        item("a1", "assistant_message", "First"),
        item("a2", "assistant_message", "Final answer"),
      ]),
    ).toBe("Final answer");
  });
});
