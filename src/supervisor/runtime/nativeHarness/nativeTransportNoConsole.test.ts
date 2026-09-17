import { execFileSync, spawn, type SpawnOptions } from "node:child_process";
import { describe, expect, it } from "vitest";
import { NdjsonProcessTransport } from "./nativeTransport";

function childPidsOf(pid: number): number[] {
  try {
    const raw = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Get-CimInstance Win32_Process -Filter 'ParentProcessId=${pid}' | Select-Object -ExpandProperty ProcessId`,
      ],
      { encoding: "utf8", windowsHide: true },
    ).trim();
    return raw
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

function childNamesOf(pid: number): string[] {
  try {
    const raw = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Get-CimInstance Win32_Process -Filter 'ParentProcessId=${pid}' | Select-Object -ExpandProperty Name`,
      ],
      { encoding: "utf8", windowsHide: true },
    ).trim();
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.runIf(process.platform === "win32")("NdjsonProcessTransport noConsole", () => {
  it("passes detached to spawn so Windows allocates no console", async () => {
    let captured: SpawnOptions | undefined;
    const spawnProcess = ((
      command: string,
      args: readonly string[],
      options: SpawnOptions,
    ): ReturnType<typeof spawn> => {
      captured = options;
      return spawn(command, [...args], options);
    }) as unknown as typeof spawn;
    const transport = new NdjsonProcessTransport({
      harnessKind: "antigravity",
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 500);"],
      cwd: process.cwd(),
      noConsole: true,
      spawnProcess,
      onEvent: () => undefined,
      onDiagnostic: () => undefined,
    });
    try {
      transport.start();
      expect(captured).toMatchObject({ windowsHide: true, detached: true });
      // Give a conhost every chance to appear, then confirm none did.
      for (let i = 0; i < 6 && !transport.isProcessRunning; i += 1) {
        await sleep(250);
      }
      expect(transport.isProcessRunning).toBe(true);
      await sleep(2000);
      const pid = (transport as unknown as { process?: { pid?: number } }).process?.pid;
      expect(pid).toBeGreaterThan(0);
      expect(childNamesOf(pid!)).not.toContain("conhost.exe");
    } finally {
      transport.dispose();
    }
  });

  it("keeps the default spawn (with conhost) when noConsole is unset", async () => {
    let captured: SpawnOptions | undefined;
    const spawnProcess = ((
      command: string,
      args: readonly string[],
      options: SpawnOptions,
    ): ReturnType<typeof spawn> => {
      captured = options;
      return spawn(command, [...args], options);
    }) as unknown as typeof spawn;
    const transport = new NdjsonProcessTransport({
      harnessKind: "antigravity",
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 500);"],
      cwd: process.cwd(),
      spawnProcess,
      onEvent: () => undefined,
      onDiagnostic: () => undefined,
    });
    try {
      transport.start();
      expect(captured).toMatchObject({ windowsHide: true });
      expect(captured).not.toHaveProperty("detached");
    } finally {
      transport.dispose();
    }
  });

  it("can still terminate a detached child", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 500);"], {
      stdio: "ignore",
      windowsHide: true,
      detached: true,
    });
    const pid = child.pid!;
    await sleep(500);
    child.kill();
    await sleep(1000);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    try {
      process.kill(pid, 0);
      // If the pid was recycled instantly this still passes vacuously; the
      // exit-code assertion above is the real signal.
    } catch {
      // ESRCH: gone, as expected.
    }
    expect(childPidsOf(pid)).toEqual([]);
  });
});
