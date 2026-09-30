import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConptyConhostReaper,
  matchConhostForSpawn,
  type ConhostProcessInfo,
  type PtySpawnWindow,
} from "./conptyConhostReaper";

const WINDOW: PtySpawnWindow = { startedAt: 1_000_000, endedAt: 1_000_050 };

function makeReaper(overrides: {
  conhosts?: ConhostProcessInfo[];
  listConhostChildren?: (parentPid: number) => Promise<ConhostProcessInfo[]>;
  killProcess?: (pid: number) => void;
  platform?: NodeJS.Platform;
}) {
  const listConhostChildren = vi.fn<(parentPid: number) => Promise<ConhostProcessInfo[]>>(
    overrides.listConhostChildren ?? (async () => overrides.conhosts ?? []),
  );
  const killProcess = vi.fn<(pid: number) => void>(overrides.killProcess ?? (() => {}));
  const reaper = new ConptyConhostReaper({
    platform: overrides.platform ?? "win32",
    parentPid: 4242,
    delayMs: 100,
    listConhostChildren,
    killProcess,
  });
  return { reaper, listConhostChildren, killProcess };
}

describe("matchConhostForSpawn", () => {
  it("matches conhosts created inside the spawn window", () => {
    expect(
      matchConhostForSpawn(WINDOW, [
        { pid: 1, createdAt: WINDOW.startedAt },
        { pid: 2, createdAt: WINDOW.startedAt + 4 },
        { pid: 3, createdAt: WINDOW.endedAt },
      ]),
    ).toEqual([
      { pid: 1, createdAt: WINDOW.startedAt },
      { pid: 2, createdAt: WINDOW.startedAt + 4 },
      { pid: 3, createdAt: WINDOW.endedAt },
    ]);
  });

  it("accepts the 20ms lower slack and rejects beyond it", () => {
    expect(
      matchConhostForSpawn(WINDOW, [
        { pid: 1, createdAt: WINDOW.startedAt - 20 },
        { pid: 2, createdAt: WINDOW.startedAt - 21 },
      ]).map((conhost) => conhost.pid),
    ).toEqual([1]);
  });

  it("treats the upper edge as strict", () => {
    expect(
      matchConhostForSpawn(WINDOW, [
        { pid: 1, createdAt: WINDOW.endedAt },
        { pid: 2, createdAt: WINDOW.endedAt + 1 },
      ]).map((conhost) => conhost.pid),
    ).toEqual([1]);
  });
});

describe("ConptyConhostReaper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("kills the uniquely matched conhost and logs the reap", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { reaper, killProcess } = makeReaper({
      conhosts: [
        { pid: 111, createdAt: WINDOW.startedAt + 2 },
        { pid: 222, createdAt: WINDOW.endedAt + 5_000 },
      ],
    });

    reaper.schedule(WINDOW, "shell-1");
    await vi.advanceTimersByTimeAsync(100);

    expect(killProcess).toHaveBeenCalledTimes(1);
    expect(killProcess).toHaveBeenCalledWith(111);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("status=reaped"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("owner=shell-1"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("conhostPid=111"));
  });

  it("never kills on an ambiguous match and logs CONHOST_MATCH_AMBIGUOUS", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reaper, killProcess } = makeReaper({
      conhosts: [
        { pid: 111, createdAt: WINDOW.startedAt + 1 },
        { pid: 222, createdAt: WINDOW.startedAt + 3 },
      ],
    });

    reaper.schedule(WINDOW, "thread-1");
    await vi.advanceTimersByTimeAsync(100);

    expect(killProcess).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("code=CONHOST_MATCH_AMBIGUOUS"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("matches=2"));
  });

  it("skips without killing when nothing matches", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { reaper, killProcess } = makeReaper({
      conhosts: [{ pid: 111, createdAt: WINDOW.endedAt + 60_000 }],
    });

    reaper.schedule(WINDOW, "shell-2");
    await vi.advanceTimersByTimeAsync(100);

    expect(killProcess).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("status=skipped"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("reason=no-match"));
  });

  it("logs CONHOST_KILL_FAILED and still processes the rest of the batch", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const laterWindow: PtySpawnWindow = { startedAt: 2_000_000, endedAt: 2_000_050 };
    const { reaper, killProcess } = makeReaper({
      conhosts: [
        { pid: 111, createdAt: WINDOW.startedAt + 2 },
        { pid: 222, createdAt: laterWindow.startedAt + 2 },
      ],
      killProcess: (pid) => {
        if (pid === 111) throw new Error("Access is denied");
      },
    });

    reaper.schedule(WINDOW, "shell-a");
    reaper.schedule(laterWindow, "shell-b");
    await vi.advanceTimersByTimeAsync(100);

    expect(killProcess).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("code=CONHOST_KILL_FAILED"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("reason=Access is denied"));
  });

  it("logs CONHOST_LIST_FAILED and drops the batch when listing rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reaper, listConhostChildren, killProcess } = makeReaper({
      listConhostChildren: async () => {
        throw new Error("powershell exploded");
      },
    });

    reaper.schedule(WINDOW, "shell-1");
    reaper.schedule({ startedAt: 2_000_000, endedAt: 2_000_050 }, "shell-2");
    await vi.advanceTimersByTimeAsync(100);

    expect(listConhostChildren).toHaveBeenCalledTimes(1);
    expect(killProcess).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("code=CONHOST_LIST_FAILED owners=2"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("powershell exploded"));
  });

  it("shares one listing across schedules inside the delay window", async () => {
    const windows = [1_000_000, 2_000_000, 3_000_000].map((start) => ({
      startedAt: start,
      endedAt: start + 50,
    }));
    const { reaper, listConhostChildren, killProcess } = makeReaper({
      conhosts: windows.map((window, index) => ({
        pid: index + 1,
        createdAt: window.startedAt + 10,
      })),
    });

    for (const [index, window] of windows.entries()) {
      reaper.schedule(window, `shell-${index}`);
    }
    await vi.advanceTimersByTimeAsync(100);

    expect(listConhostChildren).toHaveBeenCalledTimes(1);
    expect(listConhostChildren).toHaveBeenCalledWith(4242);
    expect(killProcess).toHaveBeenCalledTimes(3);
  });

  it("is a no-op off Windows", async () => {
    const { reaper, listConhostChildren, killProcess } = makeReaper({ platform: "linux" });

    reaper.schedule(WINDOW, "shell-1");
    await vi.advanceTimersByTimeAsync(10_000);
    await reaper.flush();

    expect(listConhostChildren).not.toHaveBeenCalled();
    expect(killProcess).not.toHaveBeenCalled();
  });
});
