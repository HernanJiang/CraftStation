import { describe, expect, it } from "vitest";
import {
  createExclusiveQueue,
  shouldExpireTemporaryChatWarm,
  shouldReuseTemporaryChatWarm,
  shouldSendIntoTemporaryChatWarm,
  TEMPORARY_CHAT_IDLE_MS,
  temporaryChatWarmKey,
} from "./temporaryChat";

describe("temporary chat warm session", () => {
  const kimi = {
    agentKind: "kimi",
    model: "kimi-code/k3-256k",
    presentationMode: "gui",
  };

  it("expires a hidden warm after two hours and keeps a visible window", () => {
    expect(TEMPORARY_CHAT_IDLE_MS).toBe(2 * 60 * 60 * 1000);
    expect(shouldExpireTemporaryChatWarm({ visible: false, hasThread: true })).toBe(true);
    expect(shouldExpireTemporaryChatWarm({ visible: true, hasThread: true })).toBe(false);
    expect(shouldExpireTemporaryChatWarm({ visible: false, hasThread: false })).toBe(false);
  });

  it("treats the same CLI and model as one prepared session", () => {
    expect(temporaryChatWarmKey(kimi)).toBe(temporaryChatWarmKey({ ...kimi }));
    expect(temporaryChatWarmKey(kimi)).not.toBe(
      temporaryChatWarmKey({ ...kimi, model: "kimi-code/k3" }),
    );
    expect(temporaryChatWarmKey(kimi)).not.toBe(
      temporaryChatWarmKey({ ...kimi, accountId: "pool-a" }),
    );
  });

  it("reuses a finished prepare and refuses a failed or mismatched one", () => {
    const key = temporaryChatWarmKey(kimi);
    const ready = { key, ready: true };
    expect(shouldReuseTemporaryChatWarm(ready, key, "idle")).toBe(true);
    expect(shouldReuseTemporaryChatWarm(ready, key, "launching")).toBe(true);
    expect(shouldReuseTemporaryChatWarm(ready, key, "error")).toBe(false);
    expect(shouldReuseTemporaryChatWarm(ready, key, "inactive")).toBe(false);
    expect(shouldReuseTemporaryChatWarm(ready, key, undefined)).toBe(false);
    expect(shouldReuseTemporaryChatWarm({ key, ready: false }, key, "idle")).toBe(false);
    expect(shouldReuseTemporaryChatWarm(ready, `${key}\0other`, "idle")).toBe(false);
    expect(shouldReuseTemporaryChatWarm(null, key, "idle")).toBe(false);
  });

  it("accepts a prepared CLI whose harness was remapped from the picker vendor", () => {
    const base = {
      warm: { threadId: "temporary-chat-1", phase: "ready" as const },
      threadId: "temporary-chat-1",
      threadStatus: "idle",
      threadAgentKind: "kimi",
      threadModel: "kimi-code/k3-256k",
      threadSourceProviderKind: "kimi",
      threadPresentationMode: "gui",
      threadAccountId: undefined,
      launchAgentKind: "kimi",
      launchModel: "kimi-code/k3-256k",
      launchPresentationMode: "gui" as string | undefined,
      launchAccountId: undefined,
      hasGoal: false,
      hasWorktree: false,
    };
    expect(shouldSendIntoTemporaryChatWarm(base)).toBe(true);
    expect(
      shouldSendIntoTemporaryChatWarm({
        ...base,
        launchAgentKind: "kimi",
        threadSourceProviderKind: undefined,
      }),
    ).toBe(true);
    expect(shouldSendIntoTemporaryChatWarm({ ...base, launchModel: "kimi-code/k3" })).toBe(false);
    expect(shouldSendIntoTemporaryChatWarm({ ...base, hasGoal: true })).toBe(false);
    expect(
      shouldSendIntoTemporaryChatWarm({ ...base, warm: { ...base.warm, phase: "starting" } }),
    ).toBe(false);
  });

  it("runs queued work one at a time and continues after a failure", async () => {
    const enqueue = createExclusiveQueue();
    const order: string[] = [];
    const first = enqueue(
      () =>
        new Promise<void>((resolve) => {
          order.push("first-start");
          setTimeout(() => {
            order.push("first-end");
            resolve();
          }, 20);
        }),
    );
    const second = enqueue(async () => {
      order.push("second");
      throw new Error("boom");
    });
    const third = enqueue(async () => {
      order.push("third");
    });
    await first;
    await expect(second).rejects.toThrow("boom");
    await third;
    expect(order).toEqual(["first-start", "first-end", "second", "third"]);
  });
});
