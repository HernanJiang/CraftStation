import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@/shared/contracts";
import { buildHistoryPreface, ThreadTranscriptTracker } from "./threadTranscript";

function userStarted(itemId: string, text: string): RuntimeEvent {
  return {
    type: "item.started",
    threadId: "t",
    itemId,
    itemType: "user_message",
    payload: { content: [{ kind: "text", text }] },
  };
}

function delta(itemId: string, text: string): RuntimeEvent {
  return { type: "content.delta", threadId: "t", itemId, stream: "assistant_text", delta: text };
}

function completed(itemId: string): RuntimeEvent {
  return { type: "item.completed", threadId: "t", itemId };
}

describe("ThreadTranscriptTracker", () => {
  it("records user prompts once despite optimistic + session double paint", () => {
    const tracker = new ThreadTranscriptTracker();
    tracker.observe("t", userStarted("u1", "hello"));
    tracker.observe("t", userStarted("u1", "hello"));
    expect(tracker.take("t")).toEqual([{ role: "user", text: "hello" }]);
  });

  it("assembles assistant replies from deltas on item completion", () => {
    const tracker = new ThreadTranscriptTracker();
    tracker.observe("t", userStarted("u1", "hi"));
    tracker.observe("t", delta("a1", "Hello "));
    tracker.observe("t", delta("a1", "there"));
    tracker.observe("t", completed("a1"));
    expect(tracker.take("t")).toEqual([
      { role: "user", text: "hi" },
      { role: "assistant", text: "Hello there" },
    ]);
  });

  it("ignores non-text streams and sub-agent rows", () => {
    const tracker = new ThreadTranscriptTracker();
    tracker.observe("t", {
      type: "content.delta",
      threadId: "t",
      itemId: "r1",
      stream: "reasoning_text",
      delta: "thinking",
    });
    tracker.observe("t", completed("r1"));
    tracker.observe("t", {
      type: "item.started",
      threadId: "t",
      itemId: "c1",
      itemType: "user_message",
      parentItemId: "tool-1",
      payload: { content: [{ kind: "text", text: "child" }] },
    });
    tracker.observe("t", delta("c1", "child reply"));
    tracker.observe("t", completed("c1"));
    expect(tracker.take("t")).toEqual([]);
  });

  it("flushes stranded deltas when the turn completes", () => {
    const tracker = new ThreadTranscriptTracker();
    tracker.observe("t", delta("a1", "partial"));
    tracker.observe("t", {
      type: "turn.completed",
      threadId: "t",
      turnId: "turn-1",
      state: "failed",
    });
    expect(tracker.take("t")).toEqual([{ role: "assistant", text: "partial" }]);
  });

  it("caps entries and flags truncation", () => {
    const tracker = new ThreadTranscriptTracker();
    for (let i = 0; i < 30; i++) {
      tracker.observe("t", userStarted(`u${i}`, `question ${i}`));
      tracker.observe("t", delta(`a${i}`, `answer ${i}`));
      tracker.observe("t", completed(`a${i}`));
    }
    const tail = tracker.take("t");
    expect(tail.length).toBeLessThanOrEqual(20);
    expect(tail.at(-1)).toEqual({ role: "assistant", text: "answer 29" });
    expect(tracker.wasTruncated("t")).toBe(true);
  });

  it("drops all state for a removed thread", () => {
    const tracker = new ThreadTranscriptTracker();
    tracker.observe("t", userStarted("u1", "hi"));
    tracker.drop("t");
    expect(tracker.take("t")).toEqual([]);
    expect(tracker.wasTruncated("t")).toBe(false);
  });
});

describe("buildHistoryPreface", () => {
  it("returns undefined for an empty tail", () => {
    expect(buildHistoryPreface([], "hi", false)).toBeUndefined();
  });

  it("renders labeled lines and drops a trailing duplicate of the replayed prompt", () => {
    const preface = buildHistoryPreface(
      [
        { role: "user", text: "what is 2+2" },
        { role: "assistant", text: "4" },
        { role: "user", text: "and 3+3" },
      ],
      "and 3+3",
      false,
    );
    expect(preface).toContain("用户：what is 2+2");
    expect(preface).toContain("助手：4");
    // The replayed prompt is sent right after — not repeated inside.
    expect(preface?.match(/and 3\+3/g)?.length ?? 0).toBe(0);
    expect(preface).toContain("基于以上上下文继续作答");
  });

  it("notes omitted history when truncated", () => {
    const preface = buildHistoryPreface([{ role: "user", text: "hi" }], "next", true);
    expect(preface).toContain("更早的消息已省略");
  });
});
