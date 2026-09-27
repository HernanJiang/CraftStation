import { fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { Project, Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { useSidebarUiStore } from "@/renderer/state/sidebarUiStore";
import { SidebarWorkspaceInbox } from "./SidebarWorkspaceInbox";

vi.mock("@/renderer/actions/threadActions", () => ({
  openThread: vi.fn<(threadId: string) => void>(),
  renameThread: vi.fn<(threadId: string, title: string) => void>(),
  toggleStarThread: vi.fn<(threadId: string) => void>(),
  archiveThread: vi.fn<(threadId: string) => void>(),
  requestDeleteThread: vi.fn<(threadId: string) => void>(),
  continueInProvider: vi.fn<(threadId: string) => void>(),
  openNewThreadInWorktree: vi.fn<(input: unknown) => void>(),
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({}),
  isRemoteSession: () => false,
}));

vi.mock("@dnd-kit/react/sortable", () => ({
  useSortable: () => ({ ref: () => {}, handleRef: () => {} }),
}));

vi.mock("@/renderer/dnd", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/renderer/dnd")>();
  return { ...actual, useIsDraggingThread: () => false, useIsDraggingProject: () => false };
});

vi.mock("./ThreadContextMenu", () => ({
  ThreadContextMenu: (props: { children: ReactNode }) => <>{props.children}</>,
}));

function project(id: string, name: string): Project {
  return {
    id,
    name,
    location: { kind: "posix", path: `/repo/${id}` },
    createdAt: "2026-09-01T00:00:00.000Z",
  };
}

function thread(id: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    projectId: "pA",
    title: `Thread ${id}`,
    agentKind: "codex",
    config: { model: "m" },
    status: "idle",
    attention: "none",
    canResumeWithConfig: false,
    archived: false,
    done: false,
    starred: false,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("SidebarWorkspaceInbox", () => {
  beforeEach(() => {
    useAppStore.setState((state) => ({
      ...state,
      projects: [project("pA", "CraftStation")],
      threads: [
        thread("work", { status: "working", title: "Still working" }),
        thread("idle", { status: "idle", title: "Settled" }),
      ],
      view: { kind: "home" },
    }));
    useSidebarUiStore.setState({
      workspaceInboxPinned: true,
      workspaceInboxCollapsed: false,
      dismissedWorkspaceInboxIds: [],
      editingThreadId: null,
    });
  });

  it("lists active threads and not settled ones, and is pinned by default", () => {
    render(<SidebarWorkspaceInbox />);

    expect(screen.getByRole("button", { name: /Workspace/ })).toBeInTheDocument();
    expect(screen.getByText("Still working")).toBeInTheDocument();
    expect(screen.queryByText("Settled")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unpin" })).toBeInTheDocument();
  });

  it("hides only the workspace shortcut when its pin is cleared", () => {
    render(<SidebarWorkspaceInbox />);

    fireEvent.click(screen.getByRole("button", { name: "Unpin Still working" }));

    expect(useSidebarUiStore.getState().dismissedWorkspaceInboxIds).toEqual(["work"]);
    expect(screen.queryByText("Still working")).not.toBeInTheDocument();
  });

  it("unpins the section without collapsing it", () => {
    render(<SidebarWorkspaceInbox />);

    fireEvent.click(screen.getByRole("button", { name: "Unpin" }));

    expect(useSidebarUiStore.getState().workspaceInboxPinned).toBe(false);
    expect(useSidebarUiStore.getState().workspaceInboxCollapsed).toBe(false);
    expect(screen.getByRole("button", { name: "Pin to top" })).toBeInTheDocument();
  });
});
