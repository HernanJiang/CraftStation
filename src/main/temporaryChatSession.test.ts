import { describe, expect, it, vi } from "vitest";
import { TemporaryChatSession, routeTemporaryChatEvent } from "./temporaryChatSession";

describe("temporary chat lifecycle", () => {
  it("discards on close and assigns a new identity when reopened", async () => {
    const discard = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined);
    const session = new TemporaryChatSession(discard);
    const first = session.begin();
    await session.close(first);
    expect(discard).toHaveBeenCalledWith(first);
    expect(session.begin()).not.toBe(first);
    await expect(session.start(first, async () => "late")).rejects.toThrow("temporary-chat-closed");
  });

  it("cleans a launch that resolves after its window closed without closing the new chat", async () => {
    const discard = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined);
    const session = new TemporaryChatSession(discard);
    const first = session.begin();
    let finish!: () => void;
    const launch = session.start(
      first,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await session.close(first);
    const next = session.begin();
    finish();
    await launch;
    expect(discard.mock.calls).toEqual([[first], [first]]);
    expect(session.threadId).toBe(next);
  });

  it("never sends private events to the main history, even after a window closes", () => {
    const deliver = vi.fn<Parameters<typeof routeTemporaryChatEvent>[1]>();
    expect(
      routeTemporaryChatEvent({ type: "thread-reset", threadId: "temporary-chat-closed" }, deliver),
    ).toBeNull();
    expect(deliver).toHaveBeenCalledOnce();
    const event = { type: "thread-reset", threadId: "regular" } as const;
    expect(routeTemporaryChatEvent(event, deliver)).toBe(event);
  });

  it("splits mixed runtime batches so regular history persists and temporary content stays private", () => {
    const deliver = vi.fn<Parameters<typeof routeTemporaryChatEvent>[1]>();
    const regular = { threadId: "regular", events: [] };
    const temporary = { threadId: "temporary-chat-live", events: [] };
    expect(
      routeTemporaryChatEvent(
        { type: "thread-runtime-events-multi", batches: [regular, temporary] },
        deliver,
      ),
    ).toEqual({ type: "thread-runtime-events-multi", batches: [regular] });
    expect(deliver).toHaveBeenCalledWith({
      type: "thread-runtime-events-multi",
      batches: [temporary],
    });
  });
});
