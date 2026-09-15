import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "@/shared/contracts";

/**
 * Send-while-running contract: on GUI threads a submit during a running turn
 * must queue a follow-up even when the thread has no `sessionRef` (fresh
 * crafted sessions never publish one). It must never be silently dropped.
 */

vi.mock("@/renderer/actions/threadRuntimeActions", () => ({
  changeThreadConfig: vi.fn<() => void>(),
  resolveThreadServerRequest: vi.fn<() => Promise<void>>(),
  setThreadPendingSteer: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  submitThreadInput: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock("@/renderer/actions/queuedFollowUpActions", () => ({
  enqueueThreadFollowUp: vi.fn<() => void>(),
}));

vi.mock("@/renderer/actions/threadActions", () => ({
  setThreadGoalPrompt: vi.fn<() => { ok: true }>().mockReturnValue({ ok: true }),
  registerNativeGoal: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
}));

vi.mock("@/renderer/analytics/posthog", () => ({
  captureThreadPromptSubmitted: vi.fn<() => void>(),
  captureProductEvent: vi.fn<() => void>(),
}));

vi.mock("@/renderer/state/appStore", () => ({
  useAppStore: {
    getState: vi.fn<() => { threads: unknown[]; requestChatScrollToBottom: () => void }>(() => ({
      threads: [],
      requestChatScrollToBottom: vi.fn<() => void>(),
    })),
  },
}));

vi.mock("@/renderer/state/browserAttachInbox", () => ({
  buildLcSelectorFence: vi.fn<(input: { selector: string; sourceUrl: string }) => string>(
    (input) => input.selector,
  ),
  buildSelectorPlainText: vi.fn<(input: { selector: string }) => string>((input) => input.selector),
}));

vi.mock("@/renderer/state/runtimeRequestActions", () => ({
  applyOptimisticRequestResolution: vi.fn<() => void>(),
}));

vi.mock("@/heroui/react", () => ({
  toast: { danger: vi.fn<() => void>() },
}));

function workingGuiThread(): Thread {
  return {
    id: "thread-steer",
    projectId: "project-1",
    agentKind: "codex",
    // The regression: no sessionRef on a running GUI thread must NOT block send.
    title: "Thread",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    status: "working",
    config: { model: "gpt-5.3-codex" },
    presentationMode: "gui",
  } as unknown as Thread;
}

import { submitComposerPrompt } from "./threadComposerSubmit";
import { enqueueThreadFollowUp } from "@/renderer/actions/queuedFollowUpActions";
import { setThreadPendingSteer, submitThreadInput } from "@/renderer/actions/threadRuntimeActions";
import { registerNativeGoal, setThreadGoalPrompt } from "@/renderer/actions/threadActions";
import { useAppStore } from "@/renderer/state/appStore";

function makeCtx(
  thread: Thread,
  overrides: Partial<Parameters<typeof submitComposerPrompt>[1]> = {},
) {
  return {
    thread,
    agentStatus: undefined,
    presentationMode: "gui" as const,
    attachments: {
      attachments: [],
      addFiles: vi.fn<() => void>(),
      addClipboardImage: vi.fn<() => Promise<void>>(),
      addPicked: vi.fn<() => void>(),
      removeAttachment: vi.fn<() => void>(),
      clearAll: vi.fn<() => void>(),
      toSegments: () => [],
      restore: vi.fn<() => void>(),
    } as unknown as ReturnType<typeof import("../composer/useAttachments").useAttachments>,
    mentionRef: { current: null },
    terminalPaneRef: { current: null },
    usesTerminalPresentation: false,
    canSubmit: true,
    usesPendingSteerPath: true,
    needsFocusBeforeInput: false,
    activeRuntimeRequest: undefined,
    approvalDenyOption: undefined,
    isSubmitting: false,
    latestSegmentsRef: { current: [] },
    submittedRef: { current: false },
    availableCommands: [],
    hasContent: true,
    errorDockStates: [],
    isCurrentSession: () => true,
    setPrompt: vi.fn<() => void>(),
    setHasContent: vi.fn<() => void>(),
    setIsSubmitting: vi.fn<() => void>(),
    requestOpenControl: vi.fn<() => void>(),
    ...overrides,
  };
}

describe("submitComposerPrompt steer routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queues a send on a running GUI thread without a sessionRef", async () => {
    const thread = workingGuiThread();
    const ctx = makeCtx(thread);
    // The GUI derivation after the fix: a working turn keeps canSubmit true.
    expect(ctx.canSubmit).toBe(true);

    submitComposerPrompt([{ kind: "text", content: "keep going" }], ctx);

    await vi.waitFor(() => {
      expect(enqueueThreadFollowUp).toHaveBeenCalledWith("thread-steer", "keep going", [
        { kind: "text", content: "keep going" },
      ]);
    });
    expect(submitThreadInput).not.toHaveBeenCalled();
    expect(setThreadPendingSteer).not.toHaveBeenCalled();
  });

  it("routes a normal submit (idle thread) to submitThreadInput", async () => {
    const thread = { ...workingGuiThread(), status: "idle" } as Thread;
    const ctx = makeCtx(thread, { usesPendingSteerPath: false });
    submitComposerPrompt([{ kind: "text", content: "hello" }], ctx);
    await vi.waitFor(() => {
      expect(submitThreadInput).toHaveBeenCalledWith(
        "thread-steer",
        "hello",
        [{ kind: "text", content: "hello" }],
        undefined,
      );
    });
  });

  it("swallows /goal submits: binds the goal, clears the composer, sends nothing", () => {
    const thread = { ...workingGuiThread(), agentKind: "kimi", status: "idle" } as Thread;
    const ctx = makeCtx(thread, { usesPendingSteerPath: false });
    submitComposerPrompt([{ kind: "text", content: "/goal fix auth" }], ctx);
    expect(setThreadGoalPrompt).toHaveBeenCalledWith("thread-steer", "fix auth");
    expect(submitThreadInput).not.toHaveBeenCalled();
    expect(setThreadPendingSteer).not.toHaveBeenCalled();
    expect(ctx.setPrompt).toHaveBeenCalledWith("");
  });

  it("carries the fallback goalContext beside the raw prompt for non-codex", async () => {
    const goal = { prompt: "fix auth", createdAt: "t", updatedAt: "t" };
    const thread = { ...workingGuiThread(), agentKind: "kimi", status: "idle", goal } as Thread;
    vi.mocked(useAppStore.getState).mockReturnValue({
      threads: [thread],
      requestChatScrollToBottom: vi.fn<() => void>(),
    } as never);
    const ctx = makeCtx(thread, { usesPendingSteerPath: false });
    submitComposerPrompt([{ kind: "text", content: "hello" }], ctx);
    await vi.waitFor(() => {
      expect(submitThreadInput).toHaveBeenCalledWith(
        "thread-steer",
        "hello",
        [{ kind: "text", content: "hello" }],
        { goalContext: expect.stringContaining("fix auth") },
      );
    });
    // The painted/sent prompt stays raw: the goal rides the side channel.
    const sentPrompt = vi.mocked(submitThreadInput).mock.calls[0]?.[1];
    expect(sentPrompt).toBe("hello");
    expect(registerNativeGoal).not.toHaveBeenCalled();
  });

  it("swallows a Grok skill-catalog dump and sends nothing", () => {
    const thread = { ...workingGuiThread(), agentKind: "grok", status: "idle" } as Thread;
    const ctx = makeCtx(thread, { usesPendingSteerPath: false });
    const chips = [
      "skill-creator-craftstation",
      "ask-matt",
      "ast-grep",
      "code-review",
      "diagnosing-bugs",
      "my-workflow",
      "my-research",
      "prototype",
    ].map((name) => ({
      kind: "skill" as const,
      name,
      path: `/skills/${name}/SKILL.md`,
      invocation: `/${name}`,
      provider: "Grok",
      scope: "global" as const,
    }));
    submitComposerPrompt(chips, ctx);
    expect(submitThreadInput).not.toHaveBeenCalled();
    expect(enqueueThreadFollowUp).not.toHaveBeenCalled();
    expect(ctx.setPrompt).toHaveBeenCalledWith("");
  });

  it("registers native goal without text injection for codex", async () => {
    const goal = { prompt: "fix auth", createdAt: "t", updatedAt: "t" };
    const thread = { ...workingGuiThread(), agentKind: "codex", status: "idle", goal } as Thread;
    vi.mocked(useAppStore.getState).mockReturnValue({
      threads: [thread],
      requestChatScrollToBottom: vi.fn<() => void>(),
    } as never);
    const ctx = makeCtx(thread, { usesPendingSteerPath: false });
    submitComposerPrompt([{ kind: "text", content: "hello" }], ctx);
    await vi.waitFor(() => {
      expect(registerNativeGoal).toHaveBeenCalledWith("thread-steer", "fix auth");
      expect(submitThreadInput).toHaveBeenCalledWith(
        "thread-steer",
        "hello",
        [{ kind: "text", content: "hello" }],
        undefined,
      );
    });
  });
});
