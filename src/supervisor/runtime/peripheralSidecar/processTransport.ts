import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CraftingError } from "@/shared/crafting/errors";
import type {
  PeripheralDiagnostic,
  PeripheralSidecarOptions,
  PeripheralSidecarTransport,
} from "./types";

export class PeripheralProcessTransport implements PeripheralSidecarTransport {
  private child?: ChildProcess;
  private buffer = "";
  private closed = true;
  private readonly lineListeners = new Set<(line: string) => void>();
  private readonly closeListeners = new Set<(diagnostic: PeripheralDiagnostic) => void>();
  private stderrTail = "";
  private exitCode: number | null = null;
  private exitSignal: string | null = null;

  constructor(private readonly options: PeripheralSidecarOptions) {}

  static bundledBinaryPath(
    resourcesPath: string,
    platform = process.platform,
    arch = process.arch,
  ): string {
    const executable =
      platform === "win32"
        ? "craftstation-peripheral-sidecar.exe"
        : "craftstation-peripheral-sidecar";
    const path = join(resourcesPath, "peripheral-sidecar", `${platform}-${arch}`, executable);
    if (!existsSync(path)) {
      throw CraftingError.runtimeUnavailable(
        "peripheral-sidecar",
        `Bundled peripheral sidecar was not found: ${path}`,
      );
    }
    return path;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  async start(): Promise<void> {
    if (this.child && !this.closed) return;
    if (!this.options.binaryPath)
      throw CraftingError.runtimeUnavailable("peripheral-sidecar", "No sidecar binary configured.");
    const child = spawn(this.options.binaryPath, this.options.args ?? [], {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.closed = false;
    this.stderrTail = "";
    this.exitCode = null;
    this.exitSignal = null;
    child.stdout?.on("data", (chunk: Buffer | string) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split(/\r?\n/);
      this.buffer = lines.pop() ?? "";
      for (const line of lines)
        if (line.trim()) for (const listener of this.lineListeners) listener(line);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-4096);
    });
    child.once("error", () => this.closeWithDiagnostic());
    child.once("exit", (code, signal) => {
      this.exitCode = code;
      this.exitSignal = signal;
      this.closeWithDiagnostic();
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      child.once("spawn", () => resolve());
      child.once("error", onError);
    });
  }

  write(line: string): void {
    if (!this.child?.stdin || this.closed)
      throw CraftingError.runtimeUnavailable(
        "peripheral-sidecar",
        "Peripheral sidecar is not running.",
      );
    this.child.stdin.write(line, "utf8");
  }

  onLine(listener: (line: string) => void): () => void {
    this.lineListeners.add(listener);
    return () => this.lineListeners.delete(listener);
  }

  onClose(listener: (diagnostic: PeripheralDiagnostic) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child || this.closed) return;
    if (!child.killed) child.kill();
    await new Promise<void>((resolve) => {
      if (this.closed) return resolve();
      child.once("exit", () => resolve());
      setTimeout(resolve, 1_000).unref();
    });
    this.closeWithDiagnostic();
  }

  private closeWithDiagnostic(): void {
    if (this.closed) return;
    this.closed = true;
    const diagnostic = {
      stderrTail: this.stderrTail,
      exitCode: this.exitCode,
      exitSignal: this.exitSignal,
    };
    for (const listener of this.closeListeners) listener(diagnostic);
  }
}
