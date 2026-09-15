import { create } from "zustand";

export type UpdatePhase = "idle" | "checking" | "downloading" | "downloaded" | "error";

interface UpdateState {
  phase: UpdatePhase;
  version: string | null;
  downloadPercent: number;
  errorMessage: string | null;
  downloadTransferred: number | null;
  downloadTotal: number | null;
  downloadBytesPerSecond: number | null;
  /**
   * In-flight agent binary updates keyed by `${agentKind}:${envKind}:${distro}`.
   * Agent installers (npm scripts, vendor updaters) stream no byte counts, so
   * this tracks presence + start time only — surfaces render indeterminate
   * progress, never a fabricated percentage. Session-scoped, never persisted.
   */
  agentUpdates: Record<string, AgentUpdateInFlight>;
  /**
   * Latest known CLI update availability, published by the titlebar check and
   * read by the synthesis-bench Harness surfaces so both show the same state.
   * Session-scoped, never persisted.
   */
  availableCliUpdates: CliUpdateAvailable[];
}

export interface CliUpdateAvailable {
  /** `${agentKind}:${envKind}:${distro}` — same keying as `agentUpdates`. */
  key: string;
  /** Agent kind, e.g. `grok`. Matches bench `harnessKind` 1:1. */
  agentKind: string;
  /** Human label, e.g. `Grok Build`. */
  label: string;
  /** Installed version, e.g. `v1.0.13` (already includes any leading `v`). */
  version: string;
  /** Latest upstream version. */
  latest: string;
}

export type DownloadProgressPayload = {
  transferred: number;
  total: number;
  bytesPerSecond: number;
};

export interface AgentUpdateInFlight {
  /** Human label painted next to the spinner (agent display name). */
  label: string;
  /** Wall-clock start; lets stale entries be swept if a caller forgets finish. */
  startedAt: number;
}

interface UpdateActions {
  setChecking: () => void;
  beginUpdateDownload: (version: string) => void;
  setNotAvailable: () => void;
  setDownloading: (percent: number, progress?: DownloadProgressPayload) => void;
  setDownloaded: (version: string) => void;
  setError: (message: string) => void;
  beginAgentUpdate: (key: string, label: string) => void;
  finishAgentUpdate: (key: string) => void;
  setAvailableCliUpdates: (updates: CliUpdateAvailable[]) => void;
}

const clearedDownloadFields = {
  downloadTransferred: null as number | null,
  downloadTotal: null as number | null,
  downloadBytesPerSecond: null as number | null,
};

export const useUpdateStore = create<UpdateState & UpdateActions>()((set) => ({
  phase: "idle",
  version: null,
  downloadPercent: 0,
  errorMessage: null,
  ...clearedDownloadFields,
  agentUpdates: {},
  availableCliUpdates: [],

  setChecking: () =>
    set({
      phase: "checking",
      errorMessage: null,
      version: null,
      downloadPercent: 0,
      ...clearedDownloadFields,
    }),
  beginUpdateDownload: (version) =>
    set({
      phase: "downloading",
      version,
      downloadPercent: 0,
      errorMessage: null,
      ...clearedDownloadFields,
    }),
  setNotAvailable: () =>
    set({
      phase: "idle",
      errorMessage: null,
      version: null,
      downloadPercent: 0,
      ...clearedDownloadFields,
    }),
  setDownloading: (percent, progress) =>
    set({
      phase: "downloading",
      downloadPercent: percent,
      ...(progress
        ? {
            downloadTransferred: progress.transferred,
            downloadTotal: progress.total,
            downloadBytesPerSecond: progress.bytesPerSecond,
          }
        : {}),
    }),
  setDownloaded: (version) =>
    set({
      phase: "downloaded",
      version,
      downloadPercent: 100,
      ...clearedDownloadFields,
    }),
  setError: (message) =>
    set({
      phase: "error",
      errorMessage: message,
      version: null,
      downloadPercent: 0,
      ...clearedDownloadFields,
    }),
  beginAgentUpdate: (key, label) =>
    set((state) => ({
      agentUpdates: { ...state.agentUpdates, [key]: { label, startedAt: Date.now() } },
    })),
  finishAgentUpdate: (key) =>
    set((state) => {
      if (!(key in state.agentUpdates)) return {};
      const agentUpdates = { ...state.agentUpdates };
      delete agentUpdates[key];
      return { agentUpdates };
    }),
  setAvailableCliUpdates: (updates) =>
    set((state) => {
      // A re-check that finds the same availability must not publish a fresh
      // array identity: the titlebar dropdown and the bench Harness rows build
      // their item collections from this list, and pointless identity churn
      // around a click is exactly what made the popover feel unstable.
      const signature = (list: CliUpdateAvailable[]) =>
        list
          .map((entry) => `${entry.key}@${entry.latest}`)
          .sort()
          .join("|");
      if (signature(state.availableCliUpdates) === signature(updates)) return {};
      return { availableCliUpdates: updates };
    }),
}));

/**
 * First available update for an agent kind (any env/distro). Bench harness
 * kinds match agent kinds 1:1 (`grok`, `kimi`, `deepseek`, …), so Harness
 * cards and rows resolve their badge through this.
 */
export function findCliUpdateForAgentKind(
  updates: readonly CliUpdateAvailable[],
  agentKind: string,
): CliUpdateAvailable | undefined {
  return updates.find((entry) => entry.agentKind === agentKind);
}

/**
 * Runs an agent binary update while publishing its in-flight state for the
 * sidebar progress entry and harness rows. Always settles the entry, so a
 * crashed update can never strand a spinner.
 */
export async function trackAgentBinaryUpdate<T>(
  key: string,
  label: string,
  run: () => Promise<T>,
): Promise<T> {
  useUpdateStore.getState().beginAgentUpdate(key, label);
  try {
    return await run();
  } finally {
    useUpdateStore.getState().finishAgentUpdate(key);
  }
}
