import { describe, expect, it } from "vitest";
import {
  closeMusePlanItem,
  isMuseCompactPrompt,
  mapMuseContextUsage,
  mapMuseGoal,
  mapMuseItemCompleted,
  mapMuseItemDelta,
  mapMuseItemStarted,
  mapMuseTodoList,
  museItemVisibleText,
  museMcpServerId,
  museToolKind,
  museToolNameFromItem,
  shouldShowMuseCompaction,
} from "./mspCanonicalMapping";

describe("muse MSP canonical mapping", () => {
  it("joins reasoning summary parts when text is not streamed", () => {
    expect(
      museItemVisibleText({ summary: ["plan the", " change"] }, "reasoning"),
    ).toBe("plan the change");
  });

  it("starts an assistant message and streams text deltas", () => {
    expect(mapMuseItemStarted("t1", { itemId: "a1", kind: "agentMessage" })).toEqual([
      {
        type: "item.started",
        threadId: "t1",
        itemId: "a1",
        itemType: "assistant_message",
        payload: { content: [] },
      },
    ]);
    expect(mapMuseItemDelta("t1", { itemId: "a1", delta: "hello" }, "agentMessage")).toEqual({
      type: "content.delta",
      threadId: "t1",
      itemId: "a1",
      stream: "assistant_text",
      delta: "hello",
    });
  });

  it("ignores the echoed user message", () => {
    expect(mapMuseItemStarted("t1", { itemId: "u1", kind: "userMessage", text: "hi" })).toEqual([]);
    expect(mapMuseItemDelta("t1", { itemId: "u1", delta: "hi" }, "userMessage")).toBeUndefined();
  });

  it("does not paint reminderChild as an assistant bubble", () => {
    expect(mapMuseItemStarted("t1", { itemId: "r1", kind: "reminderChild" })).toEqual([]);
    expect(
      mapMuseItemStarted("t1", { itemId: "r1", kind: "reminderChild", text: "reminderChild" }),
    ).toEqual([]);
    expect(mapMuseItemCompleted("t1", { itemId: "r1", kind: "reminderChild" })).toEqual([]);
    expect(mapMuseItemDelta("t1", { itemId: "r1", delta: "x" }, "reminderChild")).toBeUndefined();
  });

  it("does not fall back to the kind name as assistant text", () => {
    expect(mapMuseItemStarted("t1", { itemId: "x1", kind: "futureKind" })).toEqual([]);
    expect(
      mapMuseItemStarted("t1", {
        itemId: "x1",
        kind: "futureKind",
        fallbackText: "something happened",
      }),
    ).toEqual([
      {
        type: "item.started",
        threadId: "t1",
        itemId: "x1",
        itemType: "assistant_message",
        payload: { content: [{ kind: "text", text: "something happened" }] },
      },
    ]);
  });

  it("reads the SDK `tool` field before legacy aliases", () => {
    expect(museToolNameFromItem({ tool: "bash", name: "wrong" })).toBe("bash");
    expect(museToolNameFromItem({ toolName: "read" })).toBe("read");
  });

  it("maps SDK toolCall.tool (not toolName) and streams output", () => {
    const started = mapMuseItemStarted("t1", {
      itemId: "c1",
      kind: "toolCall",
      toolName: "bash",
      args: '{"cmd":"ls"}',
    });
    expect(started).toMatchObject([
      {
        type: "item.started",
        itemType: "tool_call",
        payload: { name: "bash", kind: "execute", args: { cmd: "ls" }, status: "running" },
      },
    ]);
    expect(mapMuseItemDelta("t1", { itemId: "c1", field: "output", delta: "a.txt\n" }, "toolCall")).toEqual(
      {
        type: "item.updated",
        threadId: "t1",
        itemId: "c1",
        payload: { result: "a.txt\n", status: "running" },
      },
    );
    expect(
      mapMuseItemCompleted("t1", {
        itemId: "c1",
        kind: "toolCall",
        toolName: "bash",
        visibleOutput: "a.txt",
      }),
    ).toMatchObject([
      {
        type: "item.updated",
        payload: { name: "bash", result: "a.txt", status: "completed" },
      },
      { type: "item.completed", itemId: "c1" },
    ]);
  });

  it("classifies MCP tool names onto serverId without treating them as shell", () => {
    expect(museMcpServerId("mcp__craftstation__read_thread")).toBe("craftstation");
    expect(museToolKind("mcp__craftstation__read_thread")).toBe("other");
    expect(
      mapMuseItemStarted("t1", {
        itemId: "m1",
        kind: "toolCall",
        toolName: "mcp__craftstation__read_thread",
        args: { threadId: "abc" },
      }),
    ).toMatchObject([
      {
        payload: {
          name: "mcp__craftstation__read_thread",
          serverId: "craftstation",
          kind: "other",
          args: { threadId: "abc" },
        },
      },
    ]);
  });

  it("attaches file locations for edit/write tools", () => {
    expect(
      mapMuseItemStarted("t1", {
        itemId: "e1",
        kind: "toolCall",
        toolName: "write",
        args: '{"path":"src/a.ts","contents":"x"}',
      }),
    ).toMatchObject([
      {
        payload: {
          name: "write",
          kind: "edit",
          locations: [{ path: "src/a.ts" }],
        },
      },
    ]);
  });

  it("maps userShell onto command_execution and streams output", () => {
    expect(
      mapMuseItemStarted("t1", {
        itemId: "s1",
        kind: "userShell",
        commandText: "ls",
      }),
    ).toEqual([
      {
        type: "item.started",
        threadId: "t1",
        itemId: "s1",
        itemType: "command_execution",
        payload: { command: "ls", status: "running" },
      },
    ]);
    expect(mapMuseItemDelta("t1", { itemId: "s1", field: "output", delta: "a.txt\n" }, "userShell")).toEqual(
      {
        type: "content.delta",
        threadId: "t1",
        itemId: "s1",
        stream: "command_output",
        delta: "a.txt\n",
      },
    );
  });

  it("maps subagent items including result envelope and child session id", () => {
    expect(
      mapMuseItemStarted("t1", {
        itemId: "g1",
        kind: "subagent",
        role: "explore",
        objective: "find the bug",
        subagentId: "child-1",
        childSessionId: "sess-child",
      }),
    ).toMatchObject([
      {
        type: "item.started",
        itemType: "tool_call",
        payload: {
          isSubAgent: true,
          args: {
            subagent_type: "explore",
            description: "find the bug",
            subagent_id: "child-1",
            child_session_id: "sess-child",
          },
          status: "running",
        },
      },
    ]);
    expect(
      mapMuseItemCompleted("t1", {
        itemId: "g1",
        kind: "subagent",
        objective: "find the bug",
        result: { summary: "bug is in mapper", artifactRefs: [], evidenceRefs: [] },
        status: "completed",
      }),
    ).toMatchObject([
      { payload: { isSubAgent: true, result: "bug is in mapper", status: "completed" } },
      { type: "item.completed", itemId: "g1" },
    ]);
  });

  it("maps reasoning summary.* deltas onto the reasoning stream", () => {
    expect(
      mapMuseItemDelta("t1", { itemId: "r1", field: "summary.0", delta: "step 1" }, "reasoning"),
    ).toEqual({
      type: "content.delta",
      threadId: "t1",
      itemId: "r1",
      stream: "reasoning_text",
      delta: "step 1",
    });
  });

  it("keeps summary.* reasoning deltas even before the item kind is known", () => {
    expect(
      mapMuseItemDelta("t1", { itemId: "r1", field: "summary.0", delta: "planning" }, undefined),
    ).toEqual({
      type: "content.delta",
      threadId: "t1",
      itemId: "r1",
      stream: "reasoning_text",
      delta: "planning",
    });
  });

  it("seeds reasoning_text from a snapshot so empty completed thoughts are not dropped", () => {
    expect(
      mapMuseItemStarted("t1", {
        itemId: "r1",
        kind: "reasoning",
        text: "consider the tradeoffs",
      }),
    ).toEqual([
      {
        type: "item.started",
        threadId: "t1",
        itemId: "r1",
        itemType: "reasoning",
        payload: { content: [{ kind: "text", text: "consider the tradeoffs" }] },
      },
      {
        type: "content.delta",
        threadId: "t1",
        itemId: "r1",
        stream: "reasoning_text",
        delta: "consider the tradeoffs",
      },
    ]);
  });

  it("does not treat output deltas as tools before the item kind is known", () => {
    expect(
      mapMuseItemDelta("t1", { itemId: "c1", field: "output", delta: "partial" }, undefined),
    ).toBeUndefined();
  });

  it("hides noop compaction and only surfaces a real compact", () => {
    expect(
      shouldShowMuseCompaction({
        itemId: "k1",
        kind: "compaction",
        outcome: "noop",
        reason: "no_compactable_history",
      }),
    ).toBe(false);
    expect(mapMuseItemStarted("t1", { itemId: "k1", kind: "compaction" })).toEqual([]);
    expect(
      mapMuseItemCompleted("t1", {
        itemId: "k1",
        kind: "compaction",
        outcome: "noop",
        reason: "no_compactable_history",
      }),
    ).toEqual([]);
    expect(
      mapMuseItemCompleted("t1", {
        itemId: "k2",
        kind: "compaction",
        outcome: "compacted",
        trigger: "auto",
        tokensBefore: 80_000,
        tokensAfter: 12_000,
      }),
    ).toEqual([
      {
        type: "item.started",
        threadId: "t1",
        itemId: "k2",
        itemType: "tool_call",
        payload: {
          name: "ContextCompaction",
          status: "running",
          args: { trigger: "auto", pre_tokens: 80_000, post_tokens: 12_000 },
        },
      },
      {
        type: "item.completed",
        threadId: "t1",
        itemId: "k2",
        payload: {
          name: "ContextCompaction",
          status: "success",
          args: { trigger: "auto", pre_tokens: 80_000, post_tokens: 12_000 },
        },
      },
    ]);
  });

  it("recognizes /compact as the MSP compact gesture", () => {
    expect(isMuseCompactPrompt("/compact")).toBe(true);
    expect(isMuseCompactPrompt("  /compaction please")).toBe(true);
    expect(isMuseCompactPrompt("please /compact")).toBe(false);
  });

  it("maps session todos onto the plan dock", () => {
    const opened = mapMuseTodoList(
      "t1",
      [
        { text: "probe tools", status: "inProgress" },
        { text: "probe mcp", status: "pending" },
      ],
      undefined,
    );
    expect(opened.events).toEqual([
      {
        type: "item.started",
        threadId: "t1",
        itemId: expect.stringMatching(/^muse-plan-t1-/),
        itemType: "plan",
        payload: {
          steps: [
            { step: "probe tools", status: "in_progress" },
            { step: "probe mcp", status: "pending" },
          ],
        },
      },
    ]);
    const finished = mapMuseTodoList(
      "t1",
      [
        { text: "probe tools", status: "completed" },
        { text: "probe mcp", status: "completed" },
      ],
      opened.planItemId,
    );
    expect(finished.events).toEqual([
      expect.objectContaining({ type: "item.updated" }),
      expect.objectContaining({ type: "item.completed" }),
    ]);
    expect(finished.planItemId).toBeUndefined();
  });

  it("closes the open plan item at the turn boundary with the last reported steps", () => {
    expect(
      closeMusePlanItem("t1", "muse-plan-t1-1", [
        { text: "probe tools", status: "completed" },
        { text: "probe mcp", status: "inProgress" },
      ]),
    ).toEqual([
      {
        type: "item.completed",
        threadId: "t1",
        itemId: "muse-plan-t1-1",
        payload: {
          steps: [
            { step: "probe tools", status: "completed" },
            { step: "probe mcp", status: "in_progress" },
          ],
        },
      },
    ]);
  });

  it("gives each plan instance a unique item id so a closed plan is never reopened", () => {
    const first = mapMuseTodoList("t1", [{ text: "step a" }], undefined);
    const second = mapMuseTodoList("t1", [{ text: "step a" }], undefined);
    const firstId = first.events[0]?.type === "item.started" ? first.events[0].itemId : "";
    const secondId = second.events[0]?.type === "item.started" ? second.events[0].itemId : "";
    expect(firstId).toMatch(/^muse-plan-t1-/);
    expect(secondId).toMatch(/^muse-plan-t1-/);
    expect(secondId).not.toBe(firstId);
  });

  it("maps session goal changes onto the goal dock", () => {
    const set = mapMuseGoal("t1", { objective: "Ship Muse mapping", status: "active" }, undefined);
    expect(set.events).toMatchObject([
      {
        type: "item.started",
        itemType: "goal",
        payload: { action: "set", objective: "Ship Muse mapping", status: "active" },
      },
    ]);
    const cleared = mapMuseGoal("t1", null, set.goalItemId);
    expect(cleared.events).toMatchObject([{ payload: { action: "cleared" } }]);
  });

  it("maps session context usage onto the occupancy event", () => {
    expect(
      mapMuseContextUsage("t1", {
        usedTokens: 12_000,
        windowTokens: 1_000_000,
        promptTokens: 10_000,
      }),
    ).toMatchObject({
      type: "context.updated",
      threadId: "t1",
      usage: {
        usedTokens: 12_000,
        maxTokens: 1_000_000,
        breakdown: [{ id: "input", label: "Input", tokens: 10_000 }],
      },
    });
  });
});

describe("muse MSP protocol probe (SDK-shaped fixtures)", () => {
  it("covers every v1 item kind without leaking protocol labels", () => {
    const kinds = [
      "userMessage",
      "agentMessage",
      "reasoning",
      "toolCall",
      "userShell",
      "subagent",
      "workflow",
      "reminderChild",
      "compaction",
    ] as const;
    const leaked: string[] = [];
    for (const kind of kinds) {
      const started = mapMuseItemStarted("probe", {
        itemId: kind,
        kind,
        ...(kind === "toolCall" ? { toolName: "read" } : {}),
        ...(kind === "userShell" ? { commandText: "pwd" } : {}),
        ...(kind === "subagent" ? { objective: "explore" } : {}),
        ...(kind === "compaction" ? { outcome: "noop", reason: "no_compactable_history" } : {}),
      });
      const completed = mapMuseItemCompleted("probe", {
        itemId: kind,
        kind,
        ...(kind === "compaction" ? { outcome: "noop", reason: "no_compactable_history" } : {}),
      });
      const text = JSON.stringify([started, completed]);
      if (text.includes(`"text":"${kind}"`) || text.includes(`"content":[{"kind":"text","text":"${kind}"}]`)) {
        leaked.push(kind);
      }
    }
    expect(leaked).toEqual([]);
  });
});
