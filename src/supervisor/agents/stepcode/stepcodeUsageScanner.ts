import { existsSync, readFileSync } from "node:fs";
import type { UsageSnapshot } from "@craftstation/agents-usage";
import { nativeStepCodeAuthCandidates } from "./detection";

/**
 * Step Code usage snapshot — identity only.
 *
 * `step login` writes an OAuth credential to `~/.stepcode/auth.json` (or one of
 * the pre-rename legacy paths). Step Plan exposes no public quota API, so the
 * snapshot reports the signed-in identity (`profile` + masked `uid`) and never
 * fabricates usage windows. Reading the file directly — instead of a sealed
 * secret — makes the authorized Step Code channel durable across restarts and
 * independent of which surface ran `step login` (usage card or Harness panel).
 */
interface StepCodeAuthEntry {
  type?: unknown;
  profile?: unknown;
  uid?: unknown;
}

/** `412889548068540416` → `4128…0416`; short ids pass through untouched. */
function maskStepUid(uid: string): string {
  const trimmed = uid.trim();
  if (trimmed.length <= 8) return trimmed;
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

/** `step_plan` → "Step Plan"; unknown profiles fall back to title-casing. */
function humanizeStepProfile(profile: string): string {
  const words = profile
    .trim()
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1));
  return words.length > 0 ? words.join(" ") : "";
}

function readStepCodeAuthEntries(path: string): Record<string, StepCodeAuthEntry> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, StepCodeAuthEntry>;
  } catch {
    return {};
  }
}

export function scanStepCodeUsage(
  nowMs: number,
  candidates: readonly string[] = nativeStepCodeAuthCandidates(),
): UsageSnapshot {
  // An exported API key is a valid credential even before `step login` lands
  // a profile on disk.
  const hasApiKey = Boolean(process.env.STEP_API_KEY?.trim());
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const entries = readStepCodeAuthEntries(path);
    const providerKeys = Object.keys(entries);
    if (providerKeys.length === 0) continue;
    // Prefer the entry carrying the richest identity fields.
    const entriesWithIdentity = providerKeys
      .map((key) => entries[key])
      .filter((entry): entry is StepCodeAuthEntry => entry !== undefined);
    const withUid = entriesWithIdentity.find((entry) => typeof entry.uid === "string");
    const withProfile = entriesWithIdentity.find(
      (entry) => typeof entry.profile === "string" && entry.profile.trim().length > 0,
    );
    const plan =
      typeof withProfile?.profile === "string" ? humanizeStepProfile(withProfile.profile) : "";
    return {
      providerId: "stepcode",
      status: "ok",
      ...(plan ? { plan } : {}),
      ...(typeof withUid?.uid === "string"
        ? { authenticatedAs: maskStepUid(withUid.uid) }
        : { authenticatedAs: providerKeys[0]! }),
      windows: [],
      fetchedAt: nowMs,
    };
  }
  if (hasApiKey) {
    return {
      providerId: "stepcode",
      status: "ok",
      authenticatedAs: "STEP_API_KEY",
      windows: [],
      fetchedAt: nowMs,
    };
  }
  return { providerId: "stepcode", status: "auth-missing", windows: [], fetchedAt: nowMs };
}
