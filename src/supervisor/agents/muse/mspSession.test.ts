// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@/shared/contracts";
import { museDefaultCapabilities } from "./detection";
import {
  MuseMspSession,
  buildMuseMspStartOptions,
  museMspApprovalMode,
  museMspSetApprovalModeParams,
  resolveMuseMspApprovalChoice,
} from "./mspSession";

interface HarnessedSession {
  input: { threadId: string };
  session: {
    fold: {
      sessionState: {
        get: (key: string) => { items?: unknown } | undefined;
      };
    };
  };
  listener: { onUpdate: () => void };
  planItemId: string | undefined;
  lastTodoSignature: string | undefined;
  currentTurnId: string | undefined;
  emit: (event: RuntimeEvent) => void;
  finishTurn: (state: "completed" | "failed" | "cancelled") => void;
}

function harness(todoItems: unknown[]): { session: HarnessedSession; events: RuntimeEvent[] } {
  const events: RuntimeEvent[] = [];
  const session = Object.create(MuseMspSession.prototype) as HarnessedSession;
  session.input = { threadId: "t1" };
  session.session = {
    fold: {
      sessionState: {
        get: () => ({ items: todoItems }),
      },
    },
  };
  session.listener = { onUpdate: () => {} };
  session.planItemId = undefined;
  session.lastTodoSignature = undefined;
  session.currentTurnId = "turn-1";
  session.emit = (event) => events.push(event);
  return { session, events };
}

describe("MuseMspSession finishTurn plan close", () => {
  it("closes the open plan item with the last todo steps before turn.completed", () => {
    const { session, events } = harness([
      { text: "probe tools", status: "completed" },
      { text: "probe mcp", status: "inProgress" },
    ]);
    session.planItemId = "muse-plan-t1-1";
    session.lastTodoSignature = "stale-signature";

    session.finishTurn("completed");

    expect(events).toEqual([
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
      { type: "turn.completed", threadId: "t1", turnId: "turn-1", state: "completed" },
    ]);
    expect(session.planItemId).toBeUndefined();
    // The next turn must re-publish the todo list as a fresh plan item.
    expect(session.lastTodoSignature).toBeUndefined();
  });

  it("does not emit a plan close when no plan item is open", () => {
    const { session, events } = harness([{ text: "probe tools", status: "completed" }]);
    session.planItemId = undefined;

    session.finishTurn("completed");

    expect(events).toEqual([
      { type: "turn.completed", threadId: "t1", turnId: "turn-1", state: "completed" },
    ]);
  });
});

describe("MuseMspSession applyDelta reasoning", () => {
  it("opens a reasoning item when summary deltas arrive before item.started", () => {
    const events: RuntimeEvent[] = [];
    const session = Object.create(MuseMspSession.prototype) as {
      input: { threadId: string };
      itemKinds: Map<string, string>;
      seenItems: Set<string>;
      emit: (event: RuntimeEvent) => void;
      applyDelta: (delta: { itemId: string; field?: string; delta: string }) => void;
    };
    session.input = { threadId: "t1" };
    session.itemKinds = new Map();
    session.seenItems = new Set();
    session.emit = (event) => events.push(event);
    session.applyDelta({ itemId: "r1", field: "summary.0", delta: "plan the edit" });
    expect(events).toEqual([
      expect.objectContaining({ type: "item.started", itemId: "r1", itemType: "reasoning" }),
      expect.objectContaining({
        type: "content.delta",
        itemId: "r1",
        stream: "reasoning_text",
        delta: "plan the edit",
      }),
    ]);
  });
});

describe("Muse MSP yolo approval policy", () => {
  const yoloChoices = [
    { choiceId: "once", decision: "approved" },
    { choiceId: "always", decision: "approvedForSession" },
    { choiceId: "deny", decision: "denied" },
  ];
  const cfg = (approvalPolicy: string) => ({
    model: "muse-spark-1.2",
    approvalPolicy,
  });

  it("maps yolo (including the Muse default) to MSP allowAll", () => {
    expect(museDefaultCapabilities.defaultApprovalPolicy).toBe("yolo");
    expect(museMspApprovalMode(cfg("yolo"))).toBe("allowAll");
    expect(museMspApprovalMode(cfg(museDefaultCapabilities.defaultApprovalPolicy!))).toBe(
      "allowAll",
    );
    expect(museMspApprovalMode(cfg("bypassPermissions"))).toBe("allowAll");
    expect(museMspApprovalMode(cfg("on-request"))).toBe("onRequest");
    expect(museMspApprovalMode(cfg("untrusted"))).toBe("promptUnmatched");
  });

  it("stamps session/start with approvalMode allowAll for yolo", () => {
    expect(
      buildMuseMspStartOptions("/tmp/repo", {
        model: "muse-spark-1.2",
        approvalPolicy: museDefaultCapabilities.defaultApprovalPolicy,
      }),
    ).toEqual({
      workspaceRoot: "/tmp/repo",
      modelId: "muse-spark-1.2",
      approvalMode: "allowAll",
    });
  });

  it("does not stamp allowAll when the thread is on-request", () => {
    expect(
      buildMuseMspStartOptions("/tmp/repo", {
        model: "muse-spark-1.2",
        approvalPolicy: "on-request",
      }),
    ).toEqual({
      workspaceRoot: "/tmp/repo",
      modelId: "muse-spark-1.2",
    });
  });

  it("resume reapplies yolo via session/setApprovalMode (resume has no approvalMode field)", () => {
    expect(
      museMspSetApprovalModeParams("966713f1-794f-480e-aa37-713e8387fe8e", cfg("yolo")),
    ).toEqual({
      sessionId: "966713f1-794f-480e-aa37-713e8387fe8e",
      mode: "allowAll",
    });
    expect(museMspSetApprovalModeParams("sess", cfg("on-request"))).toEqual({
      sessionId: "sess",
      mode: "onRequest",
    });
  });

  it("auto-resolves tool approval when the thread is on yolo", () => {
    expect(resolveMuseMspApprovalChoice(cfg("yolo"), yoloChoices)).toBe("always");
    expect(resolveMuseMspApprovalChoice(cfg("on-request"), yoloChoices)).toBeUndefined();
  });
});
