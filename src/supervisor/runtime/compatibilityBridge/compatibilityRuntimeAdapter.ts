import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CraftPlan } from "@/shared/crafting/types";
import type { NativeHarnessDiagnostic } from "@/shared/crafting/nativeHarness";
import type { RuntimeEvent } from "@/shared/contracts/runtimeEvent";
import { CraftingError } from "@/shared/crafting/errors";
import type {
  Entity,
  CraftSession,
  CraftSessionStatus,
  SessionSnapshot,
  SessionEventListener,
  StartTurnCommand,
  TurnResult,
} from "@/shared/crafting/runtimeInterface";
import { resolveExecutablePath } from "@/supervisor/agents/base/processRuntime";
import { getWslCommand } from "@/supervisor/agents/base/shellBasics";
import { DEEPSEEK_ACP_ARGS } from "@/supervisor/agents/deepseek/detection";
import {
  applyMuseForeignLaunchArgs,
  buildMuseForeignChildEnv,
} from "@/supervisor/agents/muse/foreignEndpoint";
import { startMuseForeignGateway } from "@/supervisor/agents/muse/foreignGateway";
import { listWslDistroNames } from "@/supervisor/agents/muse/wslFallback";
import { CompatibilityBridgeService } from "./bridge";
import {
  exportCompatibilityForHarness,
  writeOpenCodeConfigFile,
  type TargetHarnessConfig,
} from "./exporters";
import type {
  AccountPinConfig,
  CompatibilityBridgeStatus,
  FetchFunction,
  SpawnFunction,
} from "./types";

const COMPATIBILITY_PROVIDER_ID = "craftstation-compat";

export interface CompatibilityRuntimeAdapterOptions {
  bridge: CompatibilityBridgeService;
  /** Account credential namespace pinned for the session scope, if any. */
  accountPin?: AccountPinConfig | undefined;
  spawnFn?: SpawnFunction | undefined;
  fetchFn?: FetchFunction | undefined;
  resolveBinaryFn?: ((command: string) => string | undefined) | undefined;
  /** Directory for the isolated OpenCode provider config file. */
  configDir?: string | undefined;
  /** Bounded window for the bridge model-catalog verification. */
  modelVerifyTimeoutMs?: number | undefined;
}

/**
 * Independent Compatibility runtime adapter: drives a real bridge-shaped
 * Agent Loop through the CLIProxyAPI sidecar and the official Target Harness
 * CLI. Native adapters never consume Compatibility configuration; this adapter
 * is the only production path for `routeType: "compatibility"` CraftPlans.
 *
 * Tracer target: OpenCode. The adapter starts the Bridge, verifies the sidecar
 * actually serves the planned model (`GET /v1/models`), exports an isolated
 * OpenCode provider config pointing at the Bridge, then launches the official
 * `opencode run` headless CLI and streams its canonical events back.
 */
export class CompatibilityRuntimeAdapter {
  readonly id = "compatibility-runtime";
  readonly harnessKind: string;
  private readonly bridge: CompatibilityBridgeService;
  private readonly options: CompatibilityRuntimeAdapterOptions;
  private readonly diagnostics: NativeHarnessDiagnostic[] = [];
  private readonly modelVerifyTimeoutMs: number;
  private started = false;

  constructor(harnessKind: string, options: CompatibilityRuntimeAdapterOptions) {
    this.harnessKind = harnessKind;
    this.bridge = options.bridge;
    this.options = options;
    this.modelVerifyTimeoutMs = options.modelVerifyTimeoutMs ?? 30_000;
  }

  supports(craftPlan: CraftPlan): boolean {
    return (
      craftPlan.runtimeBinding.routeType === "compatibility" &&
      craftPlan.runtimeBinding.harnessKind === this.harnessKind
    );
  }

  async spawnEntity(craftPlan: CraftPlan): Promise<Entity> {
    if (!this.supports(craftPlan)) {
      throw CraftingError.runtimeUnavailable(
        craftPlan.runtimeBinding.harnessKind,
        `Harness kind '${craftPlan.runtimeBinding.harnessKind}' is not supported by CompatibilityRuntimeAdapter`,
        "Select a supported compatibility target harness (tracer: opencode).",
      );
    }

    if (this.options.accountPin) {
      this.bridge.pinAccount(this.options.accountPin);
    }

    let status: CompatibilityBridgeStatus;
    try {
      status = await this.bridge.start();
    } catch (error) {
      throw CraftingError.runtimeUnavailable(
        this.harnessKind,
        `Compatibility Bridge failed to start: ${error instanceof Error ? error.message : String(error)}`,
        "Install or configure the CLIProxyAPI sidecar (CLIPROXY_BINARY_PATH) and retry.",
      );
    }
    this.started = true;

    const modelId = craftPlan.runtimeBinding.modelId;
    await this.verifyModelContract(status, modelId);

    const entity: Entity = {
      id: `entity:${this.harnessKind}-compat:${craftPlan.threadId ?? randomUUID()}`,
      resultItemId: craftPlan.resultItemId,
      craftPlan,
      status: "spawned",
      createdAt: new Date().toISOString(),
      metadata: {
        routeType: "compatibility",
        compatibilityProtocol:
          this.harnessKind === "muse"
            ? "responses"
            : this.harnessKind === "deepseek"
              ? "openai-compatible"
              : "openai-compatible",
        compatibilityBridgeEndpoint: status.endpoint,
        accountId: this.options.accountPin?.accountId,
        modelId,
      },
    };
    return entity;
  }

  async createSession(entity: Entity): Promise<CraftSession> {
    return this.createSessionHandle(entity);
  }

  async resumeSession(entity: Entity, sessionRef: string): Promise<CraftSession> {
    return this.createSessionHandle(entity, sessionRef);
  }

  async dispose(): Promise<void> {
    if (this.started) {
      await this.bridge.stop();
      this.started = false;
    }
  }

  getDiagnostics(): readonly NativeHarnessDiagnostic[] {
    return [...this.diagnostics];
  }

  private async verifyModelContract(
    status: CompatibilityBridgeStatus,
    modelId: string,
  ): Promise<void> {
    const fetchFn = this.options.fetchFn ?? ((url, init) => fetch(url, init));
    // The sidecar's model catalog fills in after its credential manager loads
    // the auth-dir; poll with a bounded window instead of racing startup.
    const deadline = Date.now() + this.modelVerifyTimeoutMs;
    let served: string[] = [];
    let lastError: unknown;

    while (Date.now() < deadline) {
      try {
        const res = await fetchFn(`${status.endpoint}/v1/models`, {
          headers: { Authorization: `Bearer ${status.apiKey ?? ""}` },
        });
        if (res.status !== 200) {
          throw new Error(`GET /v1/models returned ${res.status}`);
        }
        const payload = (await res.json()) as { data?: Array<{ id?: string }> };
        served = (payload.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
        if (served.includes(modelId)) {
          return;
        }
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw CraftingError.runtimeUnavailable(
      this.harnessKind,
      `Compatibility Bridge does not serve model '${modelId}'` +
        (served.length > 0
          ? `; served: ${served.slice(0, 8).join(", ")}.`
          : `; model catalog stayed empty${lastError ? ` (last error: ${lastError instanceof Error ? lastError.message : String(lastError)})` : ""}.`),
      "Verify the pinned account credential namespace actually serves the requested model.",
    );
  }

  private createSessionHandle(entity: Entity, nativeSessionRef?: string): CraftSession {
    if (!entity.metadata || entity.metadata.routeType !== "compatibility") {
      throw CraftingError.runtimeUnavailable(
        this.harnessKind,
        "Entity was not spawned by the Compatibility runtime adapter.",
      );
    }
    const bridgeStatus = this.bridge.getStatus();
    const targetConfig = exportCompatibilityForHarness(
      this.harnessKind,
      bridgeStatus,
      entity.craftPlan.runtimeBinding.modelId,
    );
    return new CompatibilitySession({
      entity,
      targetConfig,
      bridgeStatus,
      accountId: this.options.accountPin?.accountId,
      spawnFn: this.options.spawnFn,
      resolveBinaryFn: this.options.resolveBinaryFn,
      configDir: this.options.configDir,
      nativeSessionRef,
    });
  }
}

interface CompatibilitySessionOptions {
  entity: Entity;
  targetConfig: TargetHarnessConfig;
  bridgeStatus: CompatibilityBridgeStatus;
  accountId?: string | undefined;
  spawnFn?: SpawnFunction | undefined;
  resolveBinaryFn?: ((command: string) => string | undefined) | undefined;
  configDir?: string | undefined;
  nativeSessionRef?: string | undefined;
}

/**
 * Session handle over the official OpenCode CLI running headless against the
 * Compatibility Bridge. Each turn is one `opencode run --format json`
 * invocation; `sessionID` from the event stream becomes the provider-native
 * session ref so later turns resume the same provider session via `-s`.
 */
class CompatibilitySession implements CraftSession {
  readonly id = `compat-session:${randomUUID()}`;
  readonly entityId: string;
  readonly threadId: string | undefined;
  status: CraftSessionStatus = "active";
  nativeSessionRef: string | undefined;

  private readonly options: CompatibilitySessionOptions;
  private child: ChildProcess | undefined;
  private events: RuntimeEvent[] = [];
  private listeners = new Set<SessionEventListener>();
  private activeTurn: { turnId: string; cancelled: boolean } | undefined;
  /** Stable per-session directory: isolated provider config + child cwd. */
  private readonly configDir: string;
  private museGatewayClose: (() => void) | undefined;
  private museGatewayOrigin: string | undefined;

  constructor(options: CompatibilitySessionOptions) {
    this.options = options;
    this.entityId = options.entity.id;
    this.threadId = options.entity.craftPlan.threadId;
    this.nativeSessionRef = options.nativeSessionRef;
    this.configDir = options.configDir ?? join(tmpdir(), "craftstation-compat", randomUUID());
  }

  get sessionRef(): string | undefined {
    return this.nativeSessionRef;
  }

  async startTurn(command: StartTurnCommand): Promise<TurnResult> {
    if (this.status === "terminated") {
      throw new Error("Cannot start a turn on a terminated compatibility session.");
    }
    const turnId = command.turnId ?? `turn-${randomUUID()}`;
    this.activeTurn = { turnId, cancelled: false };
    this.status = "busy";
    this.emit({ type: "turn.started", threadId: this.threadId ?? "", turnId });

    const launch = await this.prepareTurnLaunch(command.prompt);
    const spawnFn = this.options.spawnFn ?? ((cmd, args_, opts) => spawn(cmd, args_, opts));
    const spawnOptions: SpawnOptions = {
      // stdin MUST be ignored: an open stdin pipe makes the headless CLI block
      // forever instead of running the prompt and exiting.
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      cwd: this.configDir,
      env: launch.env,
    };
    const executable = launch.executable;
    const args = launch.args;

    const collected: string[] = [];
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = spawnFn(executable, args, spawnOptions);
      } catch (error) {
        reject(error);
        return;
      }
      this.child = child;

      let stdoutBuffer = "";
      child.stdout?.on("data", (chunk: Buffer | string) => {
        stdoutBuffer += chunk.toString();
        if (!launch.parseOpenCodeJson) return;
        let newlineIndex = stdoutBuffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = stdoutBuffer.slice(0, newlineIndex).trim();
          stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
          if (line) this.consumeOpenCodeEvent(line, collected);
          newlineIndex = stdoutBuffer.indexOf("\n");
        }
      });
      child.on("exit", (code) => {
        if (!launch.parseOpenCodeJson) {
          const text = stdoutBuffer.trim();
          if (text) collected.push(text);
        }
        resolve(code);
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        const text = chunk.toString().trim();
        if (text) this.emit({ type: "warning", threadId: this.threadId ?? "", message: text });
      });
      child.on("error", reject);
      if (command.signal) {
        command.signal.addEventListener(
          "abort",
          () => {
            try {
              child.kill();
            } catch {
              // already gone
            }
          },
          { once: true },
        );
      }
    });

    const cancelled = this.activeTurn?.cancelled ?? false;
    this.activeTurn = undefined;
    const response = collected.join("\n");
    const failed = exitCode !== 0 && !cancelled;

    this.status = failed ? "error" : "idle";
    this.emit({
      type: "turn.completed",
      threadId: this.threadId ?? "",
      turnId,
      state: cancelled ? "cancelled" : failed ? "failed" : "completed",
    });

    return {
      turnId,
      status: cancelled ? "cancelled" : failed ? "failed" : "completed",
      events: [...this.events],
      ...(failed
        ? { error: `${this.options.targetConfig.harnessKind} exited with code ${exitCode}.` }
        : { response }),
    };
  }

  async sendPrompt(
    prompt: string,
    _onEvent?: ((event: RuntimeEvent) => void) | undefined,
    _timeoutMs?: number | undefined,
  ): Promise<{ response: string; events: RuntimeEvent[]; error?: string | undefined }> {
    const turn = await this.startTurn({ prompt });
    return {
      response: turn.response ?? turn.error ?? "",
      events: [...turn.events],
      error: turn.error,
    };
  }

  async interrupt(_turnId?: string): Promise<void> {
    if (this.activeTurn) this.activeTurn.cancelled = true;
    try {
      this.child?.kill();
    } catch {
      // already gone
    }
  }

  async terminate(): Promise<void> {
    this.status = "terminated";
    try {
      this.child?.kill();
    } catch {
      // already gone
    }
    try {
      this.museGatewayClose?.();
    } catch {
      // already gone
    }
    this.museGatewayClose = undefined;
    this.museGatewayOrigin = undefined;
    this.emit({ type: "session.exited", threadId: this.threadId ?? "", reason: "terminated" });
  }

  getSnapshot(): SessionSnapshot {
    return {
      sessionId: this.id,
      entityId: this.entityId,
      threadId: this.threadId,
      status: this.status,
      events: [...this.events],
      nativeSessionRef: this.nativeSessionRef,
      routeType: "compatibility",
      accountId: this.options.accountId,
      compatibilityProtocol: this.options.targetConfig.protocol,
      compatibilityBridgeEndpoint: this.options.bridgeStatus.endpoint,
      diagnostics: [],
    };
  }

  subscribe(listener: SessionEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private consumeOpenCodeEvent(line: string, collected: string[]): void {
    let parsed: {
      type?: string;
      sessionID?: string;
      part?: { id?: string; type?: string; text?: string };
    };
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (parsed.sessionID && !this.nativeSessionRef) {
      this.nativeSessionRef = parsed.sessionID;
    }
    if (parsed.type === "text" && typeof parsed.part?.text === "string") {
      collected.push(parsed.part.text);
      this.emit({
        type: "item.completed",
        threadId: this.threadId ?? "",
        itemId: parsed.part.id ?? `item-${randomUUID()}`,
        payload: { text: parsed.part.text },
      });
    }
  }

  private async prepareTurnLaunch(prompt: string): Promise<{
    executable: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    parseOpenCodeJson: boolean;
  }> {
    const kind = this.options.targetConfig.harnessKind;
    if (kind === "muse") return this.prepareMuseLaunch(prompt);
    if (kind === "deepseek") return this.prepareDeepseekLaunch();
    const configPath = this.writeIsolatedConfig();
    const args = [
      "run",
      "-m",
      `${COMPATIBILITY_PROVIDER_ID}/${this.options.targetConfig.model}`,
      "--format",
      "json",
      prompt,
    ];
    if (this.nativeSessionRef) args.push("-s", this.nativeSessionRef);
    return {
      executable: this.resolveHarnessBinary("opencode"),
      args,
      env: { ...process.env, OPENCODE_CONFIG: configPath },
      parseOpenCodeJson: true,
    };
  }

  private async prepareMuseLaunch(prompt: string): Promise<{
    executable: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    parseOpenCodeJson: boolean;
  }> {
    mkdirSync(this.configDir, { recursive: true });
    if (!this.museGatewayOrigin) {
      const gateway = await startMuseForeignGateway({
        upstreamBaseUrl: this.options.targetConfig.baseUrl,
        model: this.options.targetConfig.model,
      });
      this.museGatewayClose = gateway.close;
      this.museGatewayOrigin = `http://127.0.0.1:${gateway.port}`;
    }
    const origin = this.museGatewayOrigin;
    const childEnv = buildMuseForeignChildEnv({
      apiKey: this.options.targetConfig.apiKey,
      baseUrl: origin,
      isolationDir: this.configDir,
      model: this.options.targetConfig.model,
    });
    const museArgs = applyMuseForeignLaunchArgs(
      [
        "exec",
        "--no-session-log",
        "--trust-workspace",
        "--model",
        this.options.targetConfig.model,
        prompt,
      ],
      childEnv,
    );
    const { command, prefixArgs } = await this.resolveMuseCommand();
    return {
      executable: command,
      args: [...prefixArgs, ...museArgs],
      env: { ...process.env, ...childEnv, ...this.options.targetConfig.customEnv },
      parseOpenCodeJson: false,
    };
  }

  private prepareDeepseekLaunch(): {
    executable: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    parseOpenCodeJson: boolean;
  } {
    mkdirSync(this.configDir, { recursive: true });
    return {
      executable: this.resolveHarnessBinary("dsh"),
      args: [...DEEPSEEK_ACP_ARGS],
      env: { ...process.env, ...this.options.targetConfig.customEnv },
      parseOpenCodeJson: false,
    };
  }

  private async resolveMuseCommand(): Promise<{ command: string; prefixArgs: string[] }> {
    const resolved = this.resolveHarnessBinaryOptional("muse");
    if (resolved) return { command: resolved, prefixArgs: [] };
    if (process.platform === "win32") {
      const distro = (await listWslDistroNames())[0];
      if (distro) return { command: getWslCommand(), prefixArgs: ["-d", distro, "--", "muse"] };
    }
    throw CraftingError.runtimeUnavailable(
      "muse",
      "Official Muse Code CLI is unavailable on PATH.",
      "Install Muse Code, or on Windows install it inside WSL.",
    );
  }

  private writeIsolatedConfig(): string {
    mkdirSync(this.configDir, { recursive: true });
    return writeOpenCodeConfigFile(
      this.options.targetConfig,
      this.configDir,
      COMPATIBILITY_PROVIDER_ID,
    );
  }

  private resolveHarnessBinaryOptional(command: string): string | undefined {
    return this.options.resolveBinaryFn
      ? this.options.resolveBinaryFn(command)
      : resolveExecutablePath(command);
  }

  private resolveHarnessBinary(command: string): string {
    const resolved = this.resolveHarnessBinaryOptional(command);
    if (!resolved) {
      throw CraftingError.runtimeUnavailable(
        command,
        `Official ${command} CLI is unavailable on PATH.`,
        `Install ${command} or point the adapter at its binary.`,
      );
    }
    return resolved;
  }

  private emit(event: RuntimeEvent): void {
    this.events.push(event);
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(event, snapshot);
  }
}
