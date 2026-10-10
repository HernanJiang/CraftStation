import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { z } from "zod";
import { writeFileAtomic } from "@/shared/atomicFile";
import type {
  AgentEventIntent,
  GoalItemPayload,
  RuntimeEvent,
  ThreadGoalControl,
  UsageSpent,
} from "@/shared/contracts";
import type { SupervisorEvent } from "@/shared/ipc";

const goalSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  objective: z.string().min(1),
  status: z.enum(["active", "paused", "blocked", "complete", "budget_limited", "usage_limited"]),
  tokenBudget: z.number().int().nonnegative().nullable(),
  tokensUsed: z.number().nonnegative(),
  timeUsedSeconds: z.number().nonnegative(),
  iterations: z.number().int().nonnegative(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastReason: z.string().optional(),
  deferred: z.boolean().default(false),
  blockedReason: z.string().optional(),
  blockedTurns: z.array(z.string()).default([]),
  blockedIteration: z.number().optional(),
  usageCounters: z.record(z.string(), z.number()).default({}),
  usageSamples: z.array(z.string()).default([]),
});
export type HarnessGoal = z.infer<typeof goalSchema>;

export interface GoalRuntimeSnapshot {
  identity: string;
  idle: boolean;
  planMode: boolean;
  pendingInput: boolean;
  supportsContinuation: boolean;
}
interface GoalCoordinatorContext {
  path: string;
  emit(event: SupervisorEvent): void;
  snapshot(threadId: string): GoalRuntimeSnapshot | undefined;
  continueGoal(threadId: string, context: string): Promise<void>;
  stopForBudget?(threadId: string): Promise<void>;
  now?: () => number;
}
interface TurnObservation {
  turnId?: string;
  automatic: boolean;
  calledTool: boolean;
  finished: boolean;
  outcome?: "completed" | "failed" | "interrupted" | "cancelled";
  retrying?: boolean;
  pendingRequests: Set<string>;
}
const TOOL_ITEMS = new Set([
  "tool_call",
  "mcp_tool_call",
  "dynamic_tool_call",
  "command_execution",
  "file_change",
  "web_search",
  "image_view",
]);

/** Craft-Harness 拥有目标外围状态；Harness 继续拥有 Agent Loop、工具执行与压缩。 */
export class GoalCoordinator {
  private readonly goals = new Map<string, HarnessGoal>();
  private readonly turns = new Map<string, TurnObservation>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly heldInputs = new Set<string>();
  private readonly usageCounters = new Map<string, number>();
  private readonly seenSamples = new Set<string>();
  private disposed = false;
  private unreadableState = false;

  constructor(private readonly ctx: GoalCoordinatorContext) {
    if (existsSync(ctx.path)) {
      try {
        const parsed = z.array(goalSchema).parse(JSON.parse(readFileSync(ctx.path, "utf8")));
        for (const goal of parsed) {
          this.goals.set(goal.threadId, goal);
          for (const [key, counter] of Object.entries(goal.usageCounters))
            this.usageCounters.set(key, counter);
          for (const sample of goal.usageSamples) this.seenSamples.add(sample);
        }
      } catch {
        // 保留损坏文件用于恢复；目标文件不能阻止整个桌面应用启动。
        this.goals.clear();
        try {
          renameSync(ctx.path, `${ctx.path}.invalid-${Date.now()}`);
        } catch {
          this.unreadableState = true;
        }
        console.error("[craft-harness]", {
          phase: "goal",
          operation: "restore",
          status: "failed",
          code: "GOAL_STATE_INVALID",
          reason: "目标文件已保留，请检查 goals.json.invalid-* 备份。",
        });
      }
    }
  }

  get(threadId: string): HarnessGoal | null {
    const goal = this.goals.get(threadId);
    return goal
      ? {
          ...goal,
          blockedTurns: [...goal.blockedTurns],
          usageCounters: { ...goal.usageCounters },
          usageSamples: [...goal.usageSamples],
        }
      : null;
  }

  control(threadId: string, control: ThreadGoalControl): void {
    this.cancelTimer(threadId);
    if (control.action === "hold") {
      if (control.pending) this.heldInputs.add(threadId);
      else {
        this.heldInputs.delete(threadId);
        this.schedule(threadId);
      }
      return;
    }
    const old = this.goals.get(threadId);
    if (control.action === "clear") {
      this.goals.delete(threadId);
      this.save();
      if (old) this.publish({ ...old, status: "paused", updatedAt: this.now() }, "cleared");
      return;
    }
    if (control.action === "edit") {
      const objective = control.objective.trim();
      if (!objective) throw new Error("GOAL_OBJECTIVE_EMPTY");
      // 每次普通提交重新注册相同目标时，保留完成/停止状态和计数。
      if (old?.objective === objective && control.reassert && control.tokenBudget === undefined) {
        this.publish(old);
        return;
      }
      const now = this.now();
      const checkpoint =
        !old &&
        control.reassert &&
        control.checkpoint?.objective.replace(/\s+/g, " ").trim() ===
          objective.replace(/\s+/g, " ").trim()
          ? control.checkpoint
          : undefined;
      const goal: HarnessGoal = {
        id: randomUUID(),
        threadId,
        objective,
        status: "active",
        tokenBudget: control.tokenBudget ?? null,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        iterations: 0,
        createdAt: now,
        updatedAt: now,
        deferred: false,
        blockedTurns: [],
        usageCounters: Object.fromEntries(
          [...this.usageCounters].filter(([key]) => JSON.parse(key)[0] === threadId),
        ),
        usageSamples: old?.usageSamples ?? [],
      };
      if (checkpoint) {
        goal.status =
          checkpoint.status === "failed"
            ? "blocked"
            : checkpoint.status === "cancelled"
              ? "paused"
              : checkpoint.status;
        goal.tokenBudget = checkpoint.tokenBudget ?? goal.tokenBudget;
        goal.tokensUsed = checkpoint.tokensUsed ?? 0;
        goal.timeUsedSeconds = checkpoint.timeUsedSeconds ?? 0;
        goal.iterations = checkpoint.iterations ?? 0;
        goal.deferred = checkpoint.deferred ?? false;
        goal.lastReason = checkpoint.lastReason;
        // Legacy Codex maps usageLimited to budget_limited as well. A quota
        // stop still has no token budget, or has remaining budget to resume.
        if (
          goal.status === "budget_limited" &&
          (goal.tokenBudget === null || goal.tokensUsed < goal.tokenBudget)
        ) {
          goal.status = "usage_limited";
          goal.lastReason ??= "原账号额度不足；恢复额度后可继续目标。";
        }
        if (
          goal.status === "active" &&
          goal.tokenBudget !== null &&
          goal.tokensUsed >= goal.tokenBudget
        )
          goal.status = "budget_limited";
      }
      this.goals.set(threadId, goal);
      this.save();
      this.publish(goal, "set");
      this.schedule(threadId);
      return;
    }
    if (!old) throw new Error("GOAL_NOT_FOUND：当前线程没有目标。");
    this.accountTime(old);
    if (control.action === "pause") old.status = "paused";
    else {
      if (old.status === "complete") throw new Error("GOAL_ALREADY_COMPLETE：请设置新目标。");
      if (old.tokenBudget !== null && old.tokensUsed >= old.tokenBudget) {
        throw new Error("GOAL_BUDGET_EXHAUSTED：请调整目标预算后继续。");
      }
      old.status = "active";
      old.deferred = false;
      old.blockedTurns = [];
      this.turns.delete(threadId);
      delete old.blockedReason;
      delete old.lastReason;
    }
    this.save();
    this.publish(old);
    this.schedule(threadId);
  }

  /** 模型只可完成或经过连续三轮同一阻塞审计后报告 blocked。 */
  update(threadId: string, status: "complete" | "blocked", reason: string): HarnessGoal {
    const goal = this.goals.get(threadId);
    if (!goal || goal.status !== "active") throw new Error("GOAL_NOT_ACTIVE");
    const evidence = reason.trim();
    if (!evidence) throw new Error("GOAL_EVIDENCE_REQUIRED：请提供完成验证或具体阻塞证据。");
    if (status === "blocked") {
      const turnId = this.turns.get(threadId)?.turnId;
      if (!turnId) throw new Error("GOAL_BLOCKED_AUDIT_REQUIRES_TURN");
      const normalized = evidence.replace(/\s+/g, " ").toLowerCase();
      if (
        goal.blockedReason !== normalized ||
        (goal.blockedIteration !== undefined && goal.iterations > goal.blockedIteration + 1)
      ) {
        goal.blockedReason = normalized;
        goal.blockedTurns = [];
      }
      if (!goal.blockedTurns.includes(turnId)) goal.blockedTurns.push(turnId);
      goal.blockedIteration = goal.iterations;
      goal.lastReason = evidence;
      this.save();
      if (goal.blockedTurns.length < 3) {
        throw new Error(
          `GOAL_BLOCKED_AUDIT_PENDING：同一阻塞已确认 ${goal.blockedTurns.length}/3 个回合；继续检查可推进的工作，下轮再报告同一阻塞。`,
        );
      }
    }
    this.accountTime(goal);
    goal.status = status;
    goal.lastReason = evidence;
    this.cancelTimer(threadId);
    this.save();
    this.publish(goal);
    return this.get(threadId)!;
  }

  onUserInput(threadId: string): void {
    this.cancelTimer(threadId);
    const turn = this.turns.get(threadId);
    if (turn?.finished) this.turns.delete(threadId);
    const goal = this.goals.get(threadId);
    if (goal) {
      goal.deferred = false;
      this.save();
    }
  }

  observeHook(threadId: string, intent: AgentEventIntent, extra?: Record<string, unknown>): void {
    if (intent === "session.turn_started") {
      const current = this.turns.get(threadId);
      if (!current?.turnId || current.finished) {
        this.observeRuntime(threadId, {
          type: "turn.started",
          threadId,
          turnId: `cli-goal:${randomUUID()}`,
        });
      }
      if (
        extra?.tool ||
        (typeof extra?.agentNativeEvent === "string" && /tool/i.test(extra.agentNativeEvent))
      )
        this.noteToolCall(threadId);
    } else if (intent === "session.turn_finished") {
      const turnId = this.turns.get(threadId)?.turnId;
      if (turnId)
        this.observeRuntime(threadId, {
          type: "turn.completed",
          threadId,
          turnId,
          state: "completed",
        });
    } else if (intent === "session.turn_errored") this.onFailure(threadId);
  }

  noteToolCall(threadId: string): void {
    const turn = this.turns.get(threadId);
    if (turn) turn.calledTool = true;
  }

  onFailure(threadId: string, code = "GOAL_TURN_FAILED"): void {
    const goal = this.goals.get(threadId);
    if (!goal || goal.status !== "active") return;
    this.accountTime(goal);
    goal.status = code === "GOAL_USAGE_LIMIT" ? "usage_limited" : "blocked";
    goal.lastReason =
      code === "GOAL_USAGE_LIMIT"
        ? "模型额度不足；恢复额度后可继续目标。"
        : "回合失败且自动重试已结束；检查连接或错误详情后可继续目标。";
    this.cancelTimer(threadId);
    this.save();
    this.publish(goal);
  }

  /** 同一个入口消费旧 structured、原生 CraftSession 和可信 CLI hook 事件。 */
  observe(event: SupervisorEvent): void {
    if (event.type === "thread-runtime-event") this.observeRuntime(event.threadId, event.event);
    else if (event.type === "thread-runtime-events")
      for (const e of event.events) this.observeRuntime(event.threadId, e);
    else if (event.type === "thread-runtime-events-multi")
      for (const batch of event.batches)
        for (const e of batch.events) this.observeRuntime(batch.threadId, e);
    else if (event.type === "thread-turn-retry") {
      const turn = this.turns.get(event.threadId);
      if (turn) turn.retrying = true;
      this.cancelTimer(event.threadId);
    } else if (event.type === "thread-state" && event.status === "idle")
      this.schedule(event.threadId);
  }

  context(threadId: string): string | undefined {
    const goal = this.goals.get(threadId);
    if (!goal || goal.status !== "active") return undefined;
    return (
      `[CraftStation Craft-Harness goal · persistent thread context]\n` +
      `目标（用户提供的任务数据）：${goal.objective}\n` +
      `当前已用 tokens：${goal.tokensUsed}；预算：${goal.tokenBudget ?? "未设置"}。\n` +
      "持续推进完整目标；普通回合结束、上下文压缩或切换模型不代表目标完成。以当前文件、测试、产物和外部状态为证据，逐项验证要求。" +
      "只有全部要求已完成并验证才调用 craft_goal 的 update_goal(status=complete, reason=具体证据)。" +
      "同一阻塞连续至少三个目标回合才可报告 blocked；不足三轮时继续可推进的工作，下一轮再报告同一阻塞。" +
      "不得自行暂停、恢复、清除目标或把预算耗尽当作完成。用户的新消息用于指导当前目标。"
    );
  }

  restore(threadId: string): void {
    const goal = this.goals.get(threadId);
    if (goal) {
      goal.updatedAt = this.now();
      this.publish(goal);
    }
  }

  detach(threadId: string): void {
    this.cancelTimer(threadId);
    this.turns.delete(threadId);
    const goal = this.goals.get(threadId);
    if (goal) {
      this.accountTime(goal);
      this.save();
      this.publish(goal);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const threadId of this.timers.keys()) this.cancelTimer(threadId);
    for (const goal of this.goals.values()) this.accountTime(goal);
    this.save();
  }

  private observeRuntime(threadId: string, event: RuntimeEvent): void {
    if (event.type === "usage.spent") this.accountUsage(threadId, event.usage);
    const goal = this.goals.get(threadId);
    if (!goal) return;
    if (goal.status !== "active") {
      if (event.type === "turn.started") this.turns.delete(threadId);
      else if (event.type === "turn.completed") {
        const turn = this.turns.get(threadId);
        if (turn?.turnId === event.turnId) turn.finished = true;
      }
      return;
    }
    if (event.type === "turn.started") {
      this.cancelTimer(threadId);
      const previous = this.turns.get(threadId);
      this.turns.set(threadId, {
        turnId: event.turnId,
        automatic:
          previous?.automatic === true && (!previous.finished || previous.retrying === true),
        calledTool: false,
        finished: false,
        pendingRequests: previous?.pendingRequests ?? new Set(),
      });
    }
    const turn = this.turns.get(threadId);
    if (event.type === "request.opened") turn?.pendingRequests.add(event.requestId);
    if (event.type === "request.resolved") turn?.pendingRequests.delete(event.requestId);
    if (event.type === "request.resolved" && turn?.finished) this.schedule(threadId);
    if (event.type === "item.started" && TOOL_ITEMS.has(event.itemType) && turn)
      turn.calledTool = true;
    if (event.type !== "turn.completed" || !turn || turn.turnId !== event.turnId || turn.finished)
      return;
    turn.finished = true;
    turn.outcome = event.state;
    this.accountTime(goal);
    if (event.state === "interrupted" || event.state === "cancelled") {
      goal.status = "paused";
      goal.lastReason = "回合已中断，目标保留；可手动继续。";
    } else if (event.state === "completed") {
      goal.iterations++;
      if (turn.automatic && !turn.calledTool) {
        goal.deferred = true;
        goal.lastReason = "自动续跑回合没有工具调用，已停止自动续跑以避免空转；目标尚未完成。";
      }
    }
    this.save();
    this.publish(goal);
    if (event.state === "completed") this.schedule(threadId);
  }

  private accountUsage(threadId: string, usage: UsageSpent): void {
    const key = JSON.stringify([threadId, usage.scopeId, usage.epoch]);
    let delta = 0;
    if (usage.counterKind === "cumulative") {
      const old = this.usageCounters.get(key);
      delta = Math.max(0, usage.counter - (old ?? (usage.fresh ? 0 : usage.counter)));
      this.usageCounters.set(key, Math.max(old ?? 0, usage.counter));
    } else {
      const sample = JSON.stringify([key, usage.sampleId]);
      if (this.seenSamples.has(sample)) return;
      this.seenSamples.add(sample);
      delta = usage.counter;
    }
    const goal = this.goals.get(threadId);
    if (!goal) return;
    goal.usageCounters[key] = this.usageCounters.get(key) ?? usage.counter;
    if (usage.counterKind === "per-call")
      goal.usageSamples.push(JSON.stringify([key, usage.sampleId]));
    const finishing =
      (goal.status === "budget_limited" || goal.status === "complete") &&
      this.turns.get(threadId)?.finished === false;
    if (
      (goal.status !== "active" && !finishing) ||
      this.ctx.snapshot(threadId)?.planMode ||
      delta === 0
    )
      return;
    this.accountTime(goal);
    goal.tokensUsed += delta;
    if (
      goal.status === "active" &&
      goal.tokenBudget !== null &&
      goal.tokensUsed >= goal.tokenBudget
    ) {
      goal.status = "budget_limited";
      goal.lastReason = "目标预算已到达；保留当前回合收尾，不再自动续跑。目标尚未完成。";
      this.cancelTimer(threadId);
      void this.ctx
        .stopForBudget?.(threadId)
        .catch(() => this.log(threadId, "budget-stop", "failed", "GOAL_BUDGET_STOP_FAILED"));
    }
    this.save();
    this.publish(goal);
  }

  private schedule(threadId: string): void {
    const goal = this.goals.get(threadId);
    if (
      this.disposed ||
      !goal ||
      goal.status !== "active" ||
      goal.deferred ||
      this.timers.has(threadId)
    )
      return;
    const turn = this.turns.get(threadId);
    if (turn && (!turn.finished || (turn.outcome !== undefined && turn.outcome !== "completed")))
      return;
    // 给已接受的用户排队输入先取得回合；回调再次检查所有条件。
    const timer = setTimeout(() => {
      this.timers.delete(threadId);
      const current = this.goals.get(threadId);
      const runtime = this.ctx.snapshot(threadId);
      if (
        current !== goal ||
        current.status !== "active" ||
        current.deferred ||
        this.heldInputs.has(threadId)
      )
        return;
      if (
        !runtime?.idle ||
        runtime.planMode ||
        runtime.pendingInput ||
        !runtime.supportsContinuation ||
        this.turns.get(threadId)?.pendingRequests.size
      )
        return;
      const context = this.context(threadId);
      if (!context) return;
      this.turns.set(threadId, {
        automatic: true,
        calledTool: false,
        finished: false,
        pendingRequests: new Set(),
      });
      this.log(threadId, "continue", "started", "GOAL_CONTINUE");
      void this.ctx.continueGoal(threadId, context).catch(() => {
        if (
          this.ctx.snapshot(threadId)?.identity === runtime.identity &&
          this.goals.get(threadId) === current
        )
          this.onFailure(threadId);
      });
    }, 100);
    timer.unref?.();
    this.timers.set(threadId, timer);
  }

  private publish(goal: HarnessGoal, action: GoalItemPayload["action"] = "updated"): void {
    const status =
      goal.status === "blocked" || goal.status === "usage_limited" ? "failed" : goal.status;
    const payload: GoalItemPayload = {
      action,
      objective: goal.objective,
      status,
      tokenBudget: goal.tokenBudget,
      tokensUsed: goal.tokensUsed,
      timeUsedSeconds: goal.timeUsedSeconds,
      iterations: goal.iterations,
      updatedAt: goal.updatedAt / 1000,
      availableActions:
        goal.status === "complete"
          ? ["edit", "clear"]
          : goal.status === "active" && !goal.deferred
            ? ["edit", "pause", "clear"]
            : goal.status === "budget_limited"
              ? ["edit", "clear"]
              : ["edit", "resume", "clear"],
      ...(goal.lastReason ? { lastReason: goal.lastReason } : {}),
    };
    this.ctx.emit({
      type: "thread-runtime-event",
      threadId: goal.threadId,
      event: {
        type: "item.started",
        threadId: goal.threadId,
        itemId: `craft-goal:${goal.id}`,
        itemType: "goal",
        payload,
      },
    });
    this.ctx.emit({
      type: "thread-runtime-event",
      threadId: goal.threadId,
      event: {
        type: "item.updated",
        threadId: goal.threadId,
        itemId: `craft-goal:${goal.id}`,
        payload,
      },
    });
    this.ctx.emit({
      type: "thread-runtime-event",
      threadId: goal.threadId,
      event: {
        type: "item.completed",
        threadId: goal.threadId,
        itemId: `craft-goal:${goal.id}`,
      },
    });
    this.log(goal.threadId, action ?? "update", "completed", `GOAL_${goal.status.toUpperCase()}`);
  }
  private accountTime(goal: HarnessGoal): void {
    const now = this.now();
    if (goal.status === "active" && this.ctx.snapshot(goal.threadId))
      goal.timeUsedSeconds += Math.max(0, now - goal.updatedAt) / 1000;
    goal.updatedAt = now;
  }
  private cancelTimer(threadId: string): void {
    const timer = this.timers.get(threadId);
    if (timer) clearTimeout(timer);
    this.timers.delete(threadId);
  }
  private now(): number {
    return this.ctx.now?.() ?? Date.now();
  }
  private save(): void {
    if (this.unreadableState) {
      if (this.disposed) return;
      throw new Error("GOAL_STATE_INVALID：原目标文件无法备份，请检查文件权限后重试。");
    }
    writeFileAtomic(this.ctx.path, JSON.stringify([...this.goals.values()]), {
      encoding: "utf8",
      mode: 0o600,
    });
  }
  private log(threadId: string, operation: string, status: string, code: string): void {
    console.info("[craft-harness]", { phase: "goal", operation, status, code, threadId });
  }
}
