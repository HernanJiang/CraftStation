import { spawn } from "node:child_process";

/**
 * Spawn a child process and resolve when it exits 0; reject on non-zero
 * exit (with stderr in the message) or spawn error. Used by both the WSL
 * and native runtime resolvers for `tar` extraction — same `windowsHide` +
 * stderr-collection pattern, parameterized only by argv.
 */
export function spawnAndAwaitExit(command: string, args: readonly string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}: ${stderr.trim()}`));
    });
  });
}
