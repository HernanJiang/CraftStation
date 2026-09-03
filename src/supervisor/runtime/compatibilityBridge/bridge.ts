import { EventEmitter } from "node:events";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveExecutablePath } from "@/supervisor/agents/base/processRuntime";
import type {
  CompatibilityBridgeOptions,
  CompatibilityBridgeStatus,
  AccountPinConfig,
  SpawnFunction,
  FetchFunction,
} from "./types";

export class CompatibilityBridgeService extends EventEmitter {
  private running = false;
  private host: string;
  private port: number;
  private binaryPath: string | undefined;
  private authDir: string | undefined;
  private apiKey: string;
  private probeTimeoutMs: number;
  private process: ChildProcess | undefined;
  private pinnedAccount: AccountPinConfig | undefined;
  private spawnFn: SpawnFunction;
  private fetchFn: FetchFunction;
  private resolveBinaryFn: (command: string) => string | undefined;
  private stopTimeoutMs: number;
  private startupLogs: string[] = [];
  private configPath: string | undefined;

  constructor(options: CompatibilityBridgeOptions = {}) {
    super();
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 8317;
    this.binaryPath = options.binaryPath ?? process.env.CLIPROXY_BINARY_PATH;
    this.authDir = options.authDir;
    this.apiKey = options.apiKey ?? `cs-bridge-${randomUUID()}`;
    this.probeTimeoutMs = options.probeTimeoutMs ?? 5000;
    this.spawnFn = options.spawnFn ?? ((cmd, args, opts) => spawn(cmd, args, opts));
    this.fetchFn = options.fetchFn ?? ((url, init) => fetch(url, init));
    this.resolveBinaryFn = options.resolveBinaryFn ?? resolveExecutablePath;
    this.stopTimeoutMs = options.stopTimeoutMs ?? 5000;
  }

  getStatus(): CompatibilityBridgeStatus {
    return {
      running: this.running,
      host: this.host,
      port: this.port,
      endpoint: this.running ? `http://${this.host}:${this.port}` : undefined,
      pid: this.process?.pid,
      authDir: this.authDir,
      pinnedAccountId: this.pinnedAccount?.accountId,
      apiKey: this.running ? this.apiKey : undefined,
    };
  }

  pinAccount(config: AccountPinConfig): void {
    if (this.running && this.pinnedAccount && this.pinnedAccount.accountId !== config.accountId) {
      throw new Error(
        `Cannot re-pin running bridge to account ${config.accountId}; current pinned account is ${this.pinnedAccount.accountId}. Stop bridge before switching accounts.`,
      );
    }
    this.pinnedAccount = config;
    this.authDir = config.authDir;
  }

  getPinnedAccount(): AccountPinConfig | undefined {
    return this.pinnedAccount;
  }

  unpinAccount(): void {
    if (this.running) {
      throw new Error("Cannot unpin account while Compatibility Bridge is running.");
    }
    this.pinnedAccount = undefined;
    this.authDir = undefined;
  }

  private generateConfigFile(): string {
    const bridgeTempDir = join(tmpdir(), "craftstation-bridge");
    if (!existsSync(bridgeTempDir)) {
      mkdirSync(bridgeTempDir, { recursive: true });
    }
    const configFilePath = join(bridgeTempDir, `config-${this.port}.yaml`);
    const yamlContent = [
      `host: "${this.host}"`,
      `port: ${this.port}`,
      `auth-dir: "${this.authDir ?? ""}"`,
      `api-keys:`,
      `  - "${this.apiKey}"`,
      `debug: false`,
    ].join("\n");

    writeFileSync(configFilePath, yamlContent, "utf8");
    return configFilePath;
  }

  async start(): Promise<CompatibilityBridgeStatus> {
    if (this.running) {
      return this.getStatus();
    }

    this.startupLogs = [];
    const command =
      this.binaryPath ??
      this.resolveBinaryFn(process.platform === "win32" ? "cliproxyapi.exe" : "cliproxyapi");
    if (!command) {
      throw new Error(
        "CLIProxyAPI binary is unavailable. Configure CLIPROXY_BINARY_PATH or install the bundled sidecar.",
      );
    }

    this.configPath = this.generateConfigFile();

    // The reference CPA server documents config-file selection. Keep the
    // launch contract to that documented selector; host, port, auth-dir and
    // API keys are isolated in the generated config file.
    const args: string[] = ["--config", this.configPath];

    const spawnOptions: SpawnOptions = {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        CLIPROXY_HOST: this.host,
        CLIPROXY_PORT: String(this.port),
        CLIPROXY_API_KEY: this.apiKey,
        CLIPROXY_CONFIG: this.configPath,
        ...(this.authDir ? { CLIPROXY_AUTH_DIR: this.authDir } : {}),
      },
    };

    let proc: ChildProcess | undefined;
    try {
      proc = this.spawnFn(command, args, spawnOptions);
      this.process = proc;

      proc.stdout?.on("data", (chunk: Buffer | string) => {
        const text = chunk.toString();
        this.startupLogs.push(text);
        this.emit("log", { stream: "stdout", text });
      });

      proc.stderr?.on("data", (chunk: Buffer | string) => {
        const text = chunk.toString();
        this.startupLogs.push(text);
        this.emit("log", { stream: "stderr", text });
      });

      proc.on("error", (err) => {
        this.emit("error", err);
      });

      proc.on("exit", (code, signal) => {
        this.running = false;
        this.process = undefined;
        this.emit("exit", { code, signal });
      });
    } catch (spawnErr) {
      this.running = false;
      this.process = undefined;
      throw new Error(
        `Failed to launch CLIProxyAPI sidecar process: ${spawnErr instanceof Error ? spawnErr.message : String(spawnErr)}`,
        { cause: spawnErr },
      );
    }

    // Readiness probe
    const endpoint = `http://${this.host}:${this.port}`;
    const startTime = Date.now();
    let isReady = false;

    while (Date.now() - startTime < this.probeTimeoutMs) {
      if (this.process && this.process.exitCode !== null) {
        this.running = false;
        throw new Error(
          `Compatibility Bridge process exited prematurely with code ${this.process.exitCode}. Logs: ${this.startupLogs.join("\n")}`,
        );
      }

      try {
        const res = await this.fetchFn(`${endpoint}/health`, {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        });
        // Only the expected authenticated success response proves readiness.
        // A 404/401 merely proves that some HTTP server answered.
        if (res.status === 200) {
          isReady = true;
          break;
        }
      } catch {
        // Probe connection refused or not yet listening; backoff
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (!isReady) {
      await this.stop();
      throw new Error(
        `Compatibility Bridge failed to become ready at ${endpoint} within ${this.probeTimeoutMs}ms.`,
      );
    }

    this.running = true;
    this.emit("ready", this.getStatus());
    return this.getStatus();
  }

  async stop(): Promise<void> {
    const proc = this.process;
    if (proc) {
      const exited = new Promise<void>((resolve) => {
        if (proc.exitCode !== null) {
          resolve();
          return;
        }
        proc.once("exit", () => resolve());
      });
      this.process = undefined;
      try {
        proc.kill("SIGTERM");
      } catch {
        // ignore
      }
      await Promise.race([
        exited,
        new Promise<void>((resolve) => setTimeout(resolve, this.stopTimeoutMs)),
      ]);
      if (proc.exitCode === null) {
        try {
          proc.kill("SIGKILL");
        } catch {
          // ignore
        }
        await Promise.race([
          exited,
          new Promise<void>((resolve) => setTimeout(resolve, this.stopTimeoutMs)),
        ]);
      }
    }
    this.running = false;
    this.emit("stopped");
  }
}
