// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import type { AppStoreState } from "@/renderer/state/slices/shared";
import {
  getThreadErrorDockStateForItem,
  isAuthErrorMessage,
  resolveThreadAuthState,
  selectThreadErrorDockStates,
} from "./threadErrorState";

function errorItem(id: string, message: string): RuntimeChatItem {
  return {
    id,
    type: "error",
    state: "completed",
    payload: { message },
    streams: {},
  };
}

function assistantItem(id: string, text: string): RuntimeChatItem {
  return {
    id,
    type: "assistant_message",
    state: "completed",
    payload: { content: [{ kind: "text", text }] },
    streams: {},
  };
}

describe("threadErrorState", () => {
  it("suppresses abort-only composer errors", () => {
    expect(getThreadErrorDockStateForItem(errorItem("err-1", "Aborted"))).toBeNull();
    expect(getThreadErrorDockStateForItem(errorItem("err-2", "AbortError: aborted"))).toBeNull();
  });

  it("suppresses Gemini capacity retries that later succeed", () => {
    expect(
      getThreadErrorDockStateForItem(
        errorItem(
          "err-503",
          "API error (attempt 2) UNAVAILABLE (code 503): No capacity available for model gemini-3.8-flash-high on the server",
        ),
      ),
    ).toBeNull();
    expect(
      getThreadErrorDockStateForItem(
        errorItem(
          "err-503-attempt-1",
          "API error (attempt 1): UNAVAILABLE (code 503): No capacity available for model gemini-3.8-flash-high on the server",
        ),
      ),
    ).toBeNull();
  });

  it("keeps non-abort composer errors", () => {
    expect(
      getThreadErrorDockStateForItem(errorItem("err-1", "Network error: request failed")),
    ).toEqual({
      sourceItemId: "err-1",
      message: "Network error: request failed",
    });
  });

  it("returns a stable empty array when there are no errors", () => {
    const state = {
      runtimeItemIdsByThread: { "t-1": ["user-1"] },
      runtimeItemsByIdByThread: {
        "t-1": {
          "user-1": {
            id: "user-1",
            type: "user_message",
            state: "completed",
            payload: {},
            streams: {},
          },
        },
      },
    } as unknown as AppStoreState;
    expect(selectThreadErrorDockStates(state, "t-1")).toBe(
      selectThreadErrorDockStates(state, "t-1"),
    );
  });

  it("returns all errors since the latest user message in order", () => {
    const state = {
      runtimeItemIdsByThread: {
        "t-1": ["user-1", "err-a", "err-b"],
      },
      runtimeItemsByIdByThread: {
        "t-1": {
          "user-1": {
            id: "user-1",
            type: "user_message",
            state: "completed",
            payload: {},
            streams: {},
          },
          "err-a": errorItem("err-a", "Usage limit reached."),
          "err-b": errorItem("err-b", "Internal error"),
        },
      },
    } as unknown as AppStoreState;
    expect(selectThreadErrorDockStates(state, "t-1")).toEqual([
      { sourceItemId: "err-a", message: "Usage limit reached." },
      { sourceItemId: "err-b", message: "Internal error" },
    ]);
  });

  it("collapses consecutive identical errors into one dock row", () => {
    const state = {
      runtimeItemIdsByThread: {
        "t-1": ["user-1", "err-1", "err-2", "err-3", "err-4"],
      },
      runtimeItemsByIdByThread: {
        "t-1": {
          "user-1": {
            id: "user-1",
            type: "user_message",
            state: "completed",
            payload: {},
            streams: {},
          },
          "err-1": errorItem("err-1", "Grok 额度已耗尽"),
          "err-2": errorItem("err-2", "Grok 额度已耗尽"),
          "err-3": errorItem("err-3", "Something else broke"),
          "err-4": errorItem("err-4", "Grok 额度已耗尽"),
        },
      },
    } as unknown as AppStoreState;
    // Newest occurrence wins per message; distinct messages still all show.
    expect(selectThreadErrorDockStates(state, "t-1")).toEqual([
      { sourceItemId: "err-2", message: "Grok 额度已耗尽" },
      { sourceItemId: "err-3", message: "Something else broke" },
      { sourceItemId: "err-4", message: "Grok 额度已耗尽" },
    ]);
  });

  it("drops errors superseded by a follow-up answer (recovered failover)", () => {
    const state = {
      runtimeItemIdsByThread: {
        "t-1": ["user-1", "err-quota", "answer-1"],
      },
      runtimeItemsByIdByThread: {
        "t-1": {
          "user-1": {
            id: "user-1",
            type: "user_message",
            state: "completed",
            payload: {},
            streams: {},
          },
          "err-quota": errorItem("err-quota", "Grok 额度已耗尽"),
          "answer-1": assistantItem("answer-1", "Here is the answer."),
        },
      },
    } as unknown as AppStoreState;
    expect(selectThreadErrorDockStates(state, "t-1")).toEqual([]);
  });

  it("keeps errors that arrive after the latest answer", () => {
    const state = {
      runtimeItemIdsByThread: {
        "t-1": ["user-1", "answer-1", "err-late"],
      },
      runtimeItemsByIdByThread: {
        "t-1": {
          "user-1": {
            id: "user-1",
            type: "user_message",
            state: "completed",
            payload: {},
            streams: {},
          },
          "answer-1": assistantItem("answer-1", "Here is the answer."),
          "err-late": errorItem("err-late", "Internal error"),
        },
      },
    } as unknown as AppStoreState;
    expect(selectThreadErrorDockStates(state, "t-1")).toEqual([
      { sourceItemId: "err-late", message: "Internal error" },
    ]);
  });

  it("ignores blank assistant rows when judging recovery", () => {
    const state = {
      runtimeItemIdsByThread: {
        "t-1": ["user-1", "err-quota", "answer-blank"],
      },
      runtimeItemsByIdByThread: {
        "t-1": {
          "user-1": {
            id: "user-1",
            type: "user_message",
            state: "completed",
            payload: {},
            streams: {},
          },
          "err-quota": errorItem("err-quota", "Grok 额度已耗尽"),
          "answer-blank": assistantItem("answer-blank", "  \n "),
        },
      },
    } as unknown as AppStoreState;
    expect(selectThreadErrorDockStates(state, "t-1")).toEqual([
      { sourceItemId: "err-quota", message: "Grok 额度已耗尽" },
    ]);
  });
});

describe("isAuthErrorMessage", () => {
  it.each([
    "Failed to authenticate. API Error: 401 Invalid authentication credentials",
    "Not logged in · Please run /login",
    "Session expired. Please run /login to sign in again.",
    "authentication_failed",
    "API Error: 401",
    "oauth_org_not_allowed",
  ])("recognizes %q as an auth error", (msg) => {
    expect(isAuthErrorMessage(msg)).toBe(true);
  });

  it.each([
    "Network error: request failed",
    "Rate limit exceeded",
    "Internal server error",
    "Claude turn failed.",
  ])("does not flag %q as an auth error", (msg) => {
    expect(isAuthErrorMessage(msg)).toBe(false);
  });
});

describe("resolveThreadAuthState", () => {
  it("requires official login when the harness has no credentials", () => {
    expect(
      resolveThreadAuthState({
        authState: "missing",
        errorDockStates: [],
      }).authRequired,
    ).toBe(true);
  });

  it("does not require official login when a catalog remap supplied the credentials", () => {
    expect(
      resolveThreadAuthState({
        authState: "missing",
        errorDockStates: [],
        sourceProviderKind: "opencode",
      }).authRequired,
    ).toBe(false);
  });

  it("does not require official login when a third-party OpenAI-compatible account is bound", () => {
    expect(
      resolveThreadAuthState({
        authState: "missing",
        errorDockStates: [],
        accountId: "openai-compatible:acct-1",
      }).authRequired,
    ).toBe(false);
  });

  it("does not demand official login when the model id names a foreign catalog channel", () => {
    // Regression: an `opencode-go/…` model on the `muse` Harness with no
    // recorded sourceProviderKind served fine through its catalog channel,
    // but the composer still demanded `muse login` and blocked submit.
    expect(
      resolveThreadAuthState({
        authState: "missing",
        errorDockStates: [],
        agentKind: "muse",
        model: "opencode-go/muse-spark-1.3-contributor",
      }).authRequired,
    ).toBe(false);
  });

  it("still demands official login for a bare native model id on its own Harness", () => {
    expect(
      resolveThreadAuthState({
        authState: "missing",
        errorDockStates: [],
        agentKind: "muse",
        model: "muse-spark-1.2",
      }).authRequired,
    ).toBe(true);
  });

  it("still demands official login when the model channel matches the Harness", () => {
    expect(
      resolveThreadAuthState({
        authState: "missing",
        errorDockStates: [],
        agentKind: "opencode",
        model: "opencode/big-pickle",
      }).authRequired,
    ).toBe(true);
  });
});
