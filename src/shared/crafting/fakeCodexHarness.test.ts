import { describe, expect, it, vi } from "vitest";
import { Crafter } from "./crafter";
import { BUILTIN_MODEL_ITEMS } from "./registry";
import { FakeCodexParityHarness } from "./fakeCodexHarness";
import type { RuntimeEvent } from "../contracts/runtimeEvent";
import type { SessionSnapshot } from "./runtimeInterface";

describe("v0.3/T01: Native Codex Runtime Interface & Parity Harness", () => {
  it("spawns Entity and creates Session from CraftPlan with typed explicit overrides", async () => {
    const crafter = new Crafter();
    const gptModel = BUILTIN_MODEL_ITEMS[0]!;

    const compileResult = crafter.compile(
      {
        slots: {
          model: gptModel,
          harness: "auto",
        },
      },
      {
        workspace: "D:\\test\\craftstation",
        threadId: "thread-parity-01",
        overrides: {
          reasoningEffort: "high",
          serviceTier: "priority",
          approvalPolicy: "on-demand",
        },
      },
    );

    expect(compileResult.success).toBe(true);
    const plan = compileResult.craftPlan!;
    expect(plan.overrides).toEqual({
      reasoningEffort: "high",
      serviceTier: "priority",
      approvalPolicy: "on-demand",
    });

    const harness = new FakeCodexParityHarness();
    expect(harness.supports(plan)).toBe(true);

    const entity = await harness.spawnEntity(plan);
    expect(entity.status).toBe("spawned");
    expect(entity.id).toMatch(/^entity:fake-codex:/);
    expect(entity.metadata?.overrides).toEqual(plan.overrides);

    const session = await harness.createSession(entity);
    expect(entity.status).toBe("running");
    expect(session.id).toMatch(/^sess:fake-codex:/);
    expect(session.threadId).toBe("thread-parity-01");
    expect(session.status).toBe("idle");

    const initialSnapshot = session.getSnapshot();
    expect(initialSnapshot.sessionId).toBe(session.id);
    expect(initialSnapshot.status).toBe("idle");
    expect(initialSnapshot.events.length).toBe(0);
    expect(initialSnapshot.effectiveOverrides?.reasoningEffort).toBe("high");
  });

  it("executes Turn with native event streaming and produces terminal snapshot without 60s timeout", async () => {
    const crafter = new Crafter();
    const gptModel = BUILTIN_MODEL_ITEMS[0]!;
    const plan = crafter.compile(
      { slots: { model: gptModel, harness: "auto" } },
      { workspace: "D:\\test\\craftstation", threadId: "thread-parity-stream" },
    ).craftPlan!;

    const harness = new FakeCodexParityHarness({
      chunkDelayMs: 5,
      responseGenerator: (prompt) => "Parity Echo: " + prompt,
    });

    const entity = await harness.spawnEntity(plan);
    const session = await harness.createSession(entity);

    const observedEvents: RuntimeEvent[] = [];
    const observedSnapshots: SessionSnapshot[] = [];

    const unsubscribe = session.subscribe((event, snapshot) => {
      observedEvents.push(event);
      observedSnapshots.push(snapshot);
    });

    const turnResult = await session.startTurn({
      prompt: "Hello CraftStation Codex Parity!",
    });

    expect(turnResult.status).toBe("completed");
    expect(turnResult.response).toBe("Parity Echo: Hello CraftStation Codex Parity!");
    expect(turnResult.events.length).toBeGreaterThan(3);

    const types = observedEvents.map((e) => e.type);
    expect(types[0]).toBe("turn.started");
    expect(types).toContain("item.started");
    expect(types).toContain("content.delta");
    expect(types).toContain("item.completed");
    expect(types[types.length - 1]).toBe("turn.completed");

    const finalSnapshot = session.getSnapshot();
    expect(finalSnapshot.status).toBe("idle");
    expect(finalSnapshot.activeTurnStatus).toBe("completed");
    expect(finalSnapshot.events.length).toBe(observedEvents.length);

    unsubscribe();
  });

  it("supports continuous multi-turn conversations on the same Session", async () => {
    const crafter = new Crafter();
    const gptModel = BUILTIN_MODEL_ITEMS[0]!;
    const plan = crafter.compile(
      { slots: { model: gptModel, harness: "auto" } },
      { workspace: "D:\\test\\craftstation" },
    ).craftPlan!;

    const harness = new FakeCodexParityHarness();
    const entity = await harness.spawnEntity(plan);
    const session = await harness.createSession(entity);

    const turn1 = await session.startTurn({ prompt: "First turn prompt" });
    expect(turn1.status).toBe("completed");

    const turn2 = await session.startTurn({ prompt: "Second turn prompt" });
    expect(turn2.status).toBe("completed");
    expect(turn2.turnId).not.toBe(turn1.turnId);

    const snapshot = session.getSnapshot();
    expect(snapshot.events.filter((e) => e.type === "turn.started").length).toBe(2);
    expect(snapshot.events.filter((e) => e.type === "turn.completed").length).toBe(2);
  });

  it("supports turn interruption via interrupt() command and AbortSignal", async () => {
    const crafter = new Crafter();
    const plan = crafter.compile(
      { slots: { model: BUILTIN_MODEL_ITEMS[0]!, harness: "auto" } },
      { workspace: "D:\\test\\craftstation" },
    ).craftPlan!;

    const harness = new FakeCodexParityHarness({
      chunkDelayMs: 50,
      responseGenerator: () =>
        "A very long response that will be interrupted before finishing completely",
    });

    const entity = await harness.spawnEntity(plan);
    const session = await harness.createSession(entity);

    const turnPromise = session.startTurn({ prompt: "Long prompt" });
    setTimeout(() => {
      void session.interrupt();
    }, 20);

    const result = await turnPromise;
    expect(result.status).toBe("interrupted");
    expect(session.getSnapshot().activeTurnStatus).toBe("interrupted");
    expect(session.status).toBe("idle");
  });

  it("supports resumeSession with session reference", async () => {
    const crafter = new Crafter();
    const plan = crafter.compile(
      { slots: { model: BUILTIN_MODEL_ITEMS[0]!, harness: "auto" } },
      { workspace: "D:\\test\\craftstation" },
    ).craftPlan!;

    const harness = new FakeCodexParityHarness();
    const entity = await harness.spawnEntity(plan);
    const session = await harness.resumeSession(entity, "sess:previous-rollout-ref");

    expect(session.sessionRef).toBe("sess:previous-rollout-ref");
    const turn = await session.startTurn({ prompt: "Resumed prompt" });
    expect(turn.status).toBe("completed");
  });

  it("supports session termination and cleans up listeners", async () => {
    const crafter = new Crafter();
    const plan = crafter.compile(
      { slots: { model: BUILTIN_MODEL_ITEMS[0]!, harness: "auto" } },
      { workspace: "D:\\test\\craftstation" },
    ).craftPlan!;

    const harness = new FakeCodexParityHarness();
    const entity = await harness.spawnEntity(plan);
    const session = await harness.createSession(entity);

    const listener = vi.fn<(event: RuntimeEvent, snapshot: SessionSnapshot) => void>();
    session.subscribe(listener);

    await session.terminate();
    expect(session.status).toBe("terminated");
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: "session.exited" }),
      expect.anything(),
    );

    await expect(session.startTurn({ prompt: "Fail prompt" })).rejects.toThrow(/terminated/);
  });

  it("handles turn failure gracefully and emits error events", async () => {
    const crafter = new Crafter();
    const plan = crafter.compile(
      { slots: { model: BUILTIN_MODEL_ITEMS[0]!, harness: "auto" } },
      { workspace: "D:\\test\\craftstation" },
    ).craftPlan!;

    const harness = new FakeCodexParityHarness({
      failOnTurn: true,
      failureMessage: "Simulated Model Rate Limit Exceeded",
    });

    const entity = await harness.spawnEntity(plan);
    const session = await harness.createSession(entity);

    const events: RuntimeEvent[] = [];
    session.subscribe((e) => events.push(e));

    await expect(session.startTurn({ prompt: "Fail please" })).rejects.toThrow(
      /Simulated Model Rate Limit Exceeded/,
    );

    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(events.some((e) => e.type === "turn.completed" && e.state === "failed")).toBe(true);
    expect(session.status).toBe("error");
  });
});
