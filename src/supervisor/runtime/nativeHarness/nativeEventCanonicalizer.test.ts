import { describe, expect, it } from "vitest";
import {
  canonicalizeNativeEvent,
  createNativeCanonicalizerTurnState,
  finalResponseRemainder,
} from "./nativeEventCanonicalizer";
import {
  ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
  DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
} from "./descriptors";

function agyEvent(type: string, payload: Record<string, unknown>, sequence = 1) {
  return canonicalizeNativeEvent({
    descriptor: ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
    threadId: "t1",
    turnId: "turn-1",
    correlationId: "c1",
    event: { type, payload, sequence },
  });
}

describe("canonicalizeNativeEvent Antigravity thinking and retry noise", () => {
  it("maps thinking_delta on agent_response onto a reasoning item", () => {
    const events = agyEvent("step_update", {
      step_update: {
        conversation_id: "agy-1",
        step_index: 3,
        step_type: "agent_response",
        state: "ACTIVE",
        thinking_delta: "consider the file layout",
        text_delta: "I will read README.md",
      },
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "item.started",
          itemId: "thought:agy-1:3",
          itemType: "reasoning",
        }),
        expect.objectContaining({
          type: "content.delta",
          itemId: "thought:agy-1:3",
          stream: "reasoning_text",
          delta: "consider the file layout",
        }),
        expect.objectContaining({
          type: "content.delta",
          stream: "assistant_text",
          delta: "I will read README.md",
        }),
      ]),
    );
  });

  it("maps a dedicated thinking step onto reasoning_text", () => {
    const events = agyEvent("step_update", {
      step_update: {
        conversation_id: "agy-1",
        step_index: 2,
        step_type: "thinking",
        state: "ACTIVE",
        text_delta: "internal plan",
      },
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "content.delta",
          itemId: "thought:agy-1:2",
          stream: "reasoning_text",
          delta: "internal plan",
        }),
      ]),
    );
    expect(
      events.some((event) => event.type === "content.delta" && event.stream === "assistant_text"),
    ).toBe(false);
  });

  it("does not paint Gemini 503 capacity retries as assistant text or errors", () => {
    const noise =
      "API error (attempt 2) UNAVAILABLE (code 503): No capacity available for model gemini-3.8-flash-high on the server";
    const attempt1 =
      "API error (attempt 1): UNAVAILABLE (code 503): No capacity available for model gemini-3.8-flash-high on the server";
    expect(
      agyEvent("step_update", {
        step_update: { step_type: "agent_response", state: "ACTIVE", text_delta: noise },
      }),
    ).toEqual([]);
    expect(agyEvent("error", { message: noise })).toEqual([]);
    expect(agyEvent("error", { message: attempt1 })).toEqual([]);
    expect(
      agyEvent("assistant/chunk", {
        chunk: { type: "text-delta", text: attempt1 },
      }),
    ).toEqual([]);
  });

  it("does not paint Gemini async-task receipts as assistant text", () => {
    const dump = `Wait for background browser audit execution to complete.Task id "task-135" finished with result:

The command exited with code 0.
Output:
Launching Chrome...
Log: file:///tmp/task-135.log
<system_information>
An async task has completed. Review the task result and proceed accordingly.
</system_information>`;
    expect(
      agyEvent("step_update", {
        step_update: { step_type: "agent_response", state: "ACTIVE", text_delta: dump },
      }),
    ).toEqual([]);
    expect(
      agyEvent("step_update", {
        step_update: {
          step_type: "agent_response",
          state: "DONE",
          text_delta: "",
          response: `修复图表高度。\n\n${dump}`,
        },
      }).some((event) => event.type === "content.delta"),
    ).toBe(false);
  });

  it("completes a thinking step so wrap-up does not leave Thinking expanded", () => {
    const events = agyEvent("step_update", {
      step_update: {
        conversation_id: "agy-1",
        step_index: 2,
        step_type: "thinking",
        state: "DONE",
        text_delta: "internal plan",
      },
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "content.delta",
          itemId: "thought:agy-1:2",
          stream: "reasoning_text",
          delta: "internal plan",
        }),
        expect.objectContaining({ type: "item.completed", itemId: "thought:agy-1:2" }),
      ]),
    );
  });
});

describe("canonicalizeNativeEvent step-less thinking run splitting", () => {
  function agyEventWithState(
    event: { type: string; payload: Record<string, unknown>; sequence: number },
    state: ReturnType<typeof createNativeCanonicalizerTurnState>,
  ) {
    return canonicalizeNativeEvent({
      descriptor: ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
      threadId: "t1",
      turnId: "turn-1",
      correlationId: "c1",
      event,
      thoughtRunState: state,
    });
  }

  it("splits step-less thinking into one item per contiguous run", () => {
    const state = createNativeCanonicalizerTurnState();
    let seq = 0;
    const next = (payload: Record<string, unknown>) =>
      agyEventWithState(
        { type: "step_update", payload: { step_update: payload }, sequence: ++seq },
        state,
      );

    // thought → tool → thought: the second thinking stretch must land on a new
    // item positioned after the tool, not collapse into the turn-top item.
    next({ step_type: "thinking", state: "ACTIVE", thinking_delta: "first run" });
    next({ step_type: "thinking", state: "DONE", thinking_delta: "" });
    next({ step_type: "tool", step_index: 0, state: "ACTIVE", tool_name: "grep" });
    const secondRun = next({
      step_type: "thinking",
      state: "ACTIVE",
      thinking_delta: "second run",
    });

    expect(secondRun).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "item.started", itemId: "thought:turn-1:1" }),
        expect.objectContaining({
          type: "content.delta",
          itemId: "thought:turn-1:1",
          stream: "reasoning_text",
          delta: "second run",
        }),
      ]),
    );
  });

  it("closes an open thinking run that a tool step interrupted", () => {
    const state = createNativeCanonicalizerTurnState();
    let seq = 0;
    const next = (payload: Record<string, unknown>) =>
      agyEventWithState(
        { type: "step_update", payload: { step_update: payload }, sequence: ++seq },
        state,
      );
    // Thinking that never saw its own DONE frame before a tool arrives.
    next({ step_type: "thinking", state: "ACTIVE", thinking_delta: "still open" });
    next({ step_type: "tool", step_index: 0, state: "ACTIVE", tool_name: "grep" });
    const resumed = next({ step_type: "thinking", state: "ACTIVE", thinking_delta: "resumed" });
    expect(resumed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "item.completed", itemId: "thought:turn-1" }),
        expect.objectContaining({ type: "item.started", itemId: "thought:turn-1:1" }),
      ]),
    );
  });

  it("keeps consecutive step-less thinking deltas on one shared item", () => {
    const state = createNativeCanonicalizerTurnState();
    let seq = 0;
    const next = (payload: Record<string, unknown>) =>
      agyEventWithState(
        { type: "step_update", payload: { step_update: payload }, sequence: ++seq },
        state,
      );
    next({ step_type: "thinking", state: "ACTIVE", thinking_delta: "part one " });
    const continued = next({ step_type: "thinking", state: "ACTIVE", thinking_delta: "part two" });
    expect(continued).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "content.delta",
          itemId: "thought:turn-1",
          delta: "part two",
        }),
      ]),
    );
    expect(state.thoughtRuns).toBe(1);
  });
});

describe("canonicalizeNativeEvent agent_response text run splitting", () => {
  function agyEventWithState(
    event: { type: string; payload: Record<string, unknown>; sequence: number },
    state: ReturnType<typeof createNativeCanonicalizerTurnState>,
  ) {
    return canonicalizeNativeEvent({
      descriptor: ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
      threadId: "t1",
      turnId: "turn-1",
      correlationId: "c1",
      event,
      thoughtRunState: state,
    });
  }

  it("keeps contiguous narration deltas on the shared turn item", () => {
    const state = createNativeCanonicalizerTurnState();
    let seq = 0;
    const next = (payload: Record<string, unknown>) =>
      agyEventWithState(
        { type: "step_update", payload: { step_update: payload }, sequence: ++seq },
        state,
      );
    next({ step_type: "agent_response", state: "ACTIVE", text_delta: "part one " });
    const continued = next({
      step_type: "agent_response",
      state: "ACTIVE",
      text_delta: "part two",
    });
    expect(continued).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "content.delta",
          itemId: "item:turn-1",
          stream: "assistant_text",
          delta: "part two",
        }),
      ]),
    );
    expect(state.textRuns).toBe(1);
  });

  it("anchors narration after an interrupting tool step on a fresh item", () => {
    const state = createNativeCanonicalizerTurnState();
    let seq = 0;
    const next = (payload: Record<string, unknown>) =>
      agyEventWithState(
        { type: "step_update", payload: { step_update: payload }, sequence: ++seq },
        state,
      );

    next({ step_type: "agent_response", state: "ACTIVE", text_delta: "narration before tool" });
    next({ step_type: "tool", step_index: 0, state: "ACTIVE", tool_name: "grep" });
    const resumed = next({
      step_type: "agent_response",
      state: "ACTIVE",
      text_delta: "narration after tool",
    });

    expect(resumed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "item.completed", itemId: "item:turn-1" }),
        expect.objectContaining({ type: "item.started", itemId: "item:turn-1:text-1" }),
        expect.objectContaining({
          type: "content.delta",
          itemId: "item:turn-1:text-1",
          stream: "assistant_text",
          delta: "narration after tool",
        }),
      ]),
    );
  });

  it("opens a new text run after an interrupting thinking run too", () => {
    const state = createNativeCanonicalizerTurnState();
    let seq = 0;
    const next = (payload: Record<string, unknown>) =>
      agyEventWithState(
        { type: "step_update", payload: { step_update: payload }, sequence: ++seq },
        state,
      );

    next({ step_type: "agent_response", state: "ACTIVE", text_delta: "prose" });
    next({ step_type: "thinking", state: "ACTIVE", thinking_delta: "pondering" });
    const resumed = next({
      step_type: "agent_response",
      state: "ACTIVE",
      text_delta: "more prose",
    });
    expect(resumed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "item.started", itemId: "item:turn-1:text-1" }),
      ]),
    );
  });

  it("completes the open text and thinking runs at result", () => {
    const state = createNativeCanonicalizerTurnState();
    let seq = 0;
    const next = (type: string, payload: Record<string, unknown>) =>
      agyEventWithState({ type, payload, sequence: ++seq }, state);

    next("step_update", {
      step_update: { step_type: "agent_response", state: "ACTIVE", text_delta: "first" },
    });
    next("step_update", {
      step_update: { step_type: "tool", step_index: 0, state: "DONE", tool_name: "grep" },
    });
    next("step_update", {
      step_update: { step_type: "agent_response", state: "ACTIVE", text_delta: "second" },
    });
    next("step_update", {
      step_update: { step_type: "thinking", state: "ACTIVE", thinking_delta: "tail thought" },
    });
    const result = next("result", { result: { status: "DONE", response: "firstsecond" } });

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "item.completed", itemId: "item:turn-1" }),
        expect.objectContaining({ type: "item.completed", itemId: "item:turn-1:text-1" }),
        expect.objectContaining({ type: "item.completed", itemId: "thought:turn-1" }),
        expect.objectContaining({ type: "turn.completed", state: "completed" }),
      ]),
    );
    // The snapshot echo lands on the still-open second text run so a remainder
    // suffix continues the live item instead of resurrecting the closed one.
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "content.delta",
          itemId: "item:turn-1:text-1",
          stream: "assistant_text",
          delta: "firstsecond",
        }),
      ]),
    );
  });
});

describe("finalResponseRemainder", () => {
  it("drops a snapshot echo that only differs in whitespace", () => {
    const streamed =
      "I have launched the check and will examine once completed.I have started searching.";
    const snapshot =
      "I have launched the check and will examine once completed.\nI have started searching.\n";
    expect(finalResponseRemainder(streamed, snapshot)).toBe("");
  });

  it("emits only the untold suffix when the snapshot extends the stream", () => {
    const streamed = "first line.Second line.";
    const snapshot = "first line.\nSecond line.\nA closing note.";
    expect(finalResponseRemainder(streamed, snapshot)).toBe("\nA closing note.");
  });

  it("returns the response intact when nothing was streamed", () => {
    expect(finalResponseRemainder("", "the whole answer")).toBe("the whole answer");
  });

  it("returns empty when the stream already contains the response", () => {
    expect(finalResponseRemainder("long answer tail", "tail")).toBe("");
  });

  it("returns the response when it shares no content with the stream", () => {
    expect(finalResponseRemainder("streamed words", "completely different")).toBe(
      "completely different",
    );
  });

  it("cuts an echo embedded mid-snapshot and keeps the regenerated tail", () => {
    // Real shape from an agy conversation: the closing `result.response`
    // carried [draft answer][status 1][status 2][corrected answer] as one
    // chunk while only the two status lines had streamed.
    const earlier = "前半部分已经流过的长回复段落。\n";
    const statusA = "正在测试提炼精简后的方案并生成排版效果图，稍后为您展示最新效果。\n";
    const statusB = "正在更新官方文档并重新编译导出 PDF，稍后为您汇报结果。\n";
    const draft = "确实，“亟需打造……”这类词带有较浓的公文腔。\n* *精炼后**：\n  > 草稿版引用\n";
    const final = draft.replace("* *精炼后**", "* **精炼后**").replace("草稿版", "定稿版");
    const streamed = earlier + statusA + statusB;
    const snapshot = draft + statusA + statusB + final;
    expect(finalResponseRemainder(streamed, snapshot)).toBe(final);
  });

  it("keeps the new prefix when the embedded echo ends flush with the snapshot", () => {
    const status = "正在生成预览，稍后为您展示最新效果。\n";
    const streamed = `另一段落。\n${status}`;
    const snapshot = `新的结论正文，此前从未流出。${status}`;
    expect(finalResponseRemainder(streamed, snapshot)).toBe("新的结论正文，此前从未流出。");
  });

  it("does not cut a snapshot on a coincidental short match", () => {
    const streamed = "done.\n";
    const snapshot = "第一行。\n第二行。\n第三行。\n";
    expect(finalResponseRemainder(streamed, snapshot)).toBe(snapshot);
  });

  // Real shape from conversation 421235c2 (thread 简历优化): the stream
  // already carried the complete draft answer, then a snapshot arrived as a
  // re-rendered revision — identical opening, edited middle — truncated
  // mid-token. Appending any slice of it produced "[complete answer][second
  // opening cut off at '1. *']", which looked like the answer was cut short.
  const sharedHead =
    "结论：这份简历已经足够优秀，可以直接投递。\n\n### 一、优势\n\n1. 叙事契合度极高；\n";
  const draftTail =
    "舒展展开；\n更多旧版细节：甲乙丙丁戊己庚辛壬癸。\n\n### 三、收尾\n\n祝您投递顺利！\n";
  const revisedTail =
    "舒展开；\n更多旧版细节：甲乙丙丁戊己庚辛壬癸。\n\n### 三、收尾\n\n祝您投递顺利！";
  const streamedDraft = sharedHead + draftTail;
  const revision = sharedHead + revisedTail;

  it("drops a mid-turn rewritten snapshot of an already-complete answer", () => {
    const partialRevision = revision.slice(0, revision.length - 20);
    expect(finalResponseRemainder(streamedDraft, partialRevision)).toBe("");
  });

  it("drops a fully rewritten closing snapshot of the same answer", () => {
    expect(finalResponseRemainder(streamedDraft, revision)).toBe("");
  });

  it("still appends when a snapshot extends the answer past an interleaved status line", () => {
    const prose = "回答正文第一部分内容，已经完整流出。";
    const status = "正在生成预览，请稍候。";
    const continuation = prose + "第二部分是新的正文内容。";
    expect(finalResponseRemainder(prose + status, continuation)).toBe("第二部分是新的正文内容。");
  });
});

describe("canonicalizeNativeEvent DeepSeek turn/end reason kinds", () => {
  function dshTurnEnd(reason: Record<string, unknown>) {
    return canonicalizeNativeEvent({
      descriptor: DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
      threadId: "t1",
      turnId: "turn-1",
      correlationId: "c1",
      event: {
        type: "session.event",
        payload: { params: { sessionId: "s1", event: { type: "turn/end", data: { reason } } } },
        sequence: 1,
      },
    });
  }

  it("maps a snake_case max_tokens reason to a failed turn", () => {
    const events = dshTurnEnd({ kind: "max_tokens" });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "error" }),
        expect.objectContaining({ type: "turn.completed", state: "failed" }),
      ]),
    );
  });

  it("keeps a hyphenated max-tokens reason failed", () => {
    const events = dshTurnEnd({ kind: "max-tokens" });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "turn.completed", state: "failed" }),
      ]),
    );
  });

  it("keeps an unknown reason kind completed", () => {
    const events = dshTurnEnd({ kind: "finished" });
    expect(events).toEqual([
      expect.objectContaining({ type: "turn.completed", state: "completed" }),
    ]);
  });
});
