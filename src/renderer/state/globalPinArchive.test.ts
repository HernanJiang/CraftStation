import { beforeEach, describe, expect, it } from "vitest";
import type { Thread } from "@/shared/contracts";
import { useAppStore } from "./appStore";
import { migrateStoredThreadPinArchive } from "./slices/threadSlice";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "t1",
    projectId: "p1",
    title: "t",
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

describe("global pin / archivedAt store behaviour", () => {
  beforeEach(() => {
    useAppStore.setState((state) => ({ ...state, projects: [], threads: [], view: { kind: "home" } }));
  });

  it("starThread stamps pinnedAt without touching projectId", () => {
    const project = useAppStore.getState().addProject({ kind: "windows", path: "C:\\repo" });
    const thread = useAppStore.getState().createThread({
      projectId: project.id,
      agentKind: "codex",
      config: { model: "m" },
      prompt: "hi",
    });
    useAppStore.getState().starThread(thread.id);
    const stored = useAppStore.getState().threads.find((t) => t.id === thread.id)!;
    expect(stored.starred).toBe(true);
    expect(typeof stored.pinnedAt).toBe("number");
    expect(stored.projectId).toBe(project.id);
  });

  it("unstarThread clears the global pin", () => {
    const project = useAppStore.getState().addProject({ kind: "windows", path: "C:\\repo" });
    const thread = useAppStore.getState().createThread({
      projectId: project.id,
      agentKind: "codex",
      config: { model: "m" },
      prompt: "hi",
    });
    useAppStore.getState().starThread(thread.id);
    useAppStore.getState().unstarThread(thread.id);
    const stored = useAppStore.getState().threads.find((t) => t.id === thread.id)!;
    expect(stored.starred).toBe(false);
    expect(stored.pinnedAt ?? null).toBeNull();
    expect(stored.projectId).toBe(project.id);
  });

  it("archiveThread stamps archivedAt; unarchive clears it", () => {
    const project = useAppStore.getState().addProject({ kind: "windows", path: "C:\\repo" });
    const thread = useAppStore.getState().createThread({
      projectId: project.id,
      agentKind: "codex",
      config: { model: "m" },
      prompt: "hi",
    });
    useAppStore.getState().archiveThread(thread.id);
    const archived = useAppStore.getState().threads.find((t) => t.id === thread.id)!;
    expect(archived.archived).toBe(true);
    expect(typeof archived.archivedAt).toBe("string");
    useAppStore.getState().unarchiveThread(thread.id);
    const restored = useAppStore.getState().threads.find((t) => t.id === thread.id)!;
    expect(restored.archived).toBe(false);
    expect(restored.archivedAt).toBeUndefined();
  });

  it("purgeExpiredArchives uses archivedAt (7d default window)", () => {
    const day = 24 * 60 * 60 * 1000;
    const base = Date.parse("2026-09-01T10:00:00.000Z");
    useAppStore.setState((state) => ({
      ...state,
      threads: [
        makeThread({ id: "old", archived: true, archivedAt: new Date(base - 8 * day).toISOString(), updatedAt: new Date(base).toISOString() }),
        makeThread({ id: "fresh", archived: true, archivedAt: new Date(base).toISOString(), updatedAt: new Date(base).toISOString() }),
        makeThread({ id: "live", archived: false }),
      ],
    }));
    useAppStore.getState().purgeExpiredArchives("7d", base);
    expect(useAppStore.getState().threads.map((t) => t.id).sort()).toEqual(["fresh", "live"]);
  });

  it("purgeExpiredArchives respects forever + immediate", () => {
    const base = Date.parse("2026-09-01T10:00:00.000Z");
    useAppStore.setState((state) => ({
      ...state,
      threads: [makeThread({ id: "a", archived: true, archivedAt: new Date(0).toISOString() })],
    }));
    useAppStore.getState().purgeExpiredArchives("forever", base);
    expect(useAppStore.getState().threads.map((t) => t.id)).toEqual(["a"]);
    useAppStore.getState().purgeExpiredArchives("immediate", base);
    expect(useAppStore.getState().threads).toEqual([]);
  });

  it("migrates legacy starred/archived rows without losing pins", () => {
    const legacy = makeThread({ starred: true, updatedAt: "2026-08-01T00:00:00.000Z" });
    const migrated = migrateStoredThreadPinArchive(legacy, 99);
    expect(migrated.pinnedAt).toBe(Date.parse("2026-08-01T00:00:00.000Z"));

    const legacyArchived = makeThread({ archived: true, updatedAt: "2026-08-02T00:00:00.000Z" });
    const migratedArchived = migrateStoredThreadPinArchive(legacyArchived, 99);
    expect(migratedArchived.archivedAt).toBe("2026-08-02T00:00:00.000Z");
  });
});
