import type { CraftPlan, RuntimeOverrides } from "./types";
import type { RuntimeEvent } from "../contracts/runtimeEvent";

export type EntityStatus = "spawned" | "running" | "idle" | "terminated" | "error";
export type CraftSessionStatus = "active" | "busy" | "idle" | "terminated" | "error";
export type TurnStatus = "idle" | "running" | "interrupted" | "completed" | "failed" | "cancelled";

import type {
  NativeEventEnvelope,
  NativeHarnessDescriptor,
  NativeHarnessDiagnostic,
  NativeRuntimeExecutionConfig,
} from "./nativeHarness";

export interface Entity {
  readonly id: string;
  readonly resultItemId: string;
  readonly craftPlan: CraftPlan;
  status: EntityStatus;
  readonly createdAt: string;
  metadata?: Record<string, unknown> | undefined;
  readonly nativeHarness?: NativeHarnessDescriptor | undefined;
}

export interface PromptResult {
  response: string;
  events: RuntimeEvent[];
  error?: string | undefined;
}

export interface SessionSnapshot {
  readonly sessionId: string;
  readonly entityId: string;
  readonly threadId?: string | undefined;
  readonly status: CraftSessionStatus;
  readonly activeTurnId?: string | undefined;
  readonly activeTurnStatus?: TurnStatus | undefined;
  readonly events: readonly RuntimeEvent[];
  readonly nativeSessionRef?: string | undefined;
  readonly nativeEvents?: readonly NativeEventEnvelope[] | undefined;
  readonly diagnostics?: readonly NativeHarnessDiagnostic[] | undefined;
  /** Secret-free projection of the CraftPlan settings used by this session. */
  readonly runtimeConfig?: NativeRuntimeExecutionConfig | undefined;
  readonly effectiveOverrides?: RuntimeOverrides | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
  readonly routeType?: "native" | "compatibility" | undefined;
  readonly accountId?: string | undefined;
  readonly compatibilityProtocol?: string | undefined;
  readonly compatibilityBridgeEndpoint?: string | undefined;
}

export interface StartTurnCommand {
  readonly prompt: string;
  readonly turnId?: string | undefined;
  readonly overrides?: RuntimeOverrides | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface TurnResult {
  readonly turnId: string;
  readonly status: TurnStatus;
  readonly events: readonly RuntimeEvent[];
  readonly response?: string | undefined;
  readonly error?: string | undefined;
}

export type CraftRequestResolution =
  | {
      readonly kind: "permission";
      readonly response: "once" | "always" | "reject";
      /** Original ACP/UI option id (e.g. `allow-once`). OpenCode ignores this. */
      readonly optionId?: string | undefined;
      readonly message?: string | undefined;
    }
  | {
      readonly kind: "question";
      readonly action: "answer";
      /** One array of selected labels/custom values for each OpenCode question. */
      readonly answers: readonly (readonly string[])[];
    }
  | {
      readonly kind: "question";
      readonly action: "reject";
    };

export type SessionEventListener = (event: RuntimeEvent, snapshot: SessionSnapshot) => void;

export interface CraftSession {
  readonly id: string;
  readonly threadId?: string | undefined;
  readonly entityId: string;
  readonly sessionRef?: string | undefined;
  readonly nativeSessionRef?: string | undefined;
  readonly status: CraftSessionStatus;

  /**
   * Start a new turn using the modern command/event/snapshot pattern.
   * Does NOT rely on a fixed 60-second completion timeout.
   */
  startTurn(command: StartTurnCommand): Promise<TurnResult>;

  /**
   * Respond to a permission request or user input question.
   */
  respondToRequest?(requestId: string, resolution: CraftRequestResolution): Promise<void>;

  /**
   * Interrupt the active turn if currently running.
   */
  interrupt(turnId?: string): Promise<void>;

  /**
   * Steer the active turn with mid-flight instructions.
   */
  steer?(instructions: string): Promise<void>;

  /**
   * Terminate the session and free resources.
   */
  terminate(): Promise<void>;

  /**
   * Get the current snapshot of the session.
   */
  getSnapshot(): SessionSnapshot;

  /**
   * Provider-native diagnostics are optional on the compatibility seam. The
   * canonical session/event contract remains usable when an adapter has no
   * extra diagnostic records.
   */
  getDiagnostics?(): readonly NativeHarnessDiagnostic[];

  /** Delegate session summarization/compaction to the native runtime. */
  summarize?(): Promise<void>;

  /** Read provider-owned message history through the native runtime API. */
  readMessages?(): Promise<readonly unknown[]>;

  /**
   * Subscribe to real-time runtime events emitted by this session.
   */
  subscribe(listener: SessionEventListener): () => void;

  /**
   * Backward-compatible helper for legacy single-string response callers.
   */
  sendPrompt(
    prompt: string,
    onEvent?: (event: RuntimeEvent) => void,
    timeoutMs?: number | undefined,
  ): Promise<PromptResult>;
}

export interface HarnessRuntimeAdapter {
  readonly id: string;
  readonly harnessKind: string;
  readonly descriptor?: NativeHarnessDescriptor | undefined;
  supports(craftPlan: CraftPlan): boolean;
  spawnEntity(craftPlan: CraftPlan): Promise<Entity>;
  createSession(entity: Entity): Promise<CraftSession>;
  resumeSession(entity: Entity, sessionRef: string): Promise<CraftSession>;
  getDiagnostics?(): readonly NativeHarnessDiagnostic[];
  /** Release adapter-owned transports or provider processes after its Session is gone. */
  dispose?(): Promise<void>;
}
