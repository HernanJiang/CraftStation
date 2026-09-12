import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { Project, Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { useSidebarUiStore } from "@/renderer/state/sidebarUiStore";
import { GlobalPinnedSection } from "./GlobalPinnedSection";

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

// The global row reuses the project thread context menu for unpin; collapse
// it to a passthrough so this test owns pin visibility, not menu wiring.
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

function thread(id: string, projectId: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    projectId,
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

beforeEach(() => {
  useAppStore.setState((state) => ({
    ...state,
    projects: [project("pA", "Project A"), project("pB", "Project B")],
    threads: [],
    view: { kind: "home" },
  }));
  useSidebarUiStore.setState({ editingThreadId: null });
});

describe("GlobalPinnedSection", () => {
  it("renders nothing without pins", () => {
    useAppStore.setState((state) => ({
      ...state,
      threads: [thread("t1", "pA")],
    }));
    const { container } = render(<GlobalPinnedSection />);
    expect(container.textContent ?? "").toBe("");
  });

  it("lifts a Project A thread above the project sections (workspace kept)", () => {
    useAppStore.setState((state) => ({
      ...state,
      threads: [
        thread("t1", "pA", { title: "Pinned T1", starred: true, pinnedAt: 200 }),
        thread("t2", "pA", { title: "Plain T2" }),
      ],
    }));
    render(<GlobalPinnedSection />);
    // Pinned thread is in the global section…
    expect(screen.getByText("Pinned T1")).toBeInTheDocument();
    // …while the unpinned thread stays in its project section (not here).
    expect(screen.queryByText("Plain T2")).not.toBeInTheDocument();
    // Pin never rewrote membership.
    expect(useAppStore.getState().threads.find((t) => t.id === "t1")?.projectId).toBe("pA");
  });

  it("keeps the full row affordances: unpin, more and archive", () => {
    useAppStore.setState((state) => ({
      ...state,
      threads: [thread("t1", "pA", { title: "Pinned T1", starred: true, pinnedAt: 200 })],
    }));
    render(<GlobalPinnedSection />);
    expect(
      screen.getByRole("button", { name: "Unpin Pinned T1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "More actions for Pinned T1" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive Pinned T1" })).toBeInTheDocument();
  });

  it("orders multiple pins by pinnedAt", () => {
    useAppStore.setState((state) => ({
      ...state,
      threads: [
        thread("t1", "pA", { title: "First", pinnedAt: 300, starred: true }),
        thread("t2", "pB", { title: "Second", pinnedAt: 100, starred: true }),
      ],
    }));
    render(<GlobalPinnedSection />);
    const items = screen.getAllByRole("button").map((el) => el.textContent ?? "");
    expect(items.findIndex((text) => text.includes("Second"))).toBeLessThan(
      items.findIndex((text) => text.includes("First")),
    );
  });

  it("hides archived pins from the global section", () => {
    useAppStore.setState((state) => ({
      ...state,
      threads: [thread("t1", "pA", { title: "Archived pin", pinnedAt: 5, starred: true, archived: true })],
    }));
    const { container } = render(<GlobalPinnedSection />);
    expect(container.textContent ?? "").toBe("");
  });
});
