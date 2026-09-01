import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { CraftPlan } from "@/shared/crafting";
import { RuntimeSegmentLedger } from "./segmentLedger";

const dirs: string[] = [];

function plan(id: string, harnessKind = "codex"): CraftPlan {
  return {
    id,
    recipeId: `recipe-${id}`,
    resultItemId: `result-${id}`,
    ingredients: {},
    runtimeBinding: {
      harnessKind,
      modelId: `model-${id}`,
      vendor: `vendor-${id}`,
      runtimeAdapterId: `${harnessKind}-native-runtime`,
      options: {
        apiKey: "sk-abcdefghijklmnop",
        safe: "portable",
      },
    },
    createdAt: "2026-08-31T00:00:00.000Z",
  };
}

function openLedger(): { ledger: RuntimeSegmentLedger; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "craftstation-segments-"));
  dirs.push(dir);
  return { ledger: new RuntimeSegmentLedger(dir), dir };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("RuntimeSegmentLedger", () => {
  it("bootstraps one active Segment idempotently and restores sanitized provenance", () => {
    const { ledger, dir } = openLedger();
    const first = ledger.ensureInitial({
      threadId: "thread-1",
      plan: plan("a"),
      entityId: "entity-a",
      runtimeSessionId: "runtime-a",
      nativeSessionRef: "native-a",
    });
    const rebound = ledger.ensureInitial({
      threadId: "thread-1",
      plan: plan("a"),
      entityId: "entity-restarted",
      runtimeSessionId: "runtime-restarted",
      nativeSessionRef: "native-restarted",
    });

    expect(rebound).toMatchObject({
      id: first.id,
      ordinal: 0,
      bindingEpoch: 1,
      entityId: "entity-restarted",
      runtimeSessionId: "runtime-restarted",
      nativeSessionRef: "native-restarted",
    });
    expect(first).toMatchObject({ ordinal: 0, bindingEpoch: 1, status: "active" });
    expect(JSON.stringify(first)).not.toContain("sk-abcdefghijklmnop");
    expect(first.runtimeBinding.options).toEqual({ safe: "portable" });
    ledger.close();

    const reopened = new RuntimeSegmentLedger(dir);
    expect(reopened.active("thread-1")).toMatchObject({
      id: first.id,
      runtimeSessionId: "runtime-restarted",
      nativeSessionRef: "native-restarted",
    });
    reopened.close();
  });

  it("fails closed instead of rebinding an active Segment to a different CraftPlan", () => {
    const { ledger } = openLedger();
    ledger.ensureInitial({
      threadId: "thread-1",
      plan: plan("a"),
      entityId: "entity-a",
      runtimeSessionId: "runtime-a",
    });

    expect(() =>
      ledger.ensureInitial({
        threadId: "thread-1",
        plan: plan("other"),
        entityId: "entity-other",
        runtimeSessionId: "runtime-other",
      }),
    ).toThrow("HANDOFF_ACTIVE_PLAN_MISMATCH");
    ledger.close();
  });

  it("uses compare-and-swap activation and supports a guarded transactional rollback", () => {
    const { ledger } = openLedger();
    const source = ledger.ensureInitial({
      threadId: "thread-1",
      plan: plan("a"),
      entityId: "entity-a",
      runtimeSessionId: "runtime-a",
    });
    let target = ledger.prepare({
      threadId: "thread-1",
      plan: plan("b", "grok"),
      predecessorSegmentId: source.id,
    });
    target = ledger.attachRuntime(target.id, {
      entityId: "entity-b",
      runtimeSessionId: "runtime-b",
      nativeSessionRef: "native-b",
      checkpointId: "checkpoint-1",
    });

    const active = ledger.activateCas("thread-1", source.id, target.id);
    expect(active).toMatchObject({ id: target.id, ordinal: 1, bindingEpoch: 2, status: "active" });
    expect(() => ledger.activateCas("thread-1", source.id, target.id)).toThrow(
      "HANDOFF_SOURCE_EPOCH_STALE",
    );

    const restored = ledger.rollbackCas("thread-1", source.id, target.id, "BOOTSTRAP_FAILED");
    expect(restored.id).toBe(source.id);
    expect(ledger.list("thread-1")).toEqual([
      expect.objectContaining({ id: source.id, status: "active" }),
      expect.objectContaining({
        id: target.id,
        status: "rolled_back",
        failureCode: "BOOTSTRAP_FAILED",
      }),
    ]);
    ledger.close();
  });

  it("fails closed and restores the source after a restart interrupts activation", () => {
    const { ledger, dir } = openLedger();
    const source = ledger.ensureInitial({
      threadId: "thread-1",
      plan: plan("a"),
      entityId: "entity-a",
      runtimeSessionId: "runtime-a",
      nativeSessionRef: "native-a",
    });
    let target = ledger.prepare({
      threadId: "thread-1",
      plan: plan("b", "grok"),
      predecessorSegmentId: source.id,
    });
    target = ledger.attachRuntime(target.id, {
      entityId: "entity-b",
      runtimeSessionId: "runtime-b",
      nativeSessionRef: "native-b",
      checkpointId: "checkpoint-1",
    });
    ledger.activateCas("thread-1", source.id, target.id);
    ledger.saveSwitchState({
      requestId: "switch-interrupted",
      threadId: "thread-1",
      mode: "after-current-turn",
      phase: "activating",
      sourceSegmentId: source.id,
      targetSegmentId: target.id,
      targetBinding: target.runtimeBinding,
      targetCraftPlan: plan("b", "grok"),
      requestedAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:01.000Z",
    });
    ledger.close();

    const reopened = new RuntimeSegmentLedger(dir);
    const recovered = reopened.recoverInterruptedSwitches();

    expect(recovered).toEqual([
      expect.objectContaining({
        requestId: "switch-interrupted",
        phase: "rolled_back",
        diagnostic: expect.objectContaining({
          code: "HANDOFF_SUPERVISOR_RESTARTED",
          rollback: "succeeded",
        }),
      }),
    ]);
    expect(reopened.active("thread-1")?.id).toBe(source.id);
    expect(reopened.list("thread-1")).toEqual([
      expect.objectContaining({ id: source.id, status: "active" }),
      expect.objectContaining({
        id: target.id,
        status: "rolled_back",
        failureCode: "HANDOFF_SUPERVISOR_RESTARTED",
      }),
    ]);
    reopened.close();
  });
});
