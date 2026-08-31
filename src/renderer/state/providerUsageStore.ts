import { create } from "zustand";
import type { UsageCredits, UsageSnapshot } from "@/shared/contracts";

/**
 * Per-provider usage snapshots streamed from the supervisor (`provider-usage` /
 * `provider-usage-all`). Snapshot entries are replaced only when their content
 * changes so per-entity selectors stay reference-stable and don't re-render
 * sibling provider circles. Mirrors the agentStatusesStore conventions.
 */

interface ProviderUsageStore {
  snapshots: Record<string, UsageSnapshot>;
  setSnapshots: (snapshots: UsageSnapshot[]) => void;
  mergeSnapshot: (snapshot: UsageSnapshot) => void;
  /** Drop one provider's snapshot (e.g. after its account was removed). */
  removeSnapshot: (providerId: string) => void;
}

function creditsEqual(a: UsageCredits | undefined, b: UsageCredits | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.balance === b.balance &&
    a.currency === b.currency &&
    a.label === b.label &&
    a.unlimited === b.unlimited
  );
}

function snapshotEqual(a: UsageSnapshot | undefined, b: UsageSnapshot): boolean {
  if (!a) return false;
  if (
    a.status !== b.status ||
    a.plan !== b.plan ||
    a.authenticatedAs !== b.authenticatedAs ||
    a.error !== b.error ||
    a.rateLimitedUntil !== b.rateLimitedUntil ||
    a.fetchedAt !== b.fetchedAt ||
    !creditsEqual(a.credits, b.credits) ||
    a.windows.length !== b.windows.length ||
    a.cost?.amount !== b.cost?.amount ||
    a.cost?.currency !== b.cost?.currency ||
    a.cost?.period !== b.cost?.period ||
    a.cost?.estimated !== b.cost?.estimated ||
    a.tokens?.total !== b.tokens?.total ||
    a.tokens?.input !== b.tokens?.input ||
    a.tokens?.output !== b.tokens?.output ||
    a.tokens?.cacheRead !== b.tokens?.cacheRead ||
    a.tokens?.cacheWrite !== b.tokens?.cacheWrite ||
    a.tokens?.period !== b.tokens?.period
  ) {
    return false;
  }
  return a.windows.every((w, i) => {
    const o = b.windows[i]!;
    return (
      w.id === o.id &&
      w.label === o.label &&
      w.usedPercent === o.usedPercent &&
      w.resetsAt === o.resetsAt &&
      w.used === o.used &&
      w.limit === o.limit &&
      w.unit === o.unit &&
      w.currency === o.currency
    );
  });
}

export const useProviderUsageStore = create<ProviderUsageStore>()((set) => ({
  snapshots: {},
  setSnapshots: (incoming) =>
    set((prev) => {
      const next: Record<string, UsageSnapshot> = {};
      let changed = Object.keys(prev.snapshots).length !== incoming.length;
      for (const snapshot of incoming) {
        const existing = prev.snapshots[snapshot.providerId];
        // Reuse the existing reference when unchanged so selectors stay stable.
        if (existing && snapshotEqual(existing, snapshot)) {
          next[snapshot.providerId] = existing;
        } else {
          next[snapshot.providerId] = snapshot;
          changed = true;
        }
      }
      if (!changed) return prev;
      return { snapshots: next };
    }),
  mergeSnapshot: (snapshot) =>
    set((prev) => {
      if (snapshotEqual(prev.snapshots[snapshot.providerId], snapshot)) {
        return prev;
      }
      return {
        snapshots: { ...prev.snapshots, [snapshot.providerId]: snapshot },
      };
    }),
  removeSnapshot: (providerId) =>
    set((prev) => {
      if (!(providerId in prev.snapshots)) return prev;
      const snapshots = { ...prev.snapshots };
      delete snapshots[providerId];
      return { snapshots };
    }),
}));

/** Narrow per-provider selector — re-renders only when this provider changes. */
export function useProviderUsage(providerId: string): UsageSnapshot | undefined {
  return useProviderUsageStore((s) => s.snapshots[providerId]);
}
