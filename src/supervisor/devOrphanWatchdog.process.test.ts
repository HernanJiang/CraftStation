// @vitest-environment node

/**
 * Process-level regression: a real child running the production watchdog
 * (default timings) must self-exit within 5 s after its parent is hard-killed
 * (SIGKILL / TerminateProcess — the Windows path that may never deliver an
 * IPC disconnect).
 */
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const MIDDLE = fileURLToPath(new URL("./fixtures/devOrphanWatchdog-middle.mjs", import.meta.url));

const survivors = new Set<number>();

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  for (const pid of survivors) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  survivors.clear();
});

describe("startDevOrphanWatchdog (process level)", () => {
  it("exits within 5 s after the parent is hard-killed", { timeout: 20_000 }, async () => {
    const middle = fork(MIDDLE, [], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      execArgv: [],
    });
    if (typeof middle.pid === "number") {
      survivors.add(middle.pid);
    }

    const leafPid = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for leafPid")), 10_000);
      middle.on("message", (message: unknown) => {
        const pid = (message as { leafPid?: unknown }).leafPid;
        if (typeof pid === "number") {
          clearTimeout(timer);
          resolve(pid);
        }
      });
      middle.on("exit", () => {
        clearTimeout(timer);
        reject(new Error("middle exited before reporting leafPid"));
      });
    });
    survivors.add(leafPid);

    expect(isAlive(leafPid)).toBe(true);

    middle.kill("SIGKILL");

    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (!isAlive(leafPid)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(isAlive(leafPid)).toBe(false);
    survivors.delete(leafPid);
  });
});
