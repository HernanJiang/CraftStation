/**
 * Quota window that drives the headline meter and automatic account switch.
 *
 * CodexBar's overview picks the most constrained real weekly lane and ignores
 * model carve-outs (Claude Opus/Sonnet/Fable) so one exhausted bucket does not
 * look like the whole account is empty. CraftStation uses the same lane for
 * the meter, and a slightly wider blocking lane (session, daily, weekly,
 * monthly, or a provider pool) to decide whether the account can take another
 * turn. Dollar overage, reset-credit counters, and Claude carve-outs never
 * flip an account to exhausted on their own — a live turn failure still can.
 */

export type SwitcherQuotaWindow = {
  id: string;
  usedPercent: number;
  unit?: string | undefined;
};

export type SwitcherQuotaStatus = "available" | "quota-low" | "quota-exhausted";

const CLAUDE_CARVE_OUTS = new Set(["weekly-opus", "weekly-sonnet", "weekly-fable"]);

function isClaudeCarveOut(providerId: string, id: string): boolean {
  if (providerId !== "claude") return false;
  return (
    CLAUDE_CARVE_OUTS.has(id) || id.startsWith("claude-weekly-scoped-") || id === "claude-routines"
  );
}

function isIgnored(window: SwitcherQuotaWindow, providerId: string): boolean {
  if (!Number.isFinite(window.usedPercent)) return true;
  if (window.unit === "usd" || window.id === "extra-usage") return true;
  if (window.id === "codex:reset-credits") return true;
  return isClaudeCarveOut(providerId, window.id);
}

function isWeekly(id: string): boolean {
  return id === "weekly" || id.endsWith(":weekly");
}

function mostUsed(windows: readonly SwitcherQuotaWindow[]): SwitcherQuotaWindow | undefined {
  let best: SwitcherQuotaWindow | undefined;
  for (const window of windows) {
    if (!best || window.usedPercent > best.usedPercent) best = window;
  }
  return best;
}

function considered(
  providerId: string,
  windows: readonly SwitcherQuotaWindow[],
): SwitcherQuotaWindow[] {
  return windows.filter((window) => !isIgnored(window, providerId));
}

/**
 * Headline meter. Prefer the fullest weekly lane. Without one, use the
 * blocking lane. Cursor's included plan at 100% falls through to on-demand
 * API usage when that bucket still has room.
 */
export function switcherDisplayWindow(
  providerId: string,
  windows: readonly SwitcherQuotaWindow[],
): SwitcherQuotaWindow | undefined {
  const rows = considered(providerId, windows);
  const weekly = mostUsed(rows.filter((window) => isWeekly(window.id)));
  if (weekly) return weekly;
  return blockingWindow(providerId, rows);
}

/**
 * Lane that decides whether this account can take another turn. The fullest
 * real rate window wins. Cursor on-demand (`cursor-api`) replaces an exhausted
 * included plan so a paid overflow bucket is not treated as a dead account.
 */
export function blockingWindow(
  providerId: string,
  windows: readonly SwitcherQuotaWindow[],
): SwitcherQuotaWindow | undefined {
  const rows = considered(providerId, windows);
  if (providerId === "cursor") {
    const onDemand = rows.find((window) => window.id === "cursor-api");
    const included = rows.filter((window) => window.id !== "cursor-api");
    if (
      onDemand &&
      included.length > 0 &&
      included.every((window) => window.usedPercent >= 100) &&
      onDemand.usedPercent < 100
    ) {
      return onDemand;
    }
  }
  return mostUsed(rows);
}

export function quotaStatusFromWindows(
  providerId: string,
  windows: readonly SwitcherQuotaWindow[],
): SwitcherQuotaStatus {
  const blocking = blockingWindow(providerId, windows);
  if (!blocking) return "available";
  if (blocking.usedPercent >= 100) return "quota-exhausted";
  if (blocking.usedPercent >= 90) return "quota-low";
  return "available";
}

/** Used percent of the lane that blocks switching. Undefined when unmeasured. */
export function blockingUsedPercent(
  providerId: string,
  windows: readonly SwitcherQuotaWindow[] | undefined,
): number | undefined {
  return blockingWindow(providerId, windows ?? [])?.usedPercent;
}
