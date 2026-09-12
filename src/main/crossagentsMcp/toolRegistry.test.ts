import { describe, expect, it, vi } from "vitest";
import {
  CROSSAGENTS_MCP_SERVER_INFO,
  dispatchTool,
  formatToolResult,
  isKnownToolName,
  TOOLS,
  type CrossagentsToolContext,
} from "./toolRegistry";

function makeCtx(bus: unknown): CrossagentsToolContext {
  return {
    bus: bus as CrossagentsToolContext["bus"],
    identity: { threadId: "caller" },
  };
}

describe("crossagents peer tool registry", () => {
  it("advertises the persistent peer surface under the crossagents name", () => {    expect(CROSSAGENTS_MCP_SERVER_INFO).toMatchObject({ name: "crossagents" });
    expect(TOOLS.map((tool) => tool.name)).toEqual([
      "list_peers",
      "send_message",
      "ask",
      "reply",
      "inbox",
      "get_peer_status",
      "wake_peer",
      "spawn_peer",
      "switch_peer_model",
      "stop_peer",
    ]);
    for (const name of TOOLS.map((tool) => tool.name)) {
      expect(isKnownToolName(name)).toBe(true);
    }
    expect(isKnownToolName("spawn_agent")).toBe(false);
  });

  it("lists peers for the calling thread", async () => {
    const peers = [{ address: "kimi:K1" }];
    const bus = {
      listPeers: vi.fn<(caller: string, query?: string) => Array<{ address: string }>>(() => peers),
    };
    const result = (await dispatchTool("list_peers", { query: "kimi" }, makeCtx(bus))) as {
      count: number;
    };
    expect(bus.listPeers).toHaveBeenCalledWith("caller", "kimi");
    expect(result).toMatchObject({ count: 1 });
  });

  it("sends, asks with bounded waits, replies, and reads the inbox", async () => {
    const exchange = { id: "ex-1", updatedAt: "t0", status: "delivered" };
    type Exchange = typeof exchange;
    const bus = {
      requireSource: vi.fn<() => { id: string; projectId: string }>(() => ({
        id: "caller",
        projectId: "p1",
      })),
      resolveAddress: vi.fn<() => { threadId: string }>(() => ({ threadId: "target-1" })),
      askRaw: vi.fn<() => Promise<Exchange>>(async () => exchange),
      waitForReply: vi.fn<() => Promise<{ exchange: Exchange; timedOut: boolean }>>(async () => ({
        exchange: { ...exchange, status: "replied" },
        timedOut: false,
      })),
      send: vi.fn<() => Promise<Exchange>>(async () => exchange),
      reply: vi.fn<() => Promise<Exchange>>(async () => ({ ...exchange, status: "replied" })),
      inbox: vi.fn<() => Exchange[]>(() => [exchange]),
    };
    const ctx = makeCtx(bus);

    await dispatchTool("send_message", { target: "kimi:K1", message: "hi" }, ctx);
    expect(bus.send).toHaveBeenCalledWith("caller", "kimi:K1", "hi", "after-current-turn");

    const asked = (await dispatchTool(
      "ask",
      { target: "kimi:K1", message: "q?", timeout_s: 30 },
      ctx,
    )) as { timedOut: boolean };
    expect(bus.askRaw).toHaveBeenCalledWith("caller", "target-1", "q?", "after-current-turn");
    expect(bus.waitForReply).toHaveBeenCalledWith("caller", "ex-1", "t0", 30_000);
    expect(asked.timedOut).toBe(false);

    // Default ask bounds the wait at 30s; oversized values clamp at 110s.
    await dispatchTool("ask", { target: "kimi:K1", message: "q?" }, ctx);
    expect(bus.waitForReply).toHaveBeenLastCalledWith("caller", "ex-1", "t0", 30_000);
    await dispatchTool("ask", { target: "kimi:K1", message: "q?", timeout_s: 9999 }, ctx);
    expect(bus.waitForReply).toHaveBeenLastCalledWith("caller", "ex-1", "t0", 110_000);

    await dispatchTool("reply", { exchangeId: "ex-1", response: "done" }, ctx);
    expect(bus.reply).toHaveBeenCalledWith("caller", "ex-1", "done");

    const box = (await dispatchTool("inbox", { limit: 5 }, ctx)) as { count: number };
    expect(bus.inbox).toHaveBeenCalledWith("caller", 5);
    expect(box.count).toBe(1);
  });

  it("maps interrupt=true onto interrupt-and-send for send_message and ask", async () => {
    const exchange = { id: "ex-stop", updatedAt: "t0", status: "delivered", deliveredAt: "t1" };
    type Exchange = typeof exchange;
    const bus = {
      requireSource: vi.fn<() => { id: string; projectId: string }>(() => ({
        id: "caller",
        projectId: "p1",
      })),
      resolveAddress: vi.fn<() => { threadId: string }>(() => ({ threadId: "executor-1" })),
      askRaw: vi.fn<() => Promise<Exchange>>(async () => exchange),
      waitForReply: vi.fn<() => Promise<{ exchange: Exchange; timedOut: boolean }>>(async () => ({
        exchange,
        timedOut: false,
      })),
      send: vi.fn<() => Promise<Exchange>>(async () => exchange),
    };
    const ctx = makeCtx(bus);

    await dispatchTool(
      "send_message",
      { target: "codex:C2", message: "STOP. Do not sbatch.", interrupt: true },
      ctx,
    );
    expect(bus.send).toHaveBeenCalledWith(
      "caller",
      "codex:C2",
      "STOP. Do not sbatch.",
      "interrupt-and-send",
    );

    await dispatchTool(
      "ask",
      { target: "codex:C2", message: "Confirm you stopped.", interrupt: true, timeout_s: 20 },
      ctx,
    );
    expect(bus.askRaw).toHaveBeenCalledWith(
      "caller",
      "executor-1",
      "Confirm you stopped.",
      "interrupt-and-send",
    );
  });

  it("reports peer status and wakes without interrupting", async () => {
    const peer = { address: "kimi:K1", status: "offline" };
    const bus = {
      getPeer: vi.fn<() => typeof peer>(() => peer),
      wakePeer: vi.fn<() => Promise<{ threadId: string; retried: number; exchanges: unknown[] }>>(
        async () => ({ threadId: "t", retried: 1, exchanges: [] }),
      ),
    };
    const ctx = makeCtx(bus);
    expect(await dispatchTool("get_peer_status", { target: "kimi:K1" }, ctx)).toBe(peer);
    const woken = (await dispatchTool("wake_peer", { target: "kimi:K1" }, ctx)) as {
      retried: number;
    };
    expect(bus.wakePeer).toHaveBeenCalledWith("caller", "kimi:K1");
    expect(woken.retried).toBe(1);
  });

  it("fails closed on unknown tools, missing identity, and bad args", async () => {
    const bus = {};
    const ctx = makeCtx(bus);
    expect(await dispatchTool("nope", {}, ctx)).toMatchObject({ isError: true });
    expect(await dispatchTool("send_message", { target: "", message: "hi" }, ctx)).toMatchObject({
      isError: true,
    });
    const noIdentity = await dispatchTool(
      "inbox",
      {},
      { bus: {} } as unknown as CrossagentsToolContext,
    );
    expect(noIdentity).toMatchObject({ isError: true });
    expect(formatToolResult("inbox", { count: 0 })).toMatchObject({
      content: [{ type: "text" }],
    });
  });

  it("spawns, switches, and stops peers through the bus", async () => {
    const spawned = {
      address: "grok:G7",
      threadId: "t-grok-7",
      title: "Grok 4.6+测试",
      nativeSessionId: "G7",
    };
    const bus = {
      spawnPeer: vi.fn<() => Promise<typeof spawned>>(async () => spawned),
      switchPeerModel: vi.fn<
        () => Promise<{ threadId: string; address: string; model: string }>
      >(async () => ({ threadId: "t-grok-7", address: "grok:G7", model: "grok-4.7" })),
      stopPeer: vi.fn<() => Promise<{ deleted: boolean }>>(async () => ({ deleted: true })),
    };
    const ctx = makeCtx(bus);

    const created = (await dispatchTool(
      "spawn_peer",
      { harness: "grok", model: "grok-4.6", title: "Grok 4.6+测试", message: "准备测试" },
      ctx,
    )) as typeof spawned;
    expect(bus.spawnPeer).toHaveBeenCalledWith("caller", {
      harness: "grok",
      model: "grok-4.6",
      title: "Grok 4.6+测试",
      message: "准备测试",
    });
    expect(created.address).toBe("grok:G7");

    await dispatchTool("switch_peer_model", { target: "grok:G7", model: "grok-4.7" }, ctx);
    expect(bus.switchPeerModel).toHaveBeenCalledWith("caller", "grok:G7", "grok-4.7");

    const stopped = (await dispatchTool("stop_peer", { target: "grok:G7" }, ctx)) as {
      deleted: boolean;
    };
    expect(bus.stopPeer).toHaveBeenCalledWith("caller", "grok:G7");
    expect(stopped.deleted).toBe(true);
  });

  it("rejects lifecycle calls with missing fields", async () => {
    const bus = {};
    const ctx = makeCtx(bus);
    expect(await dispatchTool("spawn_peer", { model: "grok-4.6" }, ctx)).toMatchObject({
      isError: true,
    });
    expect(await dispatchTool("switch_peer_model", { target: "grok:G7" }, ctx)).toMatchObject({
      isError: true,
    });
    expect(await dispatchTool("stop_peer", {}, ctx)).toMatchObject({ isError: true });
  });
});
