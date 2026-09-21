// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDurableWorkflowRunIndexForTests,
  readDurableWorkflowRunIndex,
  writeDurableWorkflowRunRecord,
} from "./durableWorkflowRunIndex";

describe("durable workflow run index", () => {
  beforeEach(clearDurableWorkflowRunIndexForTests);

  it("persists run location, lineage, stop reason, and resumability", () => {
    writeDurableWorkflowRunRecord({
      threadId: "thread-1",
      itemId: "item-1",
      manifestPath: "C:/repo/workflows/run-2.json",
      location: { kind: "windows", path: "C:/repo" },
      registeredAt: 10,
      lastObservedAt: 20,
      runId: "run-2",
      status: "failed",
      resumedFrom: "run-1",
      stopReason: "transport interrupted",
      resumable: true,
    });

    expect(readDurableWorkflowRunIndex()).toEqual([
      expect.objectContaining({
        runId: "run-2",
        resumedFrom: "run-1",
        stopReason: "transport interrupted",
        resumable: true,
      }),
    ]);
  });

  it("upserts one record per thread item", () => {
    const base = {
      threadId: "thread-1",
      itemId: "item-1",
      manifestPath: "/run.json",
      location: { kind: "posix" as const, path: "/repo" },
      registeredAt: 10,
      lastObservedAt: 20,
      status: "unknown" as const,
    };
    writeDurableWorkflowRunRecord(base);
    writeDurableWorkflowRunRecord({ ...base, lastObservedAt: 30, status: "running" });
    expect(readDurableWorkflowRunIndex()).toHaveLength(1);
    expect(readDurableWorkflowRunIndex()[0]?.status).toBe("running");
  });

  it("restores WSL locations without requiring a Windows path field", () => {
    writeDurableWorkflowRunRecord({
      threadId: "thread-wsl",
      itemId: "item-wsl",
      manifestPath: "/home/user/repo/.craftstation/run.json",
      location: {
        kind: "wsl",
        distro: "Ubuntu",
        linuxPath: "/home/user/repo",
        uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\user\\repo",
      },
      registeredAt: 10,
      lastObservedAt: 20,
      status: "running",
    });

    expect(readDurableWorkflowRunIndex()[0]?.location).toEqual({
      kind: "wsl",
      distro: "Ubuntu",
      linuxPath: "/home/user/repo",
      uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\user\\repo",
    });
  });
});
