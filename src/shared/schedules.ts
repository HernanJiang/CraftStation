import type {
  ScheduleRecurrence,
  ScheduleThreadTarget,
  ScheduledTask,
  ScheduledTaskInput,
} from "./contracts";

export function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function zonedParts(ms: number, timeZone: string): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(new Date(ms));
  const get = (type: string): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return Number(part?.value.replace(/[^0-9]/g, "") ?? NaN);
  };
  const weekdayPart = parts.find((candidate) => candidate.type === "weekday")?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].findIndex((prefix) =>
    weekdayPart.startsWith(prefix),
  );
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    weekday: weekday < 0 ? new Date(ms).getDay() : weekday,
  };
}

/** Offset of `timeZone` at `utcMs`, in minutes east of UTC. */
function zoneOffsetMinutes(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return (asUtc - utcMs) / 60_000;
}

/** Interpret a wall-clock in `timeZone` as a UTC instant. */
function zonedWallToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  // Seed with the wall time read as UTC, then correct by the zone offset.
  // One refinement pass handles all non-pathological offsets/DST shifts.
  const seed = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const first = seed - zoneOffsetMinutes(seed, timeZone) * 60_000;
  const second = seed - zoneOffsetMinutes(first, timeZone) * 60_000;
  return second;
}

function nextWeeklyInTimeZone(
  days: Set<number>,
  hour: number,
  minute: number,
  afterMs: number,
  timeZone: string,
): string | null {
  // Walk zoned calendar days starting from the zoned date containing afterMs.
  const zoned = zonedParts(afterMs, timeZone);
  // Anchor midnight of the zoned day in UTC so day arithmetic stays in-zone.
  const anchorMidnightUtc = zonedWallToUtc(zoned.year, zoned.month, zoned.day, 0, 0, timeZone);
  for (let offset = 0; offset <= 8; offset += 1) {
    const dayBase = anchorMidnightUtc + offset * 86_400_000;
    const baseParts = zonedParts(dayBase + 12 * 3_600_000, timeZone);
    if (!days.has(baseParts.weekday)) continue;
    const candidate = zonedWallToUtc(baseParts.year, baseParts.month, baseParts.day, hour, minute, timeZone);
    if (candidate > afterMs) return new Date(candidate).toISOString();
  }
  return null;
}

function nextHourlyInTimeZone(minute: number, afterMs: number, timeZone: string): string | null {
  // Advance hour-by-hour in zoned wall-clock (covers DST gaps/skips honestly:
  // a nonexistent wall time resolves to the next valid instant).
  const probe = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  });
  void probe;
  let cursor = afterMs - (afterMs % 60_000) + 60_000;
  for (let step = 0; step < 4; step += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      hour12: false,
    }).formatToParts(new Date(cursor));
    const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const candidate = zonedWallToUtc(get("year"), get("month"), get("day"), get("hour"), minute, timeZone);
    if (candidate > afterMs) return new Date(candidate).toISOString();
    cursor += 3_600_000;
  }
  return null;
}

/** Canonical thread target. `threadTarget` wins over the legacy `targetThreadId`. */
export function normalizeScheduleThreadTarget(input: {
  threadTarget?: ScheduleThreadTarget | null | undefined;
  targetThreadId?: string | null | undefined;
}): { threadTarget: ScheduleThreadTarget; targetThreadId: string | null } {
  if (input.threadTarget?.kind === "existing") {
    return { threadTarget: input.threadTarget, targetThreadId: input.threadTarget.threadId };
  }
  if (input.threadTarget?.kind === "new") {
    return { threadTarget: { kind: "new" }, targetThreadId: null };
  }
  if (input.targetThreadId) {
    return {
      threadTarget: { kind: "existing", threadId: input.targetThreadId },
      targetThreadId: input.targetThreadId,
    };
  }
  return { threadTarget: { kind: "new" }, targetThreadId: null };
}

export function scheduleThreadTarget(
  task: Pick<ScheduledTaskInput, "threadTarget" | "targetThreadId">,
): ScheduleThreadTarget {
  return normalizeScheduleThreadTarget(task).threadTarget;
}

/**
 * A schedule is related to a thread when it was created from that thread
 * (`sourceThreadId`) or when future runs inherit that thread's context
 * (`threadTarget.kind === "existing"`). The two meanings stay independent.
 */
export function scheduleRelatesToThread(
  task: Pick<ScheduledTask, "sourceThreadId" | "targetThreadId" | "threadTarget">,
  threadId: string,
): boolean {
  if (task.sourceThreadId === threadId) return true;
  const target = scheduleThreadTarget(task);
  return target.kind === "existing" && target.threadId === threadId;
}

export function nextScheduleRunAt(
  recurrence: ScheduleRecurrence,
  afterMs: number,
  timezone?: string | null,
): string | null {
  if (recurrence.kind === "once") {
    const runAt = Date.parse(recurrence.runAt);
    return runAt > afterMs ? new Date(runAt).toISOString() : null;
  }

  if (recurrence.kind === "interval") {
    const stepMs = recurrence.everyMinutes * 60_000;
    if (!Number.isFinite(stepMs) || stepMs <= 0) return null;
    // Align to minute boundaries so ticks are stable across restarts:
    // next = smallest minute-aligned instant strictly after `afterMs`.
    const base = Math.floor(afterMs / 60_000) * 60_000 + stepMs;
    const steps = Math.max(0, Math.ceil((afterMs + 1 - base) / stepMs));
    return new Date(base + steps * stepMs).toISOString();
  }

  const timeZone = timezone ?? undefined;
  if (timeZone != null && !isValidTimeZone(timeZone)) return null;

  if (recurrence.kind === "hourly") {
    if (timeZone == null) {
      const after = new Date(afterMs);
      const candidate = new Date(
        after.getFullYear(),
        after.getMonth(),
        after.getDate(),
        after.getHours(),
        recurrence.minute,
        0,
        0,
      );
      if (candidate.getTime() <= afterMs) {
        candidate.setHours(candidate.getHours() + 1);
      }
      return candidate.toISOString();
    }
    return nextHourlyInTimeZone(recurrence.minute, afterMs, timeZone);
  }

  const [hourText, minuteText] = recurrence.time.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const days = new Set(recurrence.days);
  if (timeZone == null) {
    const after = new Date(afterMs);

    for (let offset = 0; offset <= 7; offset += 1) {
      const candidate = new Date(
        after.getFullYear(),
        after.getMonth(),
        after.getDate() + offset,
        hour,
        minute,
        0,
        0,
      );
      if (days.has(candidate.getDay()) && candidate.getTime() > afterMs) {
        return candidate.toISOString();
      }
    }

    return null;
  }
  return nextWeeklyInTimeZone(days, hour, minute, afterMs, timeZone);
}
