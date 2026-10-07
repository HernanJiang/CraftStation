import type { AccountQuotaWindow } from "@/shared/contracts";

const CODEX_SESSION_WINDOW_MINUTES = 300;
const CODEX_WEEKLY_WINDOW_MINUTES = 10080;

/**
 * One `rateLimits.primary`/`secondary` entry from `account/rateLimits/updated`
 * (v2 serde camelCase wire shape; snake_case accepted defensively).
 */
interface CodexRateLimitWindowWire {
  usedPercent?: number;
  used_percent?: number;
  windowDurationMins?: number;
  window_duration_mins?: number;
  resetsAt?: number;
  resets_at?: number;
}

/**
 * Map a pushed `RateLimitSnapshot` onto pool quota windows. Cadence comes
 * from `windowDurationMins` exactly like the `/wham/usage` collector (300min
 * → `session-5h`, 10080min → `weekly`), falling back to the slot's usual
 * axis when the duration is absent. An absent window yields nothing — the
 * caller merges per axis, so "not pushed" never clears stored evidence.
 */
export function codexRateLimitsToQuotaWindows(rateLimits: unknown): AccountQuotaWindow[] {
  if (!rateLimits || typeof rateLimits !== "object") return [];
  const snapshot = rateLimits as {
    primary?: CodexRateLimitWindowWire;
    secondary?: CodexRateLimitWindowWire;
  };
  const windows: AccountQuotaWindow[] = [];
  for (const [raw, fallback] of [
    [snapshot.primary, "session-5h"],
    [snapshot.secondary, "weekly"],
  ] as const) {
    if (!raw) continue;
    const usedPercent = raw.usedPercent ?? raw.used_percent;
    if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent)) continue;
    const durationMins = raw.windowDurationMins ?? raw.window_duration_mins;
    const axis =
      durationMins === CODEX_WEEKLY_WINDOW_MINUTES
        ? "weekly"
        : durationMins === CODEX_SESSION_WINDOW_MINUTES
          ? "session-5h"
          : fallback;
    const resetsAtSeconds = raw.resetsAt ?? raw.resets_at;
    windows.push({
      id: axis,
      label: axis === "weekly" ? "Weekly" : "Session (5h)",
      usedPercent: Math.min(100, Math.max(0, Math.round(usedPercent * 10) / 10)),
      ...(typeof resetsAtSeconds === "number" && Number.isFinite(resetsAtSeconds)
        ? { resetsAt: resetsAtSeconds * 1000 }
        : {}),
    });
  }
  return windows;
}
