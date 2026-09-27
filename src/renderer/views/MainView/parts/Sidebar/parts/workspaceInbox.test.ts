import { describe, expect, it } from "vitest";
import type { Thread } from "@/shared/contracts";
import { isWorkspaceInboxThread, partitionWorkspaceInbox } from "./workspaceInbox";

function thread(id: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    projectId: "pA",
    title: id,
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

describe("isWorkspaceInboxThread", () => {
  it("keeps working, interrupted, and unread-finished threads", () => {
    expect(isWorkspaceInboxThread(thread("a", { status: "working" }))).toBe(true);
    expect(isWorkspaceInboxThread(thread("a", { status: "launching" }))).toBe(true);
    expect(isWorkspaceInboxThread(thread("a", { status: "needs_reply" }))).toBe(true);
    expect(isWorkspaceInboxThread(thread("a", { status: "error" }))).toBe(true);
    expect(isWorkspaceInboxThread(thread("a", { status: "finished" }))).toBe(true);
    expect(
      isWorkspaceInboxThread(thread("a", { status: "idle" }), { hasBackgroundActivity: true }),
    ).toBe(true);
  });

  it("leaves settled, archived, done, and ephemeral threads in their project", () => {
    expect(isWorkspaceInboxThread(thread("a", { status: "idle" }))).toBe(false);
    expect(isWorkspaceInboxThread(thread("a", { status: "inactive" }))).toBe(false);
    expect(isWorkspaceInboxThread(thread("a", { status: "working", archived: true }))).toBe(false);
    expect(isWorkspaceInboxThread(thread("a", { status: "finished", done: true }))).toBe(false);
    expect(isWorkspaceInboxThread(thread("a", { status: "working", isEphemeral: true }))).toBe(
      false,
    );
  });
});

describe("partitionWorkspaceInbox", () => {
  const allowed = new Set(["pA"]);

  it("orders qualifying threads by most recently updated and skips other projects", () => {
    const { visible } = partitionWorkspaceInbox(
      [
        thread("old", { status: "working", updatedAt: "2026-09-01T00:00:00.000Z" }),
        thread("new", { status: "error", updatedAt: "2026-09-02T00:00:00.000Z" }),
        thread("other", { projectId: "pB", status: "working" }),
        thread("idle", { status: "idle" }),
      ],
      { allowedProjectIds: allowed },
    );
    expect(visible.map((item) => item.id)).toEqual(["new", "old"]);
  });

  it("keeps a dismissal only while the thread still qualifies", () => {
    const working = thread("t1", { status: "working" });
    const held = partitionWorkspaceInbox([working], {
      allowedProjectIds: allowed,
      dismissedIds: ["t1"],
    });
    expect(held.visible).toEqual([]);
    expect(held.staleDismissalIds).toEqual([]);

    const settled = partitionWorkspaceInbox([thread("t1", { status: "idle" })], {
      allowedProjectIds: allowed,
      dismissedIds: ["t1", "gone"],
    });
    expect(settled.visible).toEqual([]);
    expect(settled.staleDismissalIds).toEqual(["t1", "gone"]);
  });
});
