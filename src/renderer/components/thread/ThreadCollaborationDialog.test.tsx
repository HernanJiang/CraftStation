import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadExchangeView, ThreadTargetSummary } from "@/shared/threadCollaboration";
import { renderWithI18n } from "@/renderer/testUtils/i18n";
import { ThreadCollaborationDialog } from "./ThreadCollaborationDialog";

const bridge = vi.hoisted(() => ({
  listThreadCollaborationTargets:
    vi.fn<
      (payload: { sourceThreadId: string; query?: string }) => Promise<ThreadTargetSummary[]>
    >(),
  listThreadExchanges:
    vi.fn<
      (payload: {
        actorThreadId: string;
        threadId: string;
        limit?: number;
      }) => Promise<ThreadExchangeView[]>
    >(),
  requestThreadDialogue: vi.fn<(payload: Record<string, unknown>) => Promise<unknown>>(),
  cancelThreadExchange: vi.fn<(payload: Record<string, unknown>) => Promise<unknown>>(),
}));

const openThread = vi.hoisted(() =>
  vi.fn<
    (threadId: string, options?: { focusComposer?: boolean; switchWorkspace?: boolean }) => void
  >(),
);

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => bridge,
}));

vi.mock("@/renderer/actions/threadActions", () => ({
  openThread,
}));

const SOURCE_THREAD_ID = "source-thread";

function provenance(threadId: string, modelId: string, harnessId: string) {
  return {
    threadId,
    projectId: "project-1",
    title: threadId,
    modelId,
    harnessId,
    agentMcpSupported: false,
  };
}

function target(
  threadId: string,
  overrides: Partial<ThreadTargetSummary> = {},
): ThreadTargetSummary {
  return {
    threadId,
    projectId: "project-1",
    title: threadId,
    status: "idle",
    attention: "none",
    provenance: provenance(threadId, "grok-4.6", "grok"),
    sameWorktree: true,
    available: true,
    sameComposition: false,
    ...overrides,
  };
}

function exchange(overrides: Partial<ThreadExchangeView> = {}): ThreadExchangeView {
  return {
    id: "exchange-1",
    linkId: "link-1",
    projectId: "project-1",
    sourceThreadId: SOURCE_THREAD_ID,
    targetThreadId: "target-thread",
    sequence: 1,
    deliveryMode: "after-current-turn",
    status: "queued",
    sourceProvenance: provenance(SOURCE_THREAD_ID, "gpt-5.6", "codex"),
    targetProvenance: provenance("target-thread", "grok-4.6", "grok"),
    requestItemId: "request-1",
    deliveryBaselineTurnIndex: null,
    deliveryAnchorItemId: null,
    replyTurnIndex: null,
    replyAnchorItemId: null,
    replyExcerpt: null,
    causalParentExchangeId: null,
    hopDepth: 0,
    error: null,
    createdAt: "2026-08-31T12:00:00.000Z",
    updatedAt: "2026-08-31T12:00:00.000Z",
    deliveredAt: null,
    repliedAt: null,
    ...overrides,
  };
}

function targetsFixture(): ThreadTargetSummary[] {
  return [
    target("target-thread", { title: "Grok helper" }),
    target("offline-thread", { title: "Offline helper", available: false }),
    target("twin-thread", {
      title: "Codex twin",
      provenance: provenance("twin-thread", "gpt-5.6", "codex"),
      sameComposition: true,
    }),
    target("spare-thread", { title: "Spare helper" }),
  ];
}

function renderDialog(props: Partial<Parameters<typeof ThreadCollaborationDialog>[0]> = {}) {
  return renderWithI18n(
    <ThreadCollaborationDialog
      isOpen
      sourceThreadId={SOURCE_THREAD_ID}
      onClose={props.onClose ?? vi.fn<() => void>()}
      {...(props.onChanged ? { onChanged: props.onChanged } : {})}
    />,
  );
}

async function openAndLoad() {
  const view = renderDialog();
  await waitFor(() => {
    expect(bridge.listThreadCollaborationTargets).toHaveBeenCalled();
  });
  await screen.findByRole("option", { name: "Grok helper" });
  return view;
}

describe("ThreadCollaborationDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.listThreadCollaborationTargets.mockResolvedValue(targetsFixture());
    bridge.listThreadExchanges.mockResolvedValue([]);
    bridge.requestThreadDialogue.mockResolvedValue(undefined);
    bridge.cancelThreadExchange.mockResolvedValue(undefined);
  });

  it("loads targets, keeps runtime-ready distinction honest, and disables unusable targets", async () => {
    await openAndLoad();

    expect(bridge.listThreadCollaborationTargets).toHaveBeenCalledWith({
      sourceThreadId: SOURCE_THREAD_ID,
    });
    expect(bridge.listThreadExchanges).toHaveBeenCalledWith({
      actorThreadId: SOURCE_THREAD_ID,
      threadId: SOURCE_THREAD_ID,
      limit: 30,
    });

    const selectable = screen.getByRole("option", { name: "Grok helper" });
    expect(within(selectable).getByRole("button")).toBeEnabled();

    const offline = screen.getByRole("option", { name: "Offline helper" });
    expect(within(offline).getByRole("button")).toBeDisabled();

    const twin = screen.getByRole("option", { name: "Codex twin" });
    expect(within(twin).getByRole("button")).toBeDisabled();
    expect(
      screen.getByText(
        "Same Model and Harness as this thread — not selectable for cross-thread dialogue.",
      ),
    ).toBeInTheDocument();
  });

  it("sends the trimmed search query with subsequent target loads", async () => {
    await openAndLoad();

    fireEvent.change(
      screen.getByPlaceholderText("Search title, Model, Harness, status, or worktree"),
      { target: { value: "  grok  " } },
    );

    await waitFor(() => {
      expect(bridge.listThreadCollaborationTargets).toHaveBeenCalledWith({
        sourceThreadId: SOURCE_THREAD_ID,
        query: "grok",
      });
    });
  });

  it("submits with the default after-current-turn delivery, generated idempotency key and no context", async () => {
    const onChanged = vi.fn<() => void>();
    renderDialog({ onChanged });
    await screen.findByRole("option", { name: "Grok helper" });

    fireEvent.change(screen.getByLabelText("Request"), {
      target: { value: "  Please summarize  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Queue request" }));

    await waitFor(() => {
      expect(bridge.requestThreadDialogue).toHaveBeenCalledTimes(1);
    });
    const payload = bridge.requestThreadDialogue.mock.calls[0]![0] as {
      sourceThreadId: string;
      targetThreadId: string;
      request: string;
      deliveryMode: string;
      idempotencyKey: string;
      context?: unknown;
      hopDepth: number;
    };
    expect(payload).toMatchObject({
      sourceThreadId: SOURCE_THREAD_ID,
      targetThreadId: "target-thread",
      request: "Please summarize",
      deliveryMode: "after-current-turn",
      hopDepth: 0,
    });
    expect(payload.context).toBeUndefined();
    expect(payload.idempotencyKey.startsWith(`renderer:${SOURCE_THREAD_ID}:`)).toBe(true);

    // The parent is notified after a successful submit.
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled();
    });
  });

  it("sends explicit context only when the context toggle is enabled", async () => {
    await openAndLoad();

    fireEvent.change(screen.getByLabelText("Request"), { target: { value: "Need help" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("Context summary"), {
      target: { value: "shared summary" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Queue request" }));

    await waitFor(() => {
      expect(bridge.requestThreadDialogue).toHaveBeenCalledTimes(1);
    });
    const payload = bridge.requestThreadDialogue.mock.calls[0]![0] as { context?: unknown };
    expect(payload.context).toEqual({ summary: "shared summary" });
  });

  it("requires a two-step confirm for interrupt-and-send and resets it on target change", async () => {
    await openAndLoad();

    fireEvent.change(screen.getByLabelText("Request"), { target: { value: "urgent" } });
    fireEvent.click(screen.getByLabelText("Interrupt the target, then send"));

    // First press only arms the confirmation.
    fireEvent.click(screen.getByRole("button", { name: "Review interrupt" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Confirm again to interrupt/);
    expect(bridge.requestThreadDialogue).not.toHaveBeenCalled();

    // Changing the target disarms the confirmation.
    fireEvent.click(
      within(screen.getByRole("option", { name: "Spare helper" })).getByRole("button"),
    );
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
    const reviewButton = screen.getByRole("button", { name: "Review interrupt" });
    expect(reviewButton).toBeEnabled();

    // Re-arm and confirm to deliver with the interrupt handshake.
    fireEvent.click(reviewButton);
    fireEvent.click(screen.getByRole("button", { name: "Confirm interrupt and send" }));

    await waitFor(() => {
      expect(bridge.requestThreadDialogue).toHaveBeenCalledTimes(1);
    });
    const payload = bridge.requestThreadDialogue.mock.calls[0]![0] as {
      deliveryMode: string;
      targetThreadId: string;
    };
    expect(payload.deliveryMode).toBe("interrupt-and-send");
    expect(payload.targetThreadId).toBe("spare-thread");
  });

  it("surfaces submit errors in the dialog", async () => {
    bridge.requestThreadDialogue.mockRejectedValueOnce(
      new Error("THREAD_COLLABORATION_SAME_COMPOSITION: identical composition"),
    );
    await openAndLoad();

    fireEvent.change(screen.getByLabelText("Request"), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Queue request" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "THREAD_COLLABORATION_SAME_COMPOSITION: identical composition",
      );
    });
  });

  it("cancels a queued outbound exchange and shows status, reply excerpt, errors and jump", async () => {
    bridge.listThreadExchanges.mockResolvedValue([
      exchange(),
      exchange({
        id: "exchange-2",
        status: "replied",
        replyExcerpt: "the answer is 42",
        deliveredAt: "2026-08-31T12:00:01.000Z",
        repliedAt: "2026-08-31T12:00:05.000Z",
      }),
      exchange({
        id: "exchange-3",
        targetThreadId: "broken-thread",
        targetProvenance: provenance("broken-thread", "gpt-5.6", "codex"),
        status: "failed",
        error: {
          code: "THREAD_COLLABORATION_INTERRUPT_FAILED",
          message: "Interrupt was not confirmed.",
          retryable: false,
        },
      }),
    ]);
    await openAndLoad();

    // Status, reply excerpt and projected error text are visible per card.
    expect(screen.getByText("Replied")).toBeInTheDocument();
    expect(screen.getByText("the answer is 42")).toBeInTheDocument();
    expect(screen.getByText(/THREAD_COLLABORATION_INTERRUPT_FAILED/)).toBeInTheDocument();

    // Only the source can cancel, and only before the exchange settles.
    fireEvent.click(screen.getByRole("button", { name: "Cancel queued request" }));
    await waitFor(() => {
      expect(bridge.cancelThreadExchange).toHaveBeenCalledWith({
        actorThreadId: SOURCE_THREAD_ID,
        exchangeId: "exchange-1",
      });
    });

    // Jump opens the counterpart thread and closes the dialog.
    fireEvent.click(screen.getAllByRole("button", { name: "Open target-thread" })[0]!);
    expect(openThread).toHaveBeenCalledWith("target-thread", {
      focusComposer: false,
      switchWorkspace: true,
    });
  });

  it("stops polling exchanges after unmount", async () => {
    const intervalSpy = vi.spyOn(window, "setInterval");
    const clearSpy = vi.spyOn(window, "clearInterval");
    const view = await openAndLoad();
    const pollInterval = intervalSpy.mock.results[0]!.value;

    view.unmount();
    expect(clearSpy).toHaveBeenCalledWith(pollInterval);
    intervalSpy.mockRestore();
    clearSpy.mockRestore();
  });
});
