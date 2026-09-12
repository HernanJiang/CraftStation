import { randomUUID } from "node:crypto";
import type {
  AgentStatusesResponse,
  Project,
  ProjectLocation,
  RemoteThreadCommand,
  ScheduledTask,
  ScheduledTaskRun,
  StartThreadPayload,
  Thread,
  ThreadConfig,
  ThreadStatus,
} from "@/shared/contracts";
import type { SharedSettings } from "@/shared/settings";
import { DEFAULT_TERMINAL_SIZE, resolveMcpLaunchSnapshot } from "@/shared/contracts";
import type { SupervisorEvent } from "@/shared/ipc";
import type { CraftAgentPayload, CraftAgentResult } from "@/shared/ipc/schemas";
import type { ScheduleRunPatch } from "../db/scheduleRuns";
import { resolveUnrestrictedThreadPermissions } from "../threads/threadLaunchConfig";
import type { ScheduleRunInvocation } from "./ScheduleCapability";
import {
  resolveScheduleExecution,
  type ScheduleLaunchMode,
  type ThreadContextSnapshot,
} from "./ScheduleExecutionResolver";
import { scheduleThreadTarget } from "@/shared/schedules";

/**
 * A `thread-state` transition ends the run only once the turn fully settles.
 * `needs_approval`/`needs_reply` are mid-turn pauses (they can resume under
 * auto-approval), so — matching {@link isThreadTurnActive} — they are NOT
 * treated as terminal here; that avoids settling a run while its thread keeps
 * working.
 */
const TERMINAL_STATUSES: ReadonlySet<ThreadStatus> = new Set<ThreadStatus>([
  "idle",
  "finished",
  "inactive",
  "error",
]);

/** Max inherited context characters prepended to a scheduled prompt. */
const MAX_INHERITED_CONTEXT_CHARS = 4_000;

export interface ScheduleRunCoordinatorDeps {
  /** Launch the child session in the supervisor (main → supervisor request). */
  startThread(payload: StartThreadPayload): Promise<unknown>;
  /** Cached agent detection for the given WSL distros (supervisor request). */
  getAgentStatuses(wslDistros: string[]): Promise<AgentStatusesResponse>;
  /** Mirror a thread command to the renderer store; false when no window is up. */
  sendThreadCommand(command: RemoteThreadCommand): boolean;
  /** Resolve (creating if absent) the persisted home-scope project row. */
  ensureHomeProject(): Project;
  /** Resolve a persisted project row by id, or null when it no longer exists. */
  getProject(projectId: string): Project | null;
  /** Current global MCP settings; optional for isolated tests/embedders. */
  getSharedSettings(): SharedSettings;
  upsertThread(thread: Thread, sortOrder: number): void;
  deleteThread(threadId: string): void;
  threadExists(threadId: string): boolean;
  insertRun(run: ScheduledTaskRun): void;
  updateRun(id: string, patch: ScheduleRunPatch): void;
  /** Read a thread row for continuation; required only when schedules use targetThreadId. */
  getThread?(threadId: string): Thread | null;
  /**
   * Summarized conversation context of an existing thread (user/assistant text,
   * newest-last, already truncated). When absent the coordinator falls back to
   * the source thread's title only. The harness native session is NEVER reused:
   * this text is the only thing carried over.
   */
  getThreadContextText?(threadId: string): string | null;
  /** Last assistant text for the run's thread; null when the runtime has none. */
  getThreadTerminalResult?(threadId: string): string | null;
  /**
   * Follow-up turn on an already-persisted thread (same-thread schedule
   * continuation). Wired to the supervisor's `sendThreadInput` seam. When
   * absent — or when the bound thread is missing/busy/archived — the run
   * falls back to a fresh thread with inherited context text.
   */
  sendFollowUp?(input: { threadId: string; prompt: string; config: ThreadConfig }): Promise<void>;
  /**
   * Native CraftPlan launcher. When omitted, even a native-resolved plan falls
   * back to the isolated legacy startThread path.
   */
  craftAgent?(payload: CraftAgentPayload): Promise<CraftAgentResult>;
  resolveExecution?(input: {
    task: ScheduledTask;
    runThreadId: string;
    workspace?: string;
    contextSnapshot: ThreadContextSnapshot | null;
  }): ScheduleLaunchMode;
  now?: () => number;
  newId?: () => string;
}

interface PendingRun {
  runId: string;
  sawActive: boolean;
  resolve: (summary: string | null) => void;
  reject: (error: Error) => void;
}

/**
 * Runs a scheduled task as a REAL GUI thread (persisted, sidebar-visible)
 * instead of a headless one-shot prompt, and records a run-history row linked
 * to that thread.
 *
 * Start ordering mirrors the proven remote-start path: persist the
 * thread row first, mirror it to the renderer (`launchRuntime: false`,
 * `focus: false`), then call the supervisor's `startThread`. The returned
 * promise settles when the thread's turn ends (observed via `thread-state`),
 * so the caller's `ScheduleService.settle` keeps working unchanged.
 *
 * Thread continuation: when the task targets an existing thread and that
 * thread is idle, the run continues INSIDE the same thread as a follow-up
 * turn (same native session via `sendFollowUp`) — no new sidebar thread, no
 * new schedule. Otherwise the run falls back to a FRESH thread id with only
 * conversation history/context text inherited into the new prompt; Codex
 * sessions, OpenCode SDK sessions, ACP connections and process handles are
 * never reused across runs or across harnesses on that path.
 */
export class ScheduleRunCoordinator {
  private readonly pending = new Map<string, PendingRun>();

  constructor(private readonly deps: ScheduleRunCoordinatorDeps) {}

  /** Wire into the supervisor event tap (main.ts `onEvent`). */
  observeSupervisorEvent(event: SupervisorEvent): void {
    if (event.type !== "thread-state") return;
    const run = this.pending.get(event.threadId);
    if (!run) return;

    if (event.status === "launching" || event.status === "working") {
      run.sawActive = true;
      return;
    }
    if (event.status === "needs_approval" || event.status === "needs_reply") {
      // Mid-turn pause — the turn is still active; wait for a terminal state.
      return;
    }
    if (!TERMINAL_STATUSES.has(event.status)) return;
    // "inactive" before the run ever became active is a stale pre-launch echo.
    if (event.status === "inactive" && !run.sawActive) return;

    this.pending.delete(event.threadId);
    const completedAt = this.nowIso();
    if (event.status === "error") {
      const error = event.errorMessage ?? "Scheduled run failed.";
      this.deps.updateRun(run.runId, { completedAt, status: "failed", error });
      run.reject(new Error(error));
      return;
    }
    const summary = this.deps.getThreadTerminalResult?.(event.threadId) ?? null;
    this.deps.updateRun(run.runId, { completedAt, status: "succeeded", summary });
    run.resolve(summary);
  }

  async runScheduleAsThread(
    task: ScheduledTask,
    invocation: ScheduleRunInvocation = { triggeredBy: "scheduled", occurrenceAt: null },
  ): Promise<string | null> {
    const project = this.resolveProject(task);
    const contextSnapshot = this.resolveContextSnapshot(task);
    // Thread-bound schedules (threadTarget existing) continue in the SAME
    // thread when it still exists, is idle, and the follow-up seam is wired.
    // Otherwise fall back to the historical fresh-thread + inherited-text path
    // so a busy/missing/archived thread never drops the run.
    const reuseThreadId = this.resolveReusableThreadId(task);
    if (reuseThreadId) {
      const reused = await this.runScheduleAsFollowUp(task, reuseThreadId, invocation, project);
      if (reused.handled) return reused.summary;
    }
    const threadId = (this.deps.newId ?? randomUUID)();
    const nowIso = this.nowIso();
    const workspace = projectLocationWorkspace(project.location);
    const launch = (this.deps.resolveExecution ?? resolveScheduleExecution)({
      task,
      runThreadId: threadId,
      ...(workspace ? { workspace } : {}),
      contextSnapshot,
    });
    const prompt = launch.prompt;

    const config = await this.buildThreadConfig(task, project.location);
    const thread: Thread = {
      id: threadId,
      projectId: project.id,
      title: task.name,
      agentKind: task.agentKind,
      config,
      status: "launching",
      attention: "none",
      canResumeWithConfig: false,
      archived: false,
      done: false,
      starred: false,
      presentationMode: "gui",
      threadStatusSource: "server",
      createdAt: nowIso,
      updatedAt: nowIso,
      activeTurnStartedAt: nowIso,
      ...(launch.kind === "native"
        ? {
            compositionProvenance: {
              recipeId: launch.craftPlan.recipeId,
              recipeVersion: "1.0.0",
              craftedAt: launch.craftPlan.createdAt,
              ingredients: launch.craftPlan.ingredients,
              runtimeBinding: launch.craftPlan.runtimeBinding,
            },
          }
        : {}),
    };

    const existed = this.deps.threadExists(threadId);
    // New rows sort to the top via a descending timestamp (same convention as
    // the orchestrator bridge and the remote-access server).
    this.deps.upsertThread(thread, -Date.now());

    // Mirror to the renderer; a forwarded title is authoritative and disables
    // AI title generation (the schedule name is the thread title). `false` from
    // sendThreadCommand (no window) is expected and must not fail the run.
    this.deps.sendThreadCommand({
      kind: "start",
      threadId,
      projectId: project.id,
      agentKind: task.agentKind,
      config,
      prompt,
      title: task.name,
      presentationMode: "gui",
      launchRuntime: false,
      focus: false,
    });

    const run: ScheduledTaskRun = {
      id: (this.deps.newId ?? randomUUID)(),
      scheduleId: task.id,
      threadId,
      occurrenceAt: invocation.occurrenceAt,
      triggeredBy: invocation.triggeredBy,
      queuedAt: nowIso,
      startedAt: nowIso,
      completedAt: null,
      status: "queued",
      summary: null,
      error: null,
      executionSnapshot: launch.snapshot,
    };
    this.deps.insertRun(run);
    this.deps.updateRun(run.id, { status: "running" });

    const mcpSnapshot = resolveMcpLaunchSnapshot(
      this.deps.getSharedSettings(),
      project.mcpServers ?? [],
    );

    if (launch.kind === "native" && this.deps.craftAgent) {
      try {
        const result = await this.deps.craftAgent({
          craftPlan: launch.craftPlan,
          projectLocation: project.location,
          prompt,
          ...(mcpSnapshot.mcpServers ? { mcpServers: mcpSnapshot.mcpServers } : {}),
        });
        const summary =
          result.response.trim() || this.deps.getThreadTerminalResult?.(threadId) || null;
        this.deps.updateRun(run.id, {
          completedAt: this.nowIso(),
          status: "succeeded",
          summary,
        });
        return summary;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.deps.updateRun(run.id, {
          completedAt: this.nowIso(),
          status: "failed",
          error: message,
        });
        if (!existed) {
          this.deps.deleteThread(threadId);
          this.deps.sendThreadCommand({ kind: "delete", threadId });
        }
        throw error instanceof Error ? error : new Error(message);
      }
    }

    const settled = new Promise<string | null>((resolve, reject) => {
      this.pending.set(threadId, { runId: run.id, sawActive: false, resolve, reject });
    });

    const startPayload: StartThreadPayload = {
      threadId,
      projectLocation: project.location,
      agentKind: task.agentKind,
      config,
      prompt,
      initialSize: DEFAULT_TERMINAL_SIZE,
      presentationMode: "gui",
      ...mcpSnapshot,
    };

    try {
      await this.deps.startThread(startPayload);
    } catch (error) {
      this.pending.delete(threadId);
      const message = error instanceof Error ? error.message : String(error);
      this.deps.updateRun(run.id, {
        completedAt: this.nowIso(),
        status: "failed",
        error: message,
      });
      // Roll back the fresh row (follow the orchestrator bridge): drop it from
      // the DB and tell the renderer to forget it, but keep a pre-existing row.
      if (!existed) {
        this.deps.deleteThread(threadId);
        this.deps.sendThreadCommand({ kind: "delete", threadId });
      }
      throw error instanceof Error ? error : new Error(message);
    }

    return settled;
  }

  /**
   * Thread id to reuse when the schedule is bound to an existing thread AND
   * that thread can take a follow-up turn right now. Returns null for fresh-
   * thread runs (detached schedules, missing/busy/archived threads, no
   * follow-up seam, or a colliding in-flight run on the same thread).
   */
  private resolveReusableThreadId(task: ScheduledTask): string | null {
    if (!this.deps.sendFollowUp) return null;
    const target = scheduleThreadTarget(task);
    if (target.kind !== "existing") return null;
    if (this.pending.has(target.threadId)) return null;
    const existing = this.deps.getThread?.(target.threadId) ?? null;
    if (!existing) return null;
    if (existing.archived || existing.done) return null;
    if (!TERMINAL_STATUSES.has(existing.status)) return null;
    return existing.id;
  }

  /**
   * Run one occurrence as a follow-up turn inside the bound thread. Returns
   * `{handled:false}` when the follow-up could not be delivered so the caller
   * falls back to a fresh thread; otherwise the run row is fully settled here.
   */
  private async runScheduleAsFollowUp(
    task: ScheduledTask,
    threadId: string,
    invocation: ScheduleRunInvocation,
    project: Project,
  ): Promise<{ handled: boolean; summary: string | null }> {
    const nowIso = this.nowIso();
    const workspace = projectLocationWorkspace(project.location);
    const launch = (this.deps.resolveExecution ?? resolveScheduleExecution)({
      task,
      runThreadId: threadId,
      ...(workspace ? { workspace } : {}),
      contextSnapshot: null,
    });
    const config = await this.buildThreadConfig(task, project.location);
    const run: ScheduledTaskRun = {
      id: (this.deps.newId ?? randomUUID)(),
      scheduleId: task.id,
      threadId,
      occurrenceAt: invocation.occurrenceAt,
      triggeredBy: invocation.triggeredBy,
      queuedAt: nowIso,
      startedAt: nowIso,
      completedAt: null,
      status: "queued",
      summary: null,
      error: null,
      executionSnapshot: launch.snapshot,
    };
    this.deps.insertRun(run);
    this.deps.updateRun(run.id, { status: "running" });
    // Bump the bound thread to the top without touching its title/config.
    const existing = this.deps.getThread?.(threadId);
    if (existing) {
      this.deps.upsertThread({ ...existing, updatedAt: nowIso }, -Date.now());
    }

    if (launch.kind === "native" && this.deps.craftAgent) {
      try {
        const mcpSnapshot = resolveMcpLaunchSnapshot(
          this.deps.getSharedSettings(),
          project.mcpServers ?? [],
        );
        const result = await this.deps.craftAgent({
          craftPlan: launch.craftPlan,
          projectLocation: project.location,
          prompt: launch.prompt,
          ...(mcpSnapshot.mcpServers ? { mcpServers: mcpSnapshot.mcpServers } : {}),
        });
        const summary =
          result.response.trim() || this.deps.getThreadTerminalResult?.(threadId) || null;
        this.deps.updateRun(run.id, {
          completedAt: this.nowIso(),
          status: "succeeded",
          summary,
        });
        return { handled: true, summary };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.deps.updateRun(run.id, {
          completedAt: this.nowIso(),
          status: "failed",
          error: message,
        });
        throw error instanceof Error ? error : new Error(message);
      }
    }

    const settled = new Promise<string | null>((resolve, reject) => {
      this.pending.set(threadId, { runId: run.id, sawActive: false, resolve, reject });
    });
    try {
      await this.deps.sendFollowUp!({ threadId, prompt: launch.prompt, config });
    } catch (error) {
      this.pending.delete(threadId);
      // Delivery failed (unknown/stale session, busy runtime, ...): let the
      // caller retry as a fresh thread with inherited context instead of
      // failing the occurrence outright. Mark this attempt interrupted.
      this.deps.updateRun(run.id, {
        completedAt: this.nowIso(),
        status: "interrupted",
        error: error instanceof Error ? error.message : String(error),
      });
      return { handled: false, summary: null };
    }
    return { handled: true, summary: await settled };
  }

  /**
   * Fresh-thread fallback inherits persisted conversation text only. Native
   * session ids, ACP connections, and process handles stay behind. (The
   * same-thread follow-up path needs no snapshot — it continues the live
   * session directly.)
   */
  private resolveContextSnapshot(task: ScheduledTask): ThreadContextSnapshot | null {
    const target = scheduleThreadTarget(task);
    if (target.kind !== "existing") return null;
    const source = this.deps.getThread?.(target.threadId) ?? null;
    if (!source) {
      throw new Error("Schedule target thread no longer exists.");
    }
    const rawContext = this.deps.getThreadContextText?.(target.threadId) ?? null;
    const conversationText =
      rawContext != null && rawContext.length > MAX_INHERITED_CONTEXT_CHARS
        ? `${rawContext.slice(0, MAX_INHERITED_CONTEXT_CHARS)}…`
        : rawContext;
    return {
      threadId: source.id,
      title: source.title,
      projectId: source.projectId,
      sourceAgentKind: source.agentKind,
      conversationText,
    };
  }

  /**
   * Resolve the project the run's thread lives in. A null/absent `projectId`
   * uses the built-in Home scope; a set id must still reference an existing
   * project row — if the user deleted it, fail the run with a clear message so
   * they notice and can edit the schedule (rather than silently reverting to
   * Home).
   */
  private resolveProject(task: ScheduledTask): Project {
    if (task.projectId == null) return this.deps.ensureHomeProject();
    const project = this.deps.getProject(task.projectId);
    if (!project) throw new Error("Project no longer exists.");
    return project;
  }

  private async buildThreadConfig(
    task: ScheduledTask,
    location: ProjectLocation,
  ): Promise<ThreadConfig> {
    return {
      model: task.config.model,
      ...(task.config.effort !== undefined ? { effort: task.config.effort } : {}),
      ...(task.config.fast !== undefined ? { fast: task.config.fast } : {}),
      ...(await resolveUnrestrictedThreadPermissions(
        this.deps.getAgentStatuses,
        task.agentKind,
        location,
      )),
    };
  }

  private nowIso(): string {
    return new Date((this.deps.now ?? Date.now)()).toISOString();
  }
}

function projectLocationWorkspace(location: ProjectLocation): string | undefined {
  if (location.kind === "wsl") return location.linuxPath;
  return location.path;
}
