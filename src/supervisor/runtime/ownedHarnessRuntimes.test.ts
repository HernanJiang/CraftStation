import { describe, expect, it, vi } from "vitest";
import type { CraftPlan, CraftSession, Entity, HarnessRuntimeAdapter } from "@/shared/crafting";
import type { RuntimeEvent } from "@/shared/contracts";
import { OwnedHarnessRuntimes } from "./ownedHarnessRuntimes";

function fixture() {
  const listeners = new Set<(event: RuntimeEvent) => void>();
  const session = {
    subscribe: (listener: (event: RuntimeEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  } as unknown as CraftSession;
  const dispose = vi.fn<() => Promise<void>>(async () => {});
  const adapter = {
    id: "fixture",
    harnessKind: "codex",
    supports: () => true,
    spawnEntity: vi.fn<() => Promise<Entity>>(async () => ({}) as Entity),
    createSession: async () => session,
    resumeSession: async () => session,
    dispose,
  } as HarnessRuntimeAdapter;
  return {
    adapter,
    dispose,
    exit: () => {
      for (const listener of listeners) listener({ type: "session.exited" } as RuntimeEvent);
    },
  };
}
describe("adapter process ownership", () => {
  it.each(["createSession", "resumeSession"] as const)(
    "reclaims a late %s after shutdown",
    async (method) => {
      const owner = new OwnedHarnessRuntimes();
      const a = fixture();
      let complete!: (session: CraftSession) => void;
      const session = {
        terminate: vi.fn<() => Promise<void>>(async () => {}),
        subscribe: vi.fn<CraftSession["subscribe"]>(),
      } as unknown as CraftSession;
      a.adapter[method] = () =>
        new Promise<CraftSession>((resolve) => {
          complete = resolve;
        });
      const runtime = owner.own(a.adapter);
      const opening =
        method === "createSession"
          ? runtime.createSession({} as Entity)
          : runtime.resumeSession({} as Entity, "ref");
      await owner.dispose();
      complete(session);
      await expect(opening).rejects.toThrow("disposed while opening");
      expect(session.terminate).toHaveBeenCalledOnce();
      expect(session.subscribe).not.toHaveBeenCalled();
      await expect(runtime.createSession({} as Entity)).rejects.toThrow("disposed before opening");
      expect(a.dispose).toHaveBeenCalledOnce();
    },
  );
  it("releases two simultaneous same-harness adapters independently and exactly once", async () => {
    const owner = new OwnedHarnessRuntimes();
    const a = fixture();
    const b = fixture();
    await owner.own(a.adapter).createSession({} as Entity);
    await owner.own(b.adapter).resumeSession({} as Entity, "resume");
    a.exit();
    await owner.flush();
    expect(a.dispose).toHaveBeenCalledOnce();
    expect(b.dispose).not.toHaveBeenCalled();
    await owner.dispose();
    expect(a.dispose).toHaveBeenCalledOnce();
    expect(b.dispose).toHaveBeenCalledOnce();
  });
  it("cleans failed spawn without masking its original error", async () => {
    const owner = new OwnedHarnessRuntimes();
    const a = fixture();
    vi.mocked(a.adapter.spawnEntity).mockRejectedValue(new Error("spawn-original"));
    await expect(owner.own(a.adapter).spawnEntity({} as CraftPlan)).rejects.toThrow(
      "spawn-original",
    );
    await owner.dispose();
    expect(a.dispose).toHaveBeenCalledOnce();
  });
});
