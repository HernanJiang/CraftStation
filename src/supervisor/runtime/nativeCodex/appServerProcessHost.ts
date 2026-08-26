import { spawn, type ChildProcess } from "node:child_process";
import { CodexBinaryResolver, type ResolvedCodexBinary } from "./codexBinaryResolver";
import { JsonRpcTransport } from "./jsonRpcTransport";
import { CraftingError } from "@/shared/crafting/errors";

export interface AppServerProcessOptions {
  binaryPath?: string | undefined;
  cwd?: string | undefined;
  env?: Record<string, string> | undefined;
  args?: string[] | undefined;
  onStderr?: ((chunk: string) => void) | undefined;
  onExit?: ((code: number | null, signal: string | null) => void) | undefined;
}

export class AppServerProcessHost {
  private _process?: ChildProcess | undefined;
  private _transport?: JsonRpcTransport | undefined;
  private _isShuttingDown = false;
  private _resolvedBinary?: ResolvedCodexBinary | undefined;
  private _stderrTail = "";
  private _lastExitCode: number | null | undefined;
  private _lastExitSignal: string | null | undefined;
  private _spawnArgs: string[] = [];
  private _exitPromise?: Promise<void> | undefined;

  constructor(private readonly options?: AppServerProcessOptions | undefined) {}

  get isRunning(): boolean {
    return this._process !== undefined && !this._process.killed && this._process.exitCode === null;
  }

  get resolvedBinary(): ResolvedCodexBinary | undefined {
    return this._resolvedBinary;
  }

  get stderrTail(): string {
    return this._stderrTail;
  }

  get lastExitCode(): number | null | undefined {
    return this._lastExitCode;
  }

  get lastExitSignal(): string | null | undefined {
    return this._lastExitSignal;
  }

  get spawnArgs(): readonly string[] {
    return this._spawnArgs;
  }

  get transport(): JsonRpcTransport {
    if (!this._transport) {
      throw CraftingError.runtimeUnavailable(
        "codex",
        "Codex App-Server process is not running or transport is not established",
      );
    }
    return this._transport;
  }

  async start(): Promise<JsonRpcTransport> {
    if (this.isRunning && this._transport) {
      return this._transport;
    }

    const binary = CodexBinaryResolver.assertAvailable(this.options?.binaryPath);
    this._resolvedBinary = binary;

    // Use official --stdio argument
    const args = ["app-server", "--stdio", ...(this.options?.args ?? [])];
    this._spawnArgs = [...args];
    const cwd = this.options?.cwd ?? process.cwd();
    const env = {
      ...process.env,
      ...this.options?.env,
    };

    try {
      const child = spawn(binary.path, args, {
        cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });

      this._process = child;
      this._isShuttingDown = false;
      this._stderrTail = "";
      this._lastExitCode = undefined;
      this._lastExitSignal = undefined;

      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        this._stderrTail = (this._stderrTail + text).slice(-4096);
        this.options?.onStderr?.(text);
      });

      child.on("exit", (code, signal) => {
        this._lastExitCode = code;
        this._lastExitSignal = signal;
        this._transport?.close();
        if (!this._isShuttingDown) {
          this.options?.onExit?.(code, signal);
        }
      });

      this._exitPromise = new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        child.once("exit", () => resolve());
        child.once("error", () => resolve());
      });

      child.on("error", (_err) => {
        this._transport?.close();
      });

      this._transport = new JsonRpcTransport(child.stdout, child.stdin);
      return this._transport;
    } catch (err) {
      throw CraftingError.runtimeUnavailable(
        "codex",
        `Failed to spawn official Codex app-server (${binary.path}): ${err instanceof Error ? err.message : String(err)}`,
        "Check Codex binary installation and permissions.",
      );
    }
  }

  async stop(): Promise<void> {
    this._isShuttingDown = true;
    const child = this._process;
    if (this._transport) {
      this._transport.close();
      this._transport = undefined;
    }

    if (child && !child.killed) {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore kill error
      }
    }

    // Keep the diagnostic exit fields stable for callers that persist evidence
    // immediately after shutdown, while bounding cleanup if the server ignores
    // SIGTERM. The child is never left attached to the host after this method.
    await Promise.race([
      this._exitPromise ?? Promise.resolve(),
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ]);
    this._process = undefined;
  }
}
