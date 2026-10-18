import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { ThreadHeaderStatusButton } from "./ThreadHeaderStatus";

vi.mock("@heroui/react", () => ({
  Tooltip: Object.assign((props: { children: ReactNode }) => <>{props.children}</>, {
    Trigger: (props: { children: ReactNode }) => <>{props.children}</>,
    Content: (props: { children: ReactNode }) => <>{props.children}</>,
  }),
}));

vi.mock("@/renderer/components/providers/ProviderIcon", () => ({
  ProviderIcon: (props: { tone: string }) => (
    <span data-testid="provider-status" data-tone={props.tone} />
  ),
}));

vi.mock("@/renderer/state/useThread", () => ({
  useThread: () => undefined,
}));

function makeThread(status: "idle" | "finished"): Thread {
  return {
    id: "thread-1",
    projectId: "project-1",
    title: "Thread 1",
    agentKind: "claude",
    config: { model: "claude-sonnet-4-5" },
    status,
    attention: "none",
    canResumeWithConfig: false,
    archived: false,
    done: false,
    starred: false,
    createdAt: "2026-03-21T10:00:00.000Z",
    updatedAt: "2026-03-21T10:00:00.000Z",
  };
}

describe("ThreadHeaderStatusButton", () => {
  beforeEach(() => {
    useAppStore.setState({ connectingThreadIds: {} });
  });

  it("shows a settled idle thread as idle", () => {
    const thread = makeThread("idle");

    const { getByRole, getByTestId } = render(
      <ThreadHeaderStatusButton
        threadId={thread.id}
        fallbackThread={thread}
        fallbackAgentKind="claude"
        agentLabel="Claude"
      />,
    );

    expect(
      getByRole("button", { name: "Claude: Idle. Hover for status details." }),
    ).toBeInTheDocument();
    expect(getByTestId("provider-status")).toHaveAttribute("data-tone", "active");
  });

  it("shows a settled finished thread as finished", () => {
    const thread = makeThread("finished");

    const { getByRole, getByTestId } = render(
      <ThreadHeaderStatusButton
        threadId={thread.id}
        fallbackThread={thread}
        fallbackAgentKind="claude"
        agentLabel="Claude"
      />,
    );

    expect(
      getByRole("button", { name: "Claude: Finished. Hover for status details." }),
    ).toBeInTheDocument();
    expect(getByTestId("provider-status")).toHaveAttribute("data-tone", "finished");
  });

  it("shows connecting while a stored GUI session reconnects", () => {
    const thread = makeThread("idle");
    useAppStore.setState({ connectingThreadIds: { [thread.id]: "connection-1" } });

    const { getByRole, getByText } = render(
      <ThreadHeaderStatusButton
        threadId={thread.id}
        fallbackThread={thread}
        fallbackAgentKind="claude"
        agentLabel="Claude"
      />,
    );

    expect(
      getByRole("button", { name: "Claude: Connecting…. Hover for status details." }),
    ).toBeInTheDocument();
    expect(getByText("Connecting…")).toBeInTheDocument();
  });
});
