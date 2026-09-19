import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve as resolvePath, sep } from "node:path";
import type { ProjectLocation } from "@/shared/contracts";
import type { NativeHarnessDiagnostic } from "@/shared/crafting";
import { resolveAgentBinaryPath } from "@/supervisor/agents/binaryResolver";
import { buildOpenCodeServerCommand } from "@/supervisor/agents/opencode/argv";
import { terminateChildProcessTree } from "@/shared/processTree";
import { isOpenCodePrivateRuntimeEnvironmentKey } from "../privateRuntimeEnvironment";
import { buildOpenCodeNativeDiagnostic, safeMessage } from "./diagnostics";

export { safeMessage } from "./diagnostics";

export interface OpenCodeNativeClient {
  readonly session: {
    update?: (parameters: Record<string, unknown>) => Promise<{ data?: unknown }>;
    create: (parameters?: Record<string, unknown>) => Promise<{ data?: unknown }>;
    get: (parameters: Record<string, unknown>) => Promise<{ data?: unknown }>;
    promptAsync: (parameters: Record<string, unknown>) => Promise<{ data?: unknown }>;
    abort: (parameters: Record<string, unknown>) => Promise<{ data?: unknown }>;
    messages: (parameters: Record<string, unknown>) => Promise<{ data?: unknown }>;
    summarize: (parameters: Record<string, unknown>) => Promise<{ data?: unknown }>;
    delete: (parameters: Record<string, unknown>) => Promise<{ data?: unknown }>;
  };
  readonly permission: {
    reply: (parameters: Record<string, unknown>) => Promise<{ data?: unknown }>;
  };
  readonly question: {
    reply: (parameters: Record<string, unknown>) => Promise<{ data?: unknown }>;
    reject: (parameters: Record<string, unknown>) => Promise<{ data?: unknown }>;
  };
  readonly provider: {
    list: (parameters?: Record<string, unknown>) => Promise<{ data?: unknown }>;
    auth: (parameters?: Record<string, unknown>) => Promise<{ data?: unknown }>;
  };
  readonly global: {
    event: (options?: Record<string, unknown>) => Promise<{ stream: AsyncIterable<unknown> }>;
  };
}

export interface OpenCodeNativeTransportOptions {
  readonly projectLocation: ProjectLocation;
  readonly baseUrl?: string;
  readonly authorization?: string;
  readonly executablePath?: string;
  /** Supervisor-resolved provider environment; values stay process-private. */
  readonly serverEnvironment?: Readonly<Record<string, string>>;
  /** Supervisor-private account runtime root. Never expose this path over IPC. */
  readonly serverRuntimeRoot?: string;
  readonly spawnProcess?: typeof spawn;
  readonly clientFactory?: (baseUrl: string, authorization?: string) => OpenCodeNativeClient;
  readonly onDiagnostic?: (diagnostic: NativeHarnessDiagnostic) => void;
  readonly readyTimeoutMs?: number;
}

export interface OpenCodeNativeConnection {
  readonly client: OpenCodeNativeClient;
  readonly baseUrl: string;
  readonly correlationId: string;
  readonly child?: ChildProcessWithoutNullStreams;
  subscribe(onEvent: (event: unknown) => void): () => void;
  dispose(): Promise<void>;
}

type OpencodeSdkV2ClientModule = typeof import("@opencode-ai/sdk/v2/client");

// The OpenCode SDK only exposes `import` export conditions, so a bundler-
// rewritten require() inside the CJS supervisor bundle fails at load with
// ERR_PACKAGE_PATH_NOT_EXPORTED. Keeping the module id in a variable forces
// the native dynamic import() to survive CJS output.
const OPENCODE_SDK_V2_CLIENT_MODULE_ID = "@opencode-ai/sdk/v2/client";
let createOpencodeClientPromise:
  | Promise<OpencodeSdkV2ClientModule["createOpencodeClient"]>
  | undefined;

function loadCreateOpencodeClient(): Promise<OpencodeSdkV2ClientModule["createOpencodeClient"]> {
  createOpencodeClientPromise ??= import(OPENCODE_SDK_V2_CLIENT_MODULE_ID).then(
    (mod) => mod.createOpencodeClient,
  );
  return createOpencodeClientPromise;
}

function diagnostic(
  correlationId: string,
  options: OpenCodeNativeTransportOptions,
  operation: string,
  code: NativeHarnessDiagnostic["code"],
  message: string,
  details?: Record<string, unknown>,
): NativeHarnessDiagnostic {
  return buildOpenCodeNativeDiagnostic({
    code,
    operation,
    message,
    correlationId,
    ...(details ? { details } : {}),
    remediation:
      code === "RUNTIME_UNAVAILABLE"
        ? "Install the official OpenCode CLI and ensure opencode is available on PATH."
        : undefined,
  });
}

async function createClient(
  options: OpenCodeNativeTransportOptions,
  baseUrl: string,
  privateAuthorization?: string,
): Promise<OpenCodeNativeClient> {
  const authorization = options.authorization ?? privateAuthorization;
  if (options.clientFactory) return options.clientFactory(baseUrl, authorization);
  const createOpencodeClient = await loadCreateOpencodeClient();
  return createOpencodeClient({
    baseUrl,
    ...(authorization ? { headers: { Authorization: authorization } } : {}),
    throwOnError: true,
  }) as unknown as OpenCodeNativeClient;
}

function readyUrl(line: string): string | undefined {
  if (!line.toLowerCase().includes("opencode server listening")) return undefined;
  return /\bhttps?:\/\/[^\s]+/u.exec(line)?.[0];
}

const OPENCODE_SAFE_HOST_ENV = [
  "SystemRoot",
  "windir",
  "ComSpec",
  "PATHEXT",
  "Path",
  "PATH",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOMEDRIVE",
  "HOMEPATH",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "LANG",
  "LC_ALL",
  "TERM",
  "SHELL",
] as const;

function openCodeServerEnvironment(
  commandEnvironment: Record<string, string> | undefined,
  projectedEnvironment: Readonly<Record<string, string>> | undefined,
  runtimeRoot: string,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const name of OPENCODE_SAFE_HOST_ENV) {
    const value = commandEnvironment?.[name] ?? process.env[name];
    if (typeof value === "string" && value.length > 0) environment[name] = value;
  }
  for (const [name, value] of Object.entries(projectedEnvironment ?? {})) {
    if (!isOpenCodePrivateRuntimeEnvironmentKey(name)) environment[name] = value;
  }
  const configRoot = join(runtimeRoot, "config");
  const dataRoot = join(runtimeRoot, "data");
  const cacheRoot = join(runtimeRoot, "cache");
  const appDataRoot = join(runtimeRoot, "appdata");
  const localAppDataRoot = join(runtimeRoot, "local-appdata");
  for (const directory of [configRoot, dataRoot, cacheRoot, appDataRoot, localAppDataRoot]) {
    mkdirSync(directory, { recursive: true });
  }
  return {
    ...environment,
    HOME: runtimeRoot,
    USERPROFILE: runtimeRoot,
    APPDATA: appDataRoot,
    LOCALAPPDATA: localAppDataRoot,
    XDG_CONFIG_HOME: configRoot,
    XDG_DATA_HOME: dataRoot,
    XDG_CACHE_HOME: cacheRoot,
    OPENCODE_CONFIG_DIR: join(configRoot, "opencode"),
  };
}

/** Official `opencode serve` HTTP/SSE transport. It never starts the TUI. */
export class OpenCodeNativeTransport {
  readonly correlationId = randomUUID();
  private child: ChildProcessWithoutNullStreams | undefined;
  private startedAuthorization: string | undefined;
  private disposed = false;
  private readonly subscribers = new Set<(event: unknown) => void>();
  private eventAbort: AbortController | undefined;
  private temporaryRuntimeRoot: string | undefined;

  constructor(private readonly options: OpenCodeNativeTransportOptions) {}

  async connect(): Promise<OpenCodeNativeConnection> {
    if (this.disposed) throw new Error("OpenCode native transport is disposed.");
    const baseUrl = this.options.baseUrl ?? (await this.startServer());
    const client = await createClient(this.options, baseUrl, this.startedAuthorization);
    const connection: OpenCodeNativeConnection = {
      client,
      baseUrl,
      correlationId: this.correlationId,
      ...(this.child ? { child: this.child } : {}),
      subscribe: (onEvent) => this.subscribe(onEvent, client),
      dispose: () => this.dispose(),
    };
    return connection;
  }

  private async startServer(): Promise<string> {
    const executable =
      this.options.executablePath ??
      resolveAgentBinaryPath(this.options.projectLocation, "opencode");
    if (!executable) {
      const record = diagnostic(
        this.correlationId,
        this.options,
        "transport.discover",
        "RUNTIME_UNAVAILABLE",
        "Official OpenCode CLI was not discovered.",
      );
      this.options.onDiagnostic?.(record);
      throw new Error(`RUNTIME_UNAVAILABLE: ${record.message}`);
    }
    const spawnProcess = this.options.spawnProcess ?? spawn;
    const username = "craftstation";
    const password = randomUUID();
    const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    const command = buildOpenCodeServerCommand(this.options.projectLocation, executable, {
      ...(this.options.serverEnvironment ?? {}),
      OPENCODE_SERVER_USERNAME: username,
      OPENCODE_SERVER_PASSWORD: password,
    });
    const runtimeRoot =
      this.options.serverRuntimeRoot ??
      (this.temporaryRuntimeRoot ??= mkdtempSync(join(tmpdir(), "craftstation-opencode-native-")));
    const childEnvironment = openCodeServerEnvironment(
      command.env,
      {
        ...(this.options.serverEnvironment ?? {}),
        OPENCODE_SERVER_USERNAME: username,
        OPENCODE_SERVER_PASSWORD: password,
      },
      runtimeRoot,
    );
    const child = spawnProcess(command.command, command.args, {
      ...(command.cwd ? { cwd: command.cwd } : {}),
      env: childEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    }) as unknown as ChildProcessWithoutNullStreams;
    this.child = child;
    // The authorization value is retained only by the supervisor closure. It
    // is never put in a diagnostic, native envelope, or renderer projection.
    this.startedAuthorization = authorization;
    let output = "";
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const fail = (
        error: unknown,
        code: NativeHarnessDiagnostic["code"] = "RUNTIME_UNAVAILABLE",
      ) => {
        if (settled) return;
        settled = true;
        const message = safeMessage(error);
        this.options.onDiagnostic?.(
          diagnostic(this.correlationId, this.options, "server.start", code, message),
        );
        reject(new Error(`${code}: ${message}`));
      };
      const timer = setTimeout(
        () =>
          fail(
            `opencode serve did not announce an HTTP URL within ${this.options.readyTimeoutMs ?? 15_000}ms`,
          ),
        this.options.readyTimeoutMs ?? 15_000,
      );
      timer.unref?.();
      child.once("error", (error) => fail(error));
      child.once("exit", (code, signal) => {
        if (!settled) {
          fail(
            `opencode serve exited before ready (code=${String(code)}, signal=${String(signal)}).`,
          );
        } else if (!this.disposed) {
          // Terminal for this transport: the SSE stream will never produce
          // completion events again, so stop the reconnect loop instead of
          // spinning diagnostics forever. In-flight turns are failed by their
          // sessions watching the same exit; a future subscribe() restarts
          // the loop (and fails fast with honest connection errors).
          this.eventAbort?.abort();
          this.eventAbort = undefined;
          this.options.onDiagnostic?.(
            diagnostic(
              this.correlationId,
              this.options,
              "server.child-exit",
              "NATIVE_PROCESS_CRASHED",
              `opencode serve exited (code=${String(code)}, signal=${String(signal)}).`,
            ),
          );
        }
      });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        output = `${output}${chunk}`.slice(-16_000);
        for (const line of output.split(/\r?\n/u)) {
          const url = readyUrl(line);
          if (url && !settled) {
            settled = true;
            clearTimeout(timer);
            resolve(url.replace(/\/$/u, ""));
            return;
          }
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        output = `${output}${chunk}`.slice(-16_000);
      });
    });
  }

  private subscribe(onEvent: (event: unknown) => void, client: OpenCodeNativeClient): () => void {
    this.subscribers.add(onEvent);
    if (!this.eventAbort) {
      const abort = new AbortController();
      this.eventAbort = abort;
      void this.consumeEvents(client, abort);
    }
    return () => {
      this.subscribers.delete(onEvent);
      if (this.subscribers.size === 0) {
        this.eventAbort?.abort();
        this.eventAbort = undefined;
      }
    };
  }

  private async consumeEvents(client: OpenCodeNativeClient, abort: AbortController): Promise<void> {
    let reconnectDelay = 100;
    while (!abort.signal.aborted && this.subscribers.size > 0) {
      try {
        const result = await client.global.event({ signal: abort.signal });
        reconnectDelay = 100;
        for await (const event of result.stream) {
          if (abort.signal.aborted) return;
          for (const subscriber of this.subscribers) subscriber(event);
        }
      } catch (error) {
        if (abort.signal.aborted) return;
        this.options.onDiagnostic?.(
          diagnostic(
            this.correlationId,
            this.options,
            "sse.reconnect",
            "NATIVE_EXECUTION_FAILED",
            safeMessage(error),
          ),
        );
      }
      if (abort.signal.aborted || this.subscribers.size === 0) return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, reconnectDelay);
        abort.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
      reconnectDelay = Math.min(reconnectDelay * 2, 2_000);
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.eventAbort?.abort();
    this.eventAbort = undefined;
    this.subscribers.clear();
    this.startedAuthorization = undefined;
    const child = this.child;
    this.child = undefined;
    if (child && child.exitCode === null && !child.killed) {
      if (process.platform === "win32") {
        terminateChildProcessTree(child);
      } else if (typeof child.pid === "number") {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      } else {
        child.kill("SIGTERM");
      }
    }
    this.cleanupTemporaryRuntimeRoot();
  }

  private cleanupTemporaryRuntimeRoot(): void {
    const root = this.temporaryRuntimeRoot;
    this.temporaryRuntimeRoot = undefined;
    if (!root) return;
    const tempRoot = resolvePath(tmpdir());
    const resolvedRoot = resolvePath(root);
    const childPath = relative(tempRoot, resolvedRoot);
    if (
      childPath &&
      !isAbsolute(childPath) &&
      childPath !== ".." &&
      !childPath.startsWith(`..${sep}`)
    ) {
      rmSync(resolvedRoot, { recursive: true, force: true });
    }
  }
}
