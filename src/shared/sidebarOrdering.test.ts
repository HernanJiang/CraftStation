import { describe, expect, it } from "vitest";
import {
  migrateProjectPinsToTimestamps,
  migrateThreadPinToTimestamp,
  orderProjectIdsPinnedFirst,
  partitionGlobalPins,
} from "./sidebarOrdering";

describe("sidebarOrdering global pins", () => {
  it("partitions pinned threads above projects", () => {
    const threads = [
      { id: "t1", projectId: "pA", starred: false, pinnedAt: 300 },
      { id: "t2", projectId: "pA", starred: false },
      { id: "t3", projectId: "pB", starred: true },
    ];
    const projects = [{ id: "pA" }, { id: "pB" }, { id: "home" }];
    const result = partitionGlobalPins(threads, projects, { pinnedProjectIds: [] });
    expect(result.pinnedThreads.map((t) => t.id)).toEqual(["t3", "t1"]);
    expect(result.unpinnedThreads.map((t) => t.id)).toEqual(["t2"]);
    // Pin never rewrites membership: projectId untouched.
    expect(result.pinnedThreads[1]!.projectId).toBe("pA");
  });

  it("sorts multiple pins by pinnedAt", () => {
    const threads = [
      { id: "t1", projectId: "pA", pinnedAt: 200 },
      { id: "t2", projectId: "pB", pinnedAt: 100 },
    ];
    const result = partitionGlobalPins(threads, [], {});
    expect(result.pinnedThreads.map((t) => t.id)).toEqual(["t2", "t1"]);
  });

  it("partitions pinned projects with stable pin order", () => {
    const projects = [{ id: "pA" }, { id: "pB" }, { id: "pC" }];
    const pinnedProjectAt = { pB: 50, pA: 100 };
    const result = partitionGlobalPins([], projects, { pinnedProjectAt });
    expect(result.pinnedProjects.map((p) => p.id)).toEqual(["pB", "pA"]);
    expect(result.unpinnedProjects.map((p) => p.id)).toEqual(["pC"]);
  });

  it("unpin returns to the natural section (partition inverse)", () => {
    const threads = [{ id: "t1", projectId: "pA" }];
    const result = partitionGlobalPins(threads, [{ id: "pA" }], {});
    expect(result.pinnedThreads).toHaveLength(0);
    expect(result.unpinnedThreads.map((t) => t.id)).toEqual(["t1"]);
  });

  it("migrates legacy starred without losing pins", () => {
    expect(
      migrateThreadPinToTimestamp({ starred: true, updatedAt: "2026-09-01T10:00:00.000Z", now: 5 }),
    ).toBe(Date.parse("2026-09-01T10:00:00.000Z"));
    expect(migrateThreadPinToTimestamp({ starred: false, now: 5 })).toBeNull();
    expect(migrateThreadPinToTimestamp({ starred: true, now: 7 })).toBe(7);
    expect(migrateThreadPinToTimestamp({ pinnedAt: 42, starred: false })).toBe(42);
  });

  it("migrates project pin array to timestamps in order", () => {
    const next = migrateProjectPinsToTimestamps(["pB", "pA"], undefined, 1000);
    expect(next.pB).toBe(1000);
    expect(next.pA).toBe(1001);
    const dropped = migrateProjectPinsToTimestamps(["pA"], next, 2000);
    expect(dropped.pB).toBeUndefined();
    expect(dropped.pA).toBe(1001);
  });

  it("orders pinned projects first, stable for the rest (Projects > Home layout)", () => {
    // Project A/B pinned-first above the rest; Home renders last by layout.
    expect(orderProjectIdsPinnedFirst(["pA", "pB", "pC"], ["pB"], { pB: 5 })).toEqual([
      "pB",
      "pA",
      "pC",
    ]);
    expect(orderProjectIdsPinnedFirst([], [])).toEqual([]);
    expect(orderProjectIdsPinnedFirst(["pA"], [])).toEqual(["pA"]);
  });
});
