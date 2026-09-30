import { afterEach, describe, expect, it, vi } from "vitest";
import type { IPty } from "node-pty";
import type { SessionRuntime, ShellSessionRuntime } from "../sessionTypes";
import { PtyLifecycle } from "./ptyLifecycle";
import type { PtySpawnWindow } from "./conptyConhostReaper";
import { terminateProcessTree } from "@/shared/processTree";

vi.mock("@/shared/processTree", () => ({
  terminateProcessTree: vi.fn<(pid: number) => void>(),
}));

function runtimeWithResize(resize: IPty["resize"]): SessionRuntime {
  return {
    pty: { resize } as IPty,
    ptyExited: false,
  } as SessionRuntime;
}

describe("PtyLifecycle.resize", () => {
  it.each(["Cannot resize a pty that has already exited", "ioctl(2) failed, ENOTTY"])(
    "treats the node-pty exit race as an expected outcome: %s",
    (message) => {
      const lifecycle = new PtyLifecycle();
      const session = runtimeWithResize(() => {
        throw new Error(message);
      });

      expect(() => lifecycle.resize(session, 120, 40)).not.toThrow();
      expect(session.ptyExited).toBe(true);
    },
  );

  it("does not call native resize after lifecycle teardown", () => {
    const resize = vi.fn<IPty["resize"]>();
    const lifecycle = new PtyLifecycle();
    const session = runtimeWithResize(resize);
    session.ignoreExit = true;

    lifecycle.resize(session, 120, 40);

    expect(resize).not.toHaveBeenCalled();
  });

  it("propagates unrelated native resize failures", () => {
    const lifecycle = new PtyLifecycle();
    const session = runtimeWithResize(() => {
      throw new Error("native resize invariant failed");
    });

    expect(() => lifecycle.resize(session, 120, 40)).toThrow("native resize invariant failed");
    expect(session.ptyExited).toBe(false);
  });
});

describe("PtyLifecycle conhost reaping", () => {
  const window: PtySpawnWindow = { startedAt: 1_000_000, endedAt: 1_000_050 };

  function reaperSpy() {
    return { schedule: vi.fn<(window: PtySpawnWindow, ownerId: string) => void>() };
  }

  it("schedules the spawn window once under the thread id and clears it", () => {
    const reaper = reaperSpy();
    const lifecycle = new PtyLifecycle(reaper);
    const session = {
      threadId: "thread-1",
      ptySpawnWindow: window,
      ptyExited: false,
    } as SessionRuntime;

    lifecycle.resolveExit(session);
    lifecycle.resolveExit(session);

    expect(reaper.schedule).toHaveBeenCalledTimes(1);
    expect(reaper.schedule).toHaveBeenCalledWith(window, "thread-1");
    expect(session.ptySpawnWindow).toBeUndefined();
    expect(session.ptyExited).toBe(true);
  });

  it("uses the shell id as owner for shell sessions", () => {
    const reaper = reaperSpy();
    const lifecycle = new PtyLifecycle(reaper);
    const session = {
      shellId: "shell-1",
      ptySpawnWindow: window,
      ptyExited: false,
    } as ShellSessionRuntime;

    lifecycle.resolveExit(session);

    expect(reaper.schedule).toHaveBeenCalledWith(window, "shell-1");
  });

  it("does not schedule when no spawn window was recorded", () => {
    const reaper = reaperSpy();
    const lifecycle = new PtyLifecycle(reaper);
    const session = { threadId: "thread-1", ptyExited: false } as SessionRuntime;

    lifecycle.resolveExit(session);

    expect(reaper.schedule).not.toHaveBeenCalled();
  });
});

describe("PtyLifecycle.kill on Windows", () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;

  afterEach(() => {
    Object.defineProperty(process, "platform", originalPlatform);
    vi.mocked(terminateProcessTree).mockClear();
  });

  function win32() {
    Object.defineProperty(process, "platform", { value: "win32" });
  }

  it("kill() uses terminateProcessTree and never pty.kill()", () => {
    win32();
    const ptyKill = vi.fn<() => void>();
    const lifecycle = new PtyLifecycle();
    const session = {
      threadId: "thread-1",
      pty: { pid: 4321, kill: ptyKill } as unknown as IPty,
      ptyExited: false,
    } as SessionRuntime;

    lifecycle.kill(session);

    expect(terminateProcessTree).toHaveBeenCalledWith(4321);
    expect(ptyKill).not.toHaveBeenCalled();
  });

  it("killShell() uses terminateProcessTree and never pty.kill()", () => {
    win32();
    const ptyKill = vi.fn<() => void>();
    const lifecycle = new PtyLifecycle();
    const session = {
      shellId: "shell-1",
      pty: { pid: 8765, kill: ptyKill } as unknown as IPty,
      ptyExited: false,
    } as ShellSessionRuntime;

    lifecycle.killShell(session);

    expect(terminateProcessTree).toHaveBeenCalledWith(8765);
    expect(ptyKill).not.toHaveBeenCalled();
  });
});
