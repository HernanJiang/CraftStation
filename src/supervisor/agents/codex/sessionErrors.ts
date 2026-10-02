/**
 * Codex pool quota signal for turn failures. The verbatim exhausted shape
 * observed in-repo (`Error running remote compact task You've hit your usage
 * limit. Visit https://chatgpt.com/codex/settings/usage to purchase more
 * credits.`) arrives via async `turn/completed(failed)` / `thread/error`
 * notifications, never as a `turn/start` rejection — so this matcher runs on
 * notification text and structured error fields, not RPC shapes.
 *
 * The structured shape is a 429 carrying `type: "usage_limit_reached"`
 * (codex-rs `CodexErr::UsageLimitReached`): the bare status code alone is
 * transient rate limiting and must stay excluded, but the typed quota error
 * is a real exhaustion even though it contains "429". Positive quota signals
 * therefore win over the transient exclusion when both appear in the payload.
 */

/** Which budget axis a quota failure blocks (aligned with collector window ids). */
export interface CodexQuotaClassification {
  axisId: "session-5h" | "weekly";
  /** Epoch milliseconds the axis resets at, when the error carried one. */
  recoversAt?: number | undefined;
}

/** Signals that only a real usage-limit exhaustion produces. */
const CODEX_QUOTA_SIGNAL_RE =
  /usage[_\s-]limit[_\s-](?:reached|exceeded)|you['’]ve hit your usage limit|out of (?:workspace )?credits|spend cap/i;

/**
 * Codex renders `resets_at` into the error message via its retry suffix:
 * same-day windows read `try again at 3:45 PM`, later ones
 * `try again at Nov 3rd, 2025 3:45 PM` (`format_retry_timestamp`).
 */
const CODEX_RETRY_TIME_ONLY_RE = /try again at (\d{1,2}):(\d{2})\s*(AM|PM)\b/i;
const CODEX_RETRY_FULL_DATE_RE =
  /try again at (\w{3})\.? (\d{1,2})(?:st|nd|rd|th)?, (\d{4}) (\d{1,2}):(\d{2})\s*(AM|PM)\b/i;

const MONTH_ABBREVIATIONS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function collectErrorText(value: unknown, depth: number, out: string[]): void {
  if (depth > 4 || value == null) return;
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (value instanceof Error) {
    out.push(value.message);
    collectErrorText(value.cause, depth + 1, out);
    return;
  }
  if (typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  // Walk the fields Codex/JSON-RPC errors carry their signal in. Recursing
  // only these keys keeps incidental payloads (usage counters, request ids)
  // from polluting the match text.
  for (const key of [
    "message",
    "type",
    "code",
    "error_type",
    "codex_error_info",
    "rate_limit_reached_type",
    "error",
    "data",
    "detail",
    "details",
    "title",
    "cause",
  ]) {
    collectErrorText(record[key], depth + 1, out);
  }
}

function errorText(error: unknown): string {
  const parts: string[] = [];
  collectErrorText(error, 0, parts);
  return parts.join(" ");
}

/**
 * Parse `try again at …` into epoch milliseconds. A parsed time in the past
 * (clock skew, stale payload) floors to `now + 5m` so the resulting mark
 * still blocks briefly instead of healing instantly off a stale timestamp.
 */
function parseCodexRetryAt(text: string, now: number): number | undefined {
  const floor = now + 5 * 60_000;
  const full = CODEX_RETRY_FULL_DATE_RE.exec(text);
  if (full) {
    const month = MONTH_ABBREVIATIONS[(full[1] ?? "").toLowerCase().slice(0, 3)];
    if (month !== undefined) {
      let hour = Number(full[4]);
      if ((full[6] ?? "").toUpperCase() === "PM" && hour < 12) hour += 12;
      if ((full[6] ?? "").toUpperCase() === "AM" && hour === 12) hour = 0;
      const parsed = new Date(
        Number(full[3]),
        month,
        Number(full[2]),
        hour,
        Number(full[5]),
      ).getTime();
      if (Number.isFinite(parsed)) return Math.max(parsed, floor);
    }
  }
  const sameDay = CODEX_RETRY_TIME_ONLY_RE.exec(text);
  if (sameDay) {
    let hour = Number(sameDay[1]);
    if ((sameDay[3] ?? "").toUpperCase() === "PM" && hour < 12) hour += 12;
    if ((sameDay[3] ?? "").toUpperCase() === "AM" && hour === 12) hour = 0;
    const day = new Date(now);
    day.setHours(hour, Number(sameDay[2]), 0, 0);
    const parsed = day.getTime();
    if (Number.isFinite(parsed)) return Math.max(parsed, floor);
  }
  return undefined;
}

/** A reset within six hours is the rolling session window; anything longer is the weekly budget. */
const SESSION_AXIS_MAX_HORIZON_MS = 6 * 3_600_000;

export function isCodexPoolQuotaError(error: unknown): boolean {
  return classifyCodexPoolQuotaError(error) !== undefined;
}

/**
 * Classify a Codex quota failure onto one budget axis.
 *
 * Axis rules, in order:
 * 1. An absolute `try again at` reset inside 6h is the session axis; further
 *    out is the weekly axis.
 * 2. Without a reset time, a stored weekly window already at ≥95% explains
 *    the failure on the long axis (its own `resetsAt` refines recovery).
 * 3. Otherwise the session axis — the 5h window is what Plus polls omit
 *    entirely, and it is the budget that resets soonest. Biasing to the
 *    short axis errs toward recovery; a wrong guess self-corrects on the
 *    next failed turn which re-marks with better data.
 */
export function classifyCodexPoolQuotaError(
  error: unknown,
  observedWindows?:
    | ReadonlyArray<{ id: string; usedPercent: number; resetsAt?: number | undefined }>
    | undefined,
  now: number = Date.now(),
): CodexQuotaClassification | undefined {
  const text = errorText(error);
  if (!text) return undefined;
  if (!CODEX_QUOTA_SIGNAL_RE.test(text)) return undefined;
  const recoversAt = parseCodexRetryAt(text, now);
  if (recoversAt !== undefined) {
    return {
      axisId: recoversAt - now <= SESSION_AXIS_MAX_HORIZON_MS ? "session-5h" : "weekly",
      recoversAt,
    };
  }
  // Credits/spend-cap wording names a money budget, not a rate window —
  // treat it as the long axis when no timestamp says otherwise.
  if (/purchase more credits|workspace credits|spend cap|out of credits/i.test(text)) {
    const weeklyWindow = (observedWindows ?? []).find(
      (window) => window.id === "weekly" || window.id.endsWith(":weekly"),
    );
    return {
      axisId: "weekly",
      ...(weeklyWindow?.resetsAt !== undefined ? { recoversAt: weeklyWindow.resetsAt } : {}),
    };
  }
  const weeklyWindow = (observedWindows ?? []).find(
    (window) => window.id === "weekly" || window.id.endsWith(":weekly"),
  );
  if (weeklyWindow && weeklyWindow.usedPercent >= 95) {
    return {
      axisId: "weekly",
      ...(weeklyWindow.resetsAt !== undefined ? { recoversAt: weeklyWindow.resetsAt } : {}),
    };
  }
  return { axisId: "session-5h" };
}
