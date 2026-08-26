import type { CraftPlan, RuntimeOverrides } from "./types";
import type { RuntimeEvent } from "../contracts/runtimeEvent";

export type EntityStatus = "spawned" | "running" | "idle" | "terminated" | "error";
export type CraftSessionStatus = "active" | "busy" | "idle" | "terminated" | "error";
export type TurnStatus = "idle" | "running" | "interrupted" | "completed" | "failed" | "cancelled";

export interface Entity {
  readonly id: string;
  readonly resultItemId: string;
  readonly craftPlan: CraftPlan;
  status: EntityStatus;
  readonly createdAt: string;
  metadata?: Record<string, unknown> | undefined;
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
  readonly effectiveOverrides?: RuntimeOverrides | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
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

export type SessionEventListener = (event: RuntimeEvent, snapshot: SessionSnapshot) => void;

export interface CraftSession {
  readonly id: string;
  readonly threadId?: string | undefined;
  readonly entityId: string;
  readonly sessionRef?: string | undefined;
  readonly status: CraftSessionStatus;

  /**
   * Start a new turn using the modern command/event/snapshot pattern.
   * Does NOT rely on a fixed 60-second completion timeout.
   */
  startTurn(command: StartTurnCommand): Promise<TurnResult>;

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
  supports(craftPlan: CraftPlan): boolean;
  spawnEntity(craftPlan: CraftPlan): Promise<Entity>;
  createSession(entity: Entity): Promise<CraftSession>;
  resumeSession(entity: Entity, sessionRef: string): Promise<CraftSession>;
}
