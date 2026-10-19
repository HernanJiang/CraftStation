import { describe, expect, it } from "vitest";
import {
  createExclusiveQueue,
  shouldExpireTemporaryChatWarm,
  shouldReplaceTemporaryChatWarm,
  shouldReuseTemporaryChatWarm,
  shouldSendIntoTemporaryChatWarm,
  TEMPORARY_CHAT_IDLE_MS,
  temporaryChatRememberedModel,
  temporaryChatWarmAcceptsLaunch,
  temporaryChatWarmDraft,
  temporaryChatWarmKey,
  withTemporaryChatModelMemory,
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
    expect(shouldExpireTemporaryChatWarm({ visible: false, hasThread: true, parked: true })).toBe(
      false,
    );
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

  it("prepares from the last model even when the saved draft has not caught up", () => {
    expect(
      temporaryChatWarmDraft(undefined, { agentKind: "kimi", model: "kimi-code/k3-256k" }),
    ).toEqual({ agentKind: "kimi", model: "kimi-code/k3-256k" });
    expect(
      temporaryChatWarmDraft(
        { agentKind: "kimi", model: "kimi-code/k3", effort: "high" },
        { agentKind: "kimi", model: "kimi-code/k3-256k" },
      ),
    ).toEqual({ agentKind: "kimi", model: "kimi-code/k3-256k", effort: "high" });
  });

  it("keeps a prepare when the composer has not restored the account yet", () => {
    const key = temporaryChatWarmKey({ ...kimi, accountId: "pool-a" });
    const current = { key, phase: "starting" as const };
    expect(shouldReplaceTemporaryChatWarm(current, kimi)).toBe(false);
    expect(temporaryChatWarmAcceptsLaunch(key, kimi)).toBe(true);
    expect(shouldReplaceTemporaryChatWarm(current, { ...kimi, model: "kimi-code/k3" })).toBe(true);
  });

  it("restores the temporary chat's own last model", () => {
    const draft = { agentKind: "kimi", model: "kimi-code/k3-256k" };
    expect(withTemporaryChatModelMemory(draft, { codex: "gpt" })).toEqual({
      codex: "gpt",
      kimi: "kimi-code/k3-256k",
    });
    expect(temporaryChatRememberedModel(draft, "kimi")).toBe("kimi-code/k3-256k");
    expect(temporaryChatRememberedModel(draft, "codex")).toBeUndefined();
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
    expect(
      shouldSendIntoTemporaryChatWarm({
        ...base,
        threadModel: "kimi-code/k3",
        warmKey: temporaryChatWarmKey(kimi),
      }),
    ).toBe(true);
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
