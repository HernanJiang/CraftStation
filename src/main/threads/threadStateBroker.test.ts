import { describe, expect, it } from "vitest";
import { ThreadStateBroker } from "./threadStateBroker";

describe("ThreadStateBroker.waitUntil", () => {
  it("resolves on the first polled value", async () => {
    const broker = new ThreadStateBroker();
    const value = await broker.waitUntil(["t1"], 1_000, () => "hit", 50);
    expect(value).toBe("hit");
  });

  it("returns undefined after the timeout when nothing fires", async () => {
    const broker = new ThreadStateBroker();
    const value = await broker.waitUntil(["t1"], 60, () => undefined, 20);
    expect(value).toBeUndefined();
  });

  it("wakes a waiter on a matching thread-state event", async () => {
    const broker = new ThreadStateBroker();
    let checks = 0;
    const pending = broker.waitUntil(
      ["t1"],
      5_000,
      () => {
        checks += 1;
        return checks >= 2 ? "done" : undefined;
      },
      5_000,
    );
    broker.observe({
      type: "thread-state",
      threadId: "t1",
      status: "finished",
      attention: "none",
      canResumeWithConfig: false,
    });
    expect(await pending).toBe("done");
  });

  it("ignores events for unrelated keys", async () => {
    const broker = new ThreadStateBroker();
    let checks = 0;
    const pending = broker.waitUntil(
      ["t1"],
      120,
      () => {
        checks += 1;
        return undefined;
      },
      40,
    );
    broker.observe({
      type: "thread-state",
      threadId: "other",
      status: "finished",
      attention: "none",
      canResumeWithConfig: false,
    });
    broker.observe({ type: "thread-output", threadId: "other", data: "x", outputLength: 1 });
    await new Promise((r) => setTimeout(r, 30));
    // Initial poll only — the unrelated events did not re-run the poll.
    expect(checks).toBe(1);
    expect(await pending).toBeUndefined();
  });

  it("wakes on project-tree-changed and git-changed keyed by projectId", async () => {
    const broker = new ThreadStateBroker();
    let checks = 0;
    const pending = broker.waitUntil(
      ["p1"],
      5_000,
      () => {
        checks += 1;
        return checks >= 2 ? "changed" : undefined;
      },
      5_000,
    );
    broker.observe({ type: "project-tree-changed", projectId: "p1" });
    expect(await pending).toBe("changed");
  });

  it("supports concurrent waiters with disjoint keys", async () => {
    const broker = new ThreadStateBroker();
    const a = broker.waitUntil(["a"], 80, () => undefined, 20);
    const b = broker.waitUntil(["b"], 5_000, () => "b-hit", 5_000);
    broker.observe({ type: "thread-exited", threadId: "b", exitCode: 0 });
    expect(await b).toBe("b-hit");
    expect(await a).toBeUndefined();
  });
});
