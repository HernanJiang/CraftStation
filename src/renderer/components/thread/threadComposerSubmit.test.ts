import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "@/shared/contracts";

/**
 * Send-while-running contract: on GUI threads a submit during a running turn
 * must route through the pending-steer path even when the thread has no
 * `sessionRef` (fresh crafted sessions never publish one). It must never be
 * silently dropped.
 */

vi.mock("@/renderer/actions/threadRuntimeActions", () => ({
  changeThreadConfig: vi.fn<() => void>(),
  resolveThreadServerRequest: vi.fn<() => Promise<void>>(),
  setThreadPendingSteer: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  submitThreadInput: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
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
import { setThreadPendingSteer, submitThreadInput } from "@/renderer/actions/threadRuntimeActions";

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

  it("routes a send on a running GUI thread through pending steer without a sessionRef", async () => {
    const thread = workingGuiThread();
    const ctx = makeCtx(thread);
    // The GUI derivation after the fix: a working turn keeps canSubmit true.
    expect(ctx.canSubmit).toBe(true);

    submitComposerPrompt([{ kind: "text", content: "keep going" }], ctx);

    await vi.waitFor(() => {
      expect(setThreadPendingSteer).toHaveBeenCalledWith(thread, "keep going", [
        { kind: "text", content: "keep going" },
      ]);
    });
    expect(submitThreadInput).not.toHaveBeenCalled();
  });

  it("routes a normal submit (idle thread) to submitThreadInput", async () => {
    const thread = { ...workingGuiThread(), status: "idle" } as Thread;
    const ctx = makeCtx(thread, { usesPendingSteerPath: false });
    submitComposerPrompt([{ kind: "text", content: "hello" }], ctx);
    await vi.waitFor(() => {
      expect(submitThreadInput).toHaveBeenCalledWith("thread-steer", "hello", [
        { kind: "text", content: "hello" },
      ]);
    });
  });
});
