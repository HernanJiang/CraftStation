import { toEpochMs, usedPercentFromRemaining } from "../formatters";
import type { UsageWindow } from "../types";

/**
 * Antigravity quota parsing, shared by the supervisor's local language-server
 * scanner (`antigravityUsageScanner.ts`).
 *
 * Antigravity now exposes a `RetrieveUserQuotaSummary` RPC that reports two model
 * groups — "Gemini Models" and "Claude and GPT models" — each with a shared
 * 5-hour limit and a weekly limit (this mirrors its in-app "Model Quota" view).
 * {@link antigravityQuotaSummaryWindows} turns that into four windows whose ids
 * are built by {@link antigravityWindowId} (e.g. `antigravity:gemini:session-5h`).
 *
 * The legacy path ({@link antigravityPoolWindows}) folds per-model
 * `quotaInfo.remainingFraction` (which only ever carries the 5-hour limit) into
 * three Gemini Pro / Gemini Flash / Claude pools, and stays as a fallback for
 * Antigravity builds that predate the quota-summary RPC.
 *
 * Pure (no host dependency) so it stays unit-testable. Antigravity usage is
 * collected supervisor-side from the local language server only; there is no
 * always-on HTTP collector here (its Cloud Code surface reports a different
 * backend's quota and was intentionally dropped to avoid inconsistent numbers).
 */

/** A model group key in the quota summary; drives window ids + ring grouping. */
export type AntigravityGroupKey = "gemini" | "claude";
/**
 * A quota window cadence in the quota summary. We reuse the package's canonical
 * `session-5h` token (shared with codex/factory) so `windowDurationMs` paces
 * these windows without a special case.
 */
export type AntigravityCadence = "session-5h" | "weekly";

/**
 * The window id for an Antigravity quota group + cadence. The single source of
 * truth for the id format, shared by the collector and the renderer's ring
 * descriptor so the two can't drift.
 */
export function antigravityWindowId(
  group: AntigravityGroupKey,
  cadence: AntigravityCadence,
): `antigravity:${AntigravityGroupKey}:${AntigravityCadence}` {
  return `antigravity:${group}:${cadence}`;
}

/**
 * Extract the Cloud Code project id from a `loadCodeAssist` response, matching
 * the CLIProxyAPI surface this quota path was verified against: the primary
 * `cloudaicompanionProject` field may be a plain string or a `{id: …}` object,
 * and older servers used the `projectId` / `project` keys. Returns undefined
 * when none of them carry a usable id.
 */
export function antigravityProjectFromLoadCodeAssist(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const root = body as Record<string, unknown>;
  for (const key of ["cloudaicompanionProject", "projectId", "project"] as const) {
    const value = root[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const id = (value as Record<string, unknown>).id;
      if (typeof id === "string" && id.trim()) return id.trim();
    }
  }
  return undefined;
}

/**
 * Classify a quota-summary group by its display name. The Gemini group is named
 * "Gemini Models"; everything else (currently "Claude and GPT models") folds
 * into the `claude` group, matching the in-app split.
 */
function antigravityGroupKey(displayName: string): AntigravityGroupKey {
  return /gemini/i.test(displayName) ? "gemini" : "claude";
}

const ANTIGRAVITY_GROUP_LABEL: Record<AntigravityGroupKey, string> = {
  gemini: "Gemini",
  claude: "Claude",
};

/**
 * Resolve a bucket's cadence from its `window` discriminator (`"5h"` / `"weekly"`),
 * falling back to its display name ("Five Hour Limit" / "Weekly Limit") in case
 * the discriminator field is ever renamed. Returns undefined for an unrecognized
 * cadence so the bucket is skipped rather than mislabeled.
 */
function antigravityCadence(bucket: Record<string, unknown>): AntigravityCadence | undefined {
  const sessionAliases = new Set(["session", "5h", "5-hour", "five hour", "five-hour"]);
  const candidates: string[] = [];
  for (const value of [bucket.window, bucket.bucketId, bucket.displayName]) {
    if (typeof value !== "string" || !value.trim()) continue;
    const normalized = value.trim().toLowerCase().replaceAll("_", "-");
    candidates.push(normalized);
    if (normalized.endsWith(" limit"))
      candidates.push(normalized.slice(0, -" limit".length).trim());
  }
  for (const candidate of candidates) {
    if (candidate === "weekly" || candidate.endsWith("-weekly")) return "weekly";
    if (
      sessionAliases.has(candidate) ||
      [...sessionAliases].some((alias) => candidate.endsWith(`-${alias}`))
    ) {
      return "session-5h";
    }
    if (candidate.includes("week")) return "weekly";
    if (candidate.includes("hour") || candidate.includes("5h") || candidate.includes("session")) {
      return "session-5h";
    }
  }
  return undefined;
}

/** Remaining fraction (0-1) from a quota bucket. Antigravity LS may nest it. */
export function antigravityRemainingFraction(
  bucket: Record<string, unknown> | undefined,
): number | undefined {
  if (!bucket) return undefined;
  const direct = bucket.remainingFraction;
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  // Some LS builds wrap the fraction itself in a protobuf oneof envelope.
  if (direct && typeof direct === "object") {
    const envelope = direct as Record<string, unknown>;
    if (
      envelope.case === "remainingFraction" &&
      typeof envelope.value === "number" &&
      Number.isFinite(envelope.value)
    ) {
      return envelope.value;
    }
  }
  const remaining = bucket.remaining;
  if (remaining && typeof remaining === "object") {
    const nested = remaining as Record<string, unknown>;
    const nestedFraction = nested.remainingFraction;
    if (typeof nestedFraction === "number" && Number.isFinite(nestedFraction))
      return nestedFraction;
    if (
      nested.case === "remainingFraction" &&
      typeof nested.value === "number" &&
      Number.isFinite(nested.value)
    ) {
      return nested.value;
    }
  }
  return undefined;
}

const ANTIGRAVITY_CADENCE_LABEL: Record<AntigravityCadence, string> = {
  "session-5h": "5h",
  weekly: "Weekly",
};

/** Sort weight so windows render grouped (Gemini before Claude) and 5h before weekly. */
function antigravityWindowOrder(group: AntigravityGroupKey, cadence: AntigravityCadence): number {
  return (group === "gemini" ? 0 : 1) * 2 + (cadence === "session-5h" ? 0 : 1);
}

/** Pull the `groups` array out of a RetrieveUserQuotaSummary body, tolerant of nesting. */
function quotaSummaryGroups(body: unknown): Record<string, unknown>[] {
  if (!body || typeof body !== "object") return [];
  // The LS may wrap the payload one or more times — { response: … },
  // { summary: … }, or { response: { summary: … } } — so unwrap repeatedly
  // until a groups array shows up or nothing is left to unwrap.
  let wrapped = body as Record<string, unknown>;
  for (let depth = 0; depth < 4; depth += 1) {
    const groups = wrapped.groups;
    if (Array.isArray(groups)) {
      return groups.filter((g): g is Record<string, unknown> => !!g && typeof g === "object");
    }
    const next =
      wrapped.response && typeof wrapped.response === "object"
        ? (wrapped.response as Record<string, unknown>)
        : wrapped.summary && typeof wrapped.summary === "object"
          ? (wrapped.summary as Record<string, unknown>)
          : undefined;
    if (!next || next === wrapped) break;
    wrapped = next;
  }
  return [];
}

/**
 * Build the four usage windows from a `RetrieveUserQuotaSummary` response — one
 * per (group × cadence). `remainingFraction` is 0-1 remaining, so usedPercent is
 * its complement. Window ids come from {@link antigravityWindowId}; the trailing
 * cadence segment lets the shared pacer infer the window length. Returns [] for a
 * body without recognizable groups so the scanner can fall back to the legacy
 * per-model pooling.
 *
 * With `nowMs`, a full bucket whose reset sits at "now + window length" is
 * dropped as an empty-default artifact: the cloudcode OAuth summary answers
 * with a synthetic always-full bucket (reset recomputed per request) for model
 * groups whose usage is tracked on a different backend — rendering it would
 * show a misleading 0% used. Buckets with any recorded usage (remaining < 1),
 * or whose reset does not hug the window boundary, are real and kept.
 */
export function antigravityQuotaSummaryWindows(
  body: unknown,
  options?: { nowMs?: number },
): UsageWindow[] {
  const nowMs = options?.nowMs;
  const entries: { order: number; window: UsageWindow }[] = [];
  const seen = new Set<string>();
  for (const group of quotaSummaryGroups(body)) {
    const displayName = typeof group.displayName === "string" ? group.displayName : "";
    const groupKey = antigravityGroupKey(displayName);
    const buckets = Array.isArray(group.buckets) ? group.buckets : [];
    for (const raw of buckets) {
      if (!raw || typeof raw !== "object") continue;
      const bucket = raw as Record<string, unknown>;
      const fraction = antigravityRemainingFraction(bucket);
      if (fraction === undefined) continue;
      const cadence = antigravityCadence(bucket);
      if (!cadence) continue;
      const reset = toEpochMs(typeof bucket.resetTime === "string" ? bucket.resetTime : undefined);
      if (nowMs !== undefined && isEmptyDefaultBucket(fraction, reset, cadence, nowMs)) {
        continue;
      }
      const id = antigravityWindowId(groupKey, cadence);
      if (seen.has(id)) continue;
      seen.add(id);
      entries.push({
        order: antigravityWindowOrder(groupKey, cadence),
        window: {
          id,
          label: `${ANTIGRAVITY_GROUP_LABEL[groupKey]} · ${ANTIGRAVITY_CADENCE_LABEL[cadence]}`,
          usedPercent: usedPercentFromRemaining(fraction),
          ...(reset !== undefined ? { resetsAt: reset } : {}),
        },
      });
    }
  }
  return entries.sort((a, b) => a.order - b.order).map((entry) => entry.window);
}

/** Tolerance when matching a bucket reset against "now + window length". */
const EMPTY_BUCKET_RESET_TOLERANCE_MS = 90_000;

const CADENCE_LENGTH_MS: Record<AntigravityCadence, number> = {
  "session-5h": 5 * 3_600_000,
  weekly: 7 * 86_400_000,
};

/**
 * True when a `fetchAvailableModels` per-model quota entry carries no real
 * usage record: remaining ≈ 1 with a reset recomputed as now + 5h per request.
 * The cloudcode models surface answers this way for every model whose usage is
 * tracked on another backend — folding them into pools would render 0% bars.
 */
export function antigravityModelUsageRecorded(
  model: AntigravityModelQuota,
  nowMs: number,
): boolean {
  if (model.remainingFraction < 0.9999) return true;
  if (model.resetsAt === undefined) return false;
  const expected = nowMs + CADENCE_LENGTH_MS["session-5h"];
  return Math.abs(model.resetsAt - expected) > EMPTY_BUCKET_RESET_TOLERANCE_MS;
}

/**
 * True for the cloudcode summary's synthetic always-full bucket: remaining ≈ 1
 * and the reset instant is (re)computed as now + window length per request —
 * real usage buckets keep a fixed reset and/or a depleted fraction.
 */
function isEmptyDefaultBucket(
  fraction: number,
  reset: number | undefined,
  cadence: AntigravityCadence,
  nowMs: number,
): boolean {
  if (fraction < 0.9999) return false;
  if (reset === undefined) return false;
  const expected = nowMs + CADENCE_LENGTH_MS[cadence];
  return Math.abs(reset - expected) <= EMPTY_BUCKET_RESET_TOLERANCE_MS;
}

interface AntigravityPool {
  id: "gemini-pro" | "gemini-flash" | "claude";
  label: string;
  order: number;
}

/**
 * Map a model label or id to its quota pool. Gemini Pro / Gemini Flash split on
 * the family keyword; everything else (Claude, GPT-OSS, ...) shares the "Claude"
 * pool, mirroring the Antigravity client. Examples: "Gemini 3.1 Pro (High)",
 * "gemini-2.5-flash-lite", "Claude Opus 4.6 (Thinking)", "GPT-OSS 120B".
 */
export function antigravityPool(modelLabelOrId: string): AntigravityPool {
  const lower = modelLabelOrId.toLowerCase();
  if (lower.includes("gemini") && lower.includes("pro")) {
    return { id: "gemini-pro", label: "Gemini Pro", order: 0 };
  }
  if (lower.includes("gemini") && lower.includes("flash")) {
    return { id: "gemini-flash", label: "Gemini Flash", order: 1 };
  }
  return { id: "claude", label: "Claude", order: 2 };
}

export interface AntigravityModelQuota {
  /** A model label ("Gemini 3.1 Pro (High)") or id ("gemini-2.5-flash"). */
  label: string;
  /** 0-1; lower = more used. */
  remainingFraction: number;
  resetsAt: number | undefined;
}

/**
 * Parse the `cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels` body
 * (the same upstream the Antigravity language server proxies, per CodexRouter's
 * working OAuth-only reader): `models: { <id>: { displayName, quotaInfo:
 * { remainingFraction 0-1, resetTime } } }`. Accepts both numeric and string
 * fractions, tolerant of nesting via `response`/`data` wrappers.
 */
export function antigravityModelsFromFetchAvailableModels(body: unknown): AntigravityModelQuota[] {
  if (!body || typeof body !== "object") return [];
  let root = body as Record<string, unknown>;
  for (const key of ["response", "data"] as const) {
    const nested = root[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      root = nested as Record<string, unknown>;
    }
  }
  const models = root.models;
  if (!models || typeof models !== "object" || Array.isArray(models)) return [];
  const entries: AntigravityModelQuota[] = [];
  for (const [id, raw] of Object.entries(models as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const detail = raw as Record<string, unknown>;
    const quota = detail.quotaInfo;
    if (!quota || typeof quota !== "object") continue;
    const bucket = quota as Record<string, unknown>;
    const rawFraction = bucket.remainingFraction;
    const fraction =
      typeof rawFraction === "number"
        ? rawFraction
        : typeof rawFraction === "string" && rawFraction.trim()
          ? Number(rawFraction.trim())
          : undefined;
    if (fraction === undefined || !Number.isFinite(fraction)) continue;
    const resetTime = bucket.resetTime;
    entries.push({
      label:
        typeof detail.displayName === "string" && detail.displayName.trim()
          ? detail.displayName.trim()
          : id,
      remainingFraction: Math.min(1, Math.max(0, fraction)),
      resetsAt:
        typeof resetTime === "string" && resetTime.trim() ? toEpochMs(resetTime) : undefined,
    });
  }
  return entries;
}

/**
 * Collapse per-model quota into the three pool windows. The most-constrained
 * model (lowest remainingFraction) drives each pool's bar; a pool inherits a
 * sibling's reset time when the winning model omits its own. Pools with no
 * models are dropped. Window ids are `antigravity:<pool>`.
 */
export function antigravityPoolWindows(models: AntigravityModelQuota[]): UsageWindow[] {
  const pools = new Map<
    string,
    { pool: AntigravityPool; remainingFraction: number; resetsAt: number | undefined }
  >();
  for (const model of models) {
    const label = model.label?.trim();
    if (!label) continue;
    const frac = Math.min(1, Math.max(0, model.remainingFraction));
    const pool = antigravityPool(label);
    const prev = pools.get(pool.id);
    if (!prev || frac < prev.remainingFraction) {
      pools.set(pool.id, {
        pool,
        remainingFraction: frac,
        resetsAt: model.resetsAt ?? prev?.resetsAt,
      });
    } else if (prev.resetsAt === undefined && model.resetsAt !== undefined) {
      prev.resetsAt = model.resetsAt;
    }
  }
  return [...pools.values()]
    .sort((a, b) => a.pool.order - b.pool.order)
    .map((entry) => ({
      id: `antigravity:${entry.pool.id}` as const,
      label: entry.pool.label,
      usedPercent: usedPercentFromRemaining(entry.remainingFraction),
      unit: "requests" as const,
      ...(entry.resetsAt !== undefined ? { resetsAt: entry.resetsAt } : {}),
    }));
}
