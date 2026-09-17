import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { appendFileSync, closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import type { NativeHarnessDiagnostic } from "@/shared/crafting";
import { extractWindowsCmdShimScript, resolveExecutablePath } from "@/supervisor/agents/base";
import { terminateChildProcessTree } from "@/shared/processTree";

export interface NativeWireEvent {
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly sequence: number;
}

export interface NativeProcessTransportOptions {
  harnessKind: string;
  command: string;
  args: readonly string[];
  cwd: string;
  env?: Record<string, string>;
  spawnProcess?: typeof spawn;
  onEvent: (event: NativeWireEvent) => void;
  onDiagnostic: (diagnostic: NativeHarnessDiagnostic) => void;
  onProcessExit?: (event: NativeProcessExit) => void;
}

export interface NativeProcessExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly cleanExit: boolean;
}

function safeText(value: unknown): string {
  if (typeof value !== "string") return String(value ?? "");
  return value
    .replace(
      /(access[_ -]?token|refresh[_ -]?token|api[_ -]?key|cookie|authorization|password)\s*[:=]\s*(?:Bearer\s+)?[A-Za-z0-9._~+/=-]+/giu,
      "$1=[REDACTED]",
    )
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]")
    .slice(0, 500);
}

const SECRET_KEY = /token|cookie|secret|password|authorization|api[_-]?key|credential/iu;
const CONTENT_KEY =
  /^(?:prompt|content|text|response|reasoning|thought|message|args|arguments|input|result|system|tools|delta|text_delta|reasoning_delta|thought_delta|output_text|raw_output|user_message|assistant_message|instruction|instructions|query|completion|(?:.*(?:_|-|(?=[A-Z]))?(?:prompt|content|text|response|reasoning|thought|message|delta|output|input|instruction|completion).*))$/iu;

function textLength(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) return value.reduce((total, item) => total + textLength(item), 0);
  if (value && typeof value === "object") {
    let total = 0;
    for (const item of Object.values(value as Record<string, unknown>)) total += textLength(item);
    return total;
  }
  return 0;
}

function contentSummary(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    return { redacted: true, chars: value.length };
  }
  if (Array.isArray(value)) {
    const kinds = value
      .flatMap((item) => (item && typeof item === "object" ? [item] : []))
      .map((item) =>
        typeof (item as Record<string, unknown>).type === "string"
          ? (item as Record<string, unknown>).type
          : undefined,
      )
      .filter((kind): kind is string => kind !== undefined);
    return {
      redacted: true,
      blockCount: value.length,
      chars: textLength(value),
      ...(kinds.length > 0 ? { kinds: [...new Set(kinds)].slice(0, 16) } : {}),
    };
  }
  if (value && typeof value === "object") {
    return {
      redacted: true,
      fields: Object.keys(value as Record<string, unknown>).length,
      chars: textLength(value),
    };
  }
  return { redacted: true };
}

function resolveWindowsNodeCmdShim(
  commandPath: string,
): { command: string; argsPrefix: string[] } | undefined {
  if (process.platform !== "win32") return undefined;
  if (/^(?:[a-zA-Z]:[\\/]|\\\\)/.test(commandPath) && /\.(?:exe|com)$/i.test(commandPath)) {
    return undefined;
  }

  let effectivePath = commandPath;
  if (!/\.cmd$/i.test(commandPath)) {
    const resolved = resolveExecutablePath(commandPath);
    if (!resolved || !/\.cmd$/i.test(resolved)) return undefined;
    effectivePath = resolved;
  }

  let content: string;
  try {
    content = readFileSync(effectivePath, "utf8");
  } catch {
    return undefined;
  }

  const relScript = extractWindowsCmdShimScript(content);
  if (!relScript) return undefined;

  const baseDir = dirname(effectivePath);
  const scriptPath = join(baseDir, ...relScript.split(/[\\/]+/));
  if (!existsSync(scriptPath)) return undefined;

  const localNode = join(baseDir, "node.exe");
  const nodeCommand = existsSync(localNode) ? localNode : (resolveExecutablePath("node") ?? "node");
  return {
    command: nodeCommand,
    argsPrefix: [scriptPath],
  };
}

export function resolveNativeSpawnTarget(
  command: string,
  args: readonly string[],
): { command: string; args: string[] } {
  if (process.platform === "win32") {
    const shim = resolveWindowsNodeCmdShim(command);
    if (shim) {
      return {
        command: shim.command,
        args: [...shim.argsPrefix, ...args],
      };
    }
  }
  return { command, args: [...args] };
}

function diagnostic(
  options: NativeProcessTransportOptions,
  phase: NativeHarnessDiagnostic["phase"],
  operation: string,
  code: NativeHarnessDiagnostic["code"],
  message: string,
  correlationId: string,
  details?: Record<string, unknown>,
): NativeHarnessDiagnostic {
  return {
    code,
    harnessKind: options.harnessKind,
    phase,
    operation,
    message: safeText(message),
    correlationId,
    ...(details ? { details } : {}),
    occurredAt: new Date().toISOString(),
  };
}

/** A small, provider-neutral NDJSON child-process boundary. */
export class NdjsonProcessTransport {
  readonly correlationId = randomUUID();
  private process: ChildProcessWithoutNullStreams | undefined;
  private sequence = 0;
  private disposed = false;
  private eventHandler: ((event: NativeWireEvent) => void) | undefined;
  private readonly pendingRequests = new Map<
    string,
    {
      resolve: (payload: Record<string, unknown>) => void;
      reject: (error: Error) => void;
    }
  >();
  /**
   * Opt-in raw-frame capture (`CRAFTSTATION_CAPTURE_NATIVE_WIRE=1`): appends a
   * redacted copy of every inbound frame to a per-session NDJSON file in the
   * temp dir. Exists so provider-specific mapping gaps (e.g. whether a model
   * emits thinking steps at all) can be diagnosed from one real conversation
   * without a dev build.
   */
  private wireCapture: { fd: number; path: string } | undefined;

  constructor(private readonly options: NativeProcessTransportOptions) {
    if (process.env.CRAFTSTATION_CAPTURE_NATIVE_WIRE === "1") {
      const path = join(
        process.env.CRAFTSTATION_CAPTURE_NATIVE_WIRE_DIR?.trim() || tmpdir(),
        `craftstation-native-wire-${this.correlationId}.ndjson`,
      );
      try {
        this.wireCapture = { fd: openSync(path, "a"), path };
        console.warn(`[native-wire] capturing ${options.harnessKind} frames to ${path}`);
      } catch {
        this.wireCapture = undefined;
      }
    }
  }

  private captureFrame(event: NativeWireEvent): void {
    const capture = this.wireCapture;
    if (!capture) return;
    try {
      appendFileSync(
        capture.fd,
        `${JSON.stringify({
          ts: new Date().toISOString(),
          sequence: event.sequence,
          type: event.type,
          payload: redactNativePayload(event.payload),
        })}\n`,
      );
    } catch {
      closeSync(capture.fd);
      this.wireCapture = undefined;
    }
  }

  get pendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  get isProcessRunning(): boolean {
    return this.process !== undefined && !this.disposed;
  }

  setEventHandler(handler: (event: NativeWireEvent) => void): void {
    this.eventHandler = handler;
  }

  start(): void {
    if (this.process || this.disposed) return;
    try {
      const target = resolveNativeSpawnTarget(this.options.command, this.options.args);
      const child = (this.options.spawnProcess ?? spawn)(target.command, target.args, {
        cwd: this.options.cwd,
        env: { ...process.env, ...(this.options.env ?? {}) },
        stdio: ["pipe", "pipe", "pipe"],
        // CREATE_NO_WINDOW (windowsHide) hides the child's own console AND —
        // unlike DETACHED_PROCESS — keeps every console-subsystem grandchild
        // windowless too. Do not add `detached: true` here: a detached child
        // has no console, so each grandchild (agy shell tool → pwsh, …)
        // allocates a fresh VISIBLE console and flashes a terminal window.
        windowsHide: true,
      });
      this.process = child as ChildProcessWithoutNullStreams;
      const output = createInterface({ input: child.stdout });
      output.on("line", (line) => this.handleLine(line));
      child.stderr.on("data", (chunk: Buffer | string) => {
        const text = safeText(String(chunk));
        if (text.trim()) {
          this.options.onDiagnostic(
            diagnostic(this.options, "turn", "stderr", "NATIVE_STDERR", text, this.correlationId),
          );
        }
      });
      child.on("error", (error) => {
        this.options.onDiagnostic(
          diagnostic(
            this.options,
            "start",
            "spawn",
            "RUNTIME_UNAVAILABLE",
            error.message,
            this.correlationId,
          ),
        );
        this.rejectPending(error);
      });
      child.on("exit", (code, signal) => {
        if (this.process !== child) return;
        const cleanExit = code === 0 || signal === "SIGINT" || signal === "SIGTERM";
        this.rejectPending(
          new Error(
            `Native process exited before pending response (${code ?? "null"}, ${signal ?? "none"}).`,
          ),
        );
        if (!this.disposed && !cleanExit) {
          this.options.onDiagnostic(
            diagnostic(
              this.options,
              "turn",
              "exit",
              "NATIVE_PROCESS_CRASHED",
              `Native process exited with code ${code ?? "null"} (${signal ?? "none"}).`,
              this.correlationId,
              { code, signal },
            ),
          );
        }
        if (!this.disposed && cleanExit && code !== 0) {
          this.options.onDiagnostic(
            diagnostic(
              this.options,
              "start",
              "exit",
              "RUNTIME_UNAVAILABLE",
              `Native process exited with code ${code}.`,
              this.correlationId,
              { code, signal },
            ),
          );
        }
        this.process = undefined;
        this.options.onProcessExit?.({ code, signal, cleanExit });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.onDiagnostic(
        diagnostic(
          this.options,
          "start",
          "spawn",
          "RUNTIME_UNAVAILABLE",
          message,
          this.correlationId,
        ),
      );
      this.rejectPending(error instanceof Error ? error : new Error(message));
    }
  }

  private handleLine(rawLine: string): void {
    const trimmed = rawLine.trim();
    if (!trimmed) return;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        this.options.onDiagnostic(
          diagnostic(
            this.options,
            "turn",
            "frame",
            "PROTOCOL_MISMATCH",
            "Non-object frame received from provider.",
            this.correlationId,
          ),
        );
        return;
      }
      const record = parsed as Record<string, unknown>;
      this.sequence += 1;
      // Handle JSON-RPC 2.0 response frames
      if (
        typeof record.id === "string" &&
        (record.result !== undefined || record.error !== undefined)
      ) {
        const pending = this.pendingRequests.get(record.id);
        if (pending) {
          this.pendingRequests.delete(record.id);
          if (record.error) {
            pending.reject(
              new Error(
                safeText((record.error as Record<string, unknown>).message ?? record.error),
              ),
            );
          } else {
            pending.resolve(record);
          }
        }
        const wireEvent: NativeWireEvent = {
          type: "jsonrpc.response",
          payload: record,
          sequence: this.sequence,
        };
        this.captureFrame(wireEvent);
        this.eventHandler?.(wireEvent);
        this.options.onEvent(wireEvent);
        return;
      }
      const type =
        typeof record.event === "string"
          ? record.event
          : typeof record.type === "string"
            ? record.type
            : typeof record.method === "string"
              ? record.method
              : "unknown";
      const payload =
        record.payload && typeof record.payload === "object" && !Array.isArray(record.payload)
          ? (record.payload as Record<string, unknown>)
          : record.params && typeof record.params === "object" && !Array.isArray(record.params)
            ? (record.params as Record<string, unknown>)
            : record;
      const wireEvent: NativeWireEvent = {
        type,
        payload,
        sequence: this.sequence,
      };
      this.captureFrame(wireEvent);
      this.eventHandler?.(wireEvent);
      this.options.onEvent(wireEvent);
    } catch {
      this.options.onDiagnostic(
        diagnostic(
          this.options,
          "turn",
          "parse",
          "PROTOCOL_MISMATCH",
          "Unparseable line received from native provider stdout.",
          this.correlationId,
        ),
      );
    }
  }

  send(payload: Record<string, unknown>): void {
    if (!this.process || this.disposed) {
      throw new Error("RUNTIME_UNAVAILABLE: native process is not running");
    }
    this.process.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  async sendRequest(
    message: {
      jsonrpc: "2.0";
      id: string;
      method: string;
      params?: Record<string, unknown>;
    },
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<Record<string, unknown>> {
    const id = message.id;
    const timeoutMs = options?.timeoutMs;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      let abortHandler: (() => void) | undefined;

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
        if (abortHandler && options?.signal) {
          options.signal.removeEventListener("abort", abortHandler);
          abortHandler = undefined;
        }
      };

      const handleResolve = (payload: Record<string, unknown>) => {
        cleanup();
        resolve(payload);
      };

      const handleReject = (error: Error) => {
        cleanup();
        reject(error);
      };

      if (options?.signal?.aborted) {
        reject(new Error("Request aborted."));
        return;
      }

      if (typeof timeoutMs === "number" && timeoutMs > 0 && Number.isFinite(timeoutMs)) {
        timer = setTimeout(() => {
          this.pendingRequests.delete(id);
          cleanup();
          const err = new Error(
            `RUNTIME_UNAVAILABLE: Request '${message.method}' timed out after ${timeoutMs}ms with no response.`,
          );
          this.options.onDiagnostic(
            diagnostic(
              this.options,
              message.method === "initialize"
                ? "readiness"
                : message.method === "shutdown"
                  ? "dispose"
                  : "turn",
              message.method,
              "RUNTIME_UNAVAILABLE",
              err.message,
              this.correlationId,
              { requestId: id },
            ),
          );
          reject(err);
        }, timeoutMs);
      }

      if (options?.signal) {
        abortHandler = () => {
          this.pendingRequests.delete(id);
          cleanup();
          reject(new Error("Request aborted."));
        };
        options.signal.addEventListener("abort", abortHandler, { once: true });
      }

      this.pendingRequests.set(id, { resolve: handleResolve, reject: handleReject });
      try {
        this.send(message);
      } catch (error) {
        this.pendingRequests.delete(id);
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  interrupt(): void {
    const child = this.process;
    if (!child || this.disposed) return;
    if (process.platform === "win32") {
      if (typeof child.pid === "number") terminateChildProcessTree(child);
      else child.kill();
    } else child.kill("SIGINT");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.wireCapture) {
      try {
        closeSync(this.wireCapture.fd);
      } catch {
        // Already closed.
      }
      this.wireCapture = undefined;
    }
    this.rejectPending(new Error("Native transport disposed."));
    const child = this.process;
    this.process = undefined;
    if (child && !child.killed) {
      if (process.platform === "win32" && typeof child.pid === "number") {
        terminateChildProcessTree(child);
      } else {
        child.kill();
      }
    }
  }

  private rejectPending(error: Error): void {
    if (this.pendingRequests.size === 0) return;
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}

export function createAntigravityStreamTransport(
  options: Omit<NativeProcessTransportOptions, "args"> & { args?: readonly string[] },
): NdjsonProcessTransport {
  return new NdjsonProcessTransport({
    ...options,
    args: [
      "--print=",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      ...(options.args ?? []),
    ],
  });
}

export function buildAntigravityStreamArgs(extraArgs: readonly string[] = []): string[] {
  return [
    "--print=",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    ...extraArgs,
  ];
}

export function buildDeepSeekJsonRpcArgs(
  profileRef = "sdk",
  extraArgs: readonly string[] = [],
): string[] {
  return ["--profile", profileRef, ...extraArgs];
}

/**
 * Profile-aware `dsh` argv mirroring the official SDK client's launch spec
 * (`--profile <name>` + caller extras + ordered `--patch <cordis>`).
 * The `acp` profile ships ready-to-use, so `configPath` is optional there;
 * the `sdk` profile still requires the caller to supply it (fail-closed at
 * the adapter layer, never invented here).
 */
export function buildDeepSeekProfileArgs(
  profileRef: string = "sdk",
  extraArgs: readonly string[] = [],
  configPath?: string,
): string[] {
  const name = profileRef.trim().toLowerCase() === "acp" ? "acp" : "sdk";
  const args = ["--profile", name, ...extraArgs];
  const trimmed = (configPath ?? "").trim();
  if (trimmed) args.push("--patch", trimmed);
  return args;
}

export function createDeepSeekJsonRpcTransport(
  options: NativeProcessTransportOptions,
): NdjsonProcessTransport {
  return new NdjsonProcessTransport(options);
}

export function nativeProcessDiagnostic(
  harnessKind: string,
  message: string,
): NativeHarnessDiagnostic {
  return {
    code: "RUNTIME_UNAVAILABLE",
    harnessKind,
    phase: "start",
    operation: "discovery",
    message: safeText(message),
    remediation: `Install and configure the official ${harnessKind} runtime before retrying.`,
    occurredAt: new Date().toISOString(),
  };
}

export function redactNativePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (SECRET_KEY.test(key)) {
      output[key] = "[REDACTED]";
    } else if (CONTENT_KEY.test(key)) {
      output[key] = contentSummary(value);
    } else if (typeof value === "string") {
      output[key] = safeText(value);
    } else if (Array.isArray(value)) {
      output[key] = value
        .slice(0, 32)
        .map((entry) =>
          entry && typeof entry === "object" && !Array.isArray(entry)
            ? redactNativePayload(entry as Record<string, unknown>)
            : typeof entry === "string"
              ? safeText(entry)
              : entry,
        );
    } else if (value && typeof value === "object") {
      output[key] = redactNativePayload(value as Record<string, unknown>);
    } else {
      output[key] = value;
    }
  }
  return output;
}
