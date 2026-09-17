import { execFileSync, spawn, type SpawnOptions } from "node:child_process";
import { describe, expect, it } from "vitest";
import { NdjsonProcessTransport } from "./nativeTransport";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Regression coverage for the "PowerShell window flashes on every Gemini tool
// call" defect. Root cause: the transport spawned `agy` with
// `detached: true` (DETACHED_PROCESS) — a console-less child whose every
// console-subsystem grandchild (agy shell tool → pwsh, language_server, …)
// allocated its own fresh VISIBLE console. `windowsHide` (CREATE_NO_WINDOW)
// alone keeps the whole tree windowless: verified live, pwsh grandchildren
// report GetConsoleWindow()=0.
describe.runIf(process.platform === "win32")("NdjsonProcessTransport windows console", () => {
  it("spawns hidden WITHOUT detached so grandchildren stay console-less", async () => {
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
      for (let i = 0; i < 6 && !transport.isProcessRunning; i += 1) {
        await sleep(250);
      }
      expect(transport.isProcessRunning).toBe(true);
    } finally {
      transport.dispose();
    }
  });

  it("gives console-subsystem grandchildren no visible console window", async () => {
    // Child mimics agy: a console-subsystem process that itself spawns a
    // console-subsystem grandchild (pwsh) with default creation flags.
    const probe =
      "Add-Type -Name W32 -Namespace W -MemberDefinition '" +
      '[DllImport("kernel32.dll")] public static extern System.IntPtr GetConsoleWindow(); ' +
      '[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);' +
      "'; $h = [W.W32]::GetConsoleWindow(); " +
      "$v = $false; if ($h -ne [System.IntPtr]::Zero) { $v = [W.W32]::IsWindowVisible($h) }; " +
      "Write-Output ('CONSOLE=' + $h + ' VISIBLE=' + $v)";
    const grandchildProbe = JSON.stringify(probe);
    const child = spawn(
      process.execPath,
      [
        "-e",
        `const { spawn } = require("node:child_process");
         const g = spawn("pwsh.exe", ["-NoProfile", "-Command", ${grandchildProbe}], { stdio: ["ignore", "pipe", "ignore"] });
         let out = "";
         g.stdout.on("data", (d) => (out += d));
         g.on("close", () => { process.stdout.write(out); process.exit(0); });
         g.on("error", () => { process.stdout.write("SPAWN_ERROR"); process.exit(1); });`,
      ],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    const exit = await new Promise<number | null>((resolve) => {
      child.on("close", (code) => resolve(code));
      setTimeout(() => {
        child.kill();
        resolve(null);
      }, 30_000);
    });
    if (out.includes("SPAWN_ERROR")) {
      // No pwsh on this host — the mechanism being asserted cannot exist here.
      return;
    }
    expect(exit).toBe(0);
    expect(out).toContain("VISIBLE=False");
  });

  it("still terminates a hidden child cleanly", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
      stdio: "ignore",
      windowsHide: true,
    });
    await sleep(500);
    child.kill();
    await sleep(1000);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    // No visible console host may outlive the child either.
    const stray = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Get-CimInstance Win32_Process -Filter 'ParentProcessId=${child.pid}' | Select-Object -ExpandProperty ProcessId`,
      ],
      { encoding: "utf8", windowsHide: true },
    ).trim();
    expect(stray).toBe("");
  });
});
