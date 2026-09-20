import { create } from "zustand";
import { shallow } from "zustand/shallow";
import { isWorkflowRunLive, type ProjectLocation } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";

/**
 * Per-thread tracker for live background workflows.
 *
 * A thread's foreground agent turn ends the instant the `Workflow` tool call
 * returns - the orchestration runs as a detached background process - so
 * `thread.status` settles to idle/finished while the workflow keeps running.
 * The composer's `ActiveSubAgentTile` already polls each workflow's on-disk
 * manifest, but only while the thread is open. This store lifts that liveness
 * to the THREAD level and keeps polling after the dock unmounts / the user
 * navigates away, so the sidebar row and chat header can keep showing the
 * working spinner until the workflow actually finishes.
 *
 * Presentation only: it never touches `thread.status`, so composer
 * interrupt/steer semantics, turn timing, and notifications are unaffected.
 *
 * Coverage: entries are registered from the open thread's dock, so any thread
 * opened this session is covered (including after you switch away). Threads
 * never opened this session - or carried across an app restart - are not; full
 * coverage would require a supervisor-side watcher.
 */

const POLL_MS = 4000;

/**
 * How long a tracked workflow may go without a manifest on disk before the
 * entry is dropped. A healthy launch writes its manifest in seconds; a row
 * that never materializes means the launch itself failed (wrong path,
 * cleaned up, crashed before first write) — and without a deadline the
 * thread spinner stays lit FOREVER with no way out (the dock row may
 * already be gone, and nothing else clears the entry). Ten minutes is
 * deliberately generous: it only ever fires for launches that are already
 * dead, never for slow-but-live work (those have manifests).
 */
const MISSING_MANIFEST_DEADLINE_MS = 10 * 60_000;

interface LiveWorkflowEntry {
  threadId: string;
  itemId: string;
  manifestPath: string;
  transcriptDir: string | undefined;
  location: ProjectLocation;
  /** Wall-clock registration time, for the missing-manifest deadline. */
  registeredAt: number;
}

interface RegisterInput {
  threadId: string;
  itemId: string;
  manifestPath: string;
  location: ProjectLocation;
  transcriptDir?: string;
}

interface ThreadLiveWorkflowStore {
  /** Threads with at least one live background workflow they launched. */
  liveThreadIds: ReadonlySet<string>;
  /** Begin (or refresh) tracking a thread's background workflow. Idempotent. */
  register: (input: RegisterInput) => void;
  /** Stop tracking a workflow (e.g. the dock already observed terminal status). */
  markTerminal: (threadId: string, itemId: string) => void;
}

// Entries and the shared timer live at module scope (like workflowRunStore's
// pollers) so mutating them never forces a store re-render; only the derived
// `liveThreadIds` snapshot does.
const entries = new Map<string, LiveWorkflowEntry>();
let timer: ReturnType<typeof setTimeout> | null = null;
let ticking = false;

function entryKey(threadId: string, itemId: string): string {
  return `${threadId} ${itemId}`;
}

export const useThreadLiveWorkflowStore = create<ThreadLiveWorkflowStore>((set, get) => {
  function recomputeLiveThreads(): void {
    const next = new Set<string>();
    for (const entry of entries.values()) next.add(entry.threadId);
    // Only publish a new snapshot when membership actually changes, so the
    // sidebar (which reads the whole set) doesn't re-render every poll tick.
    if (shallow(get().liveThreadIds, next)) return;
    set({ liveThreadIds: next });
  }

  function removeEntry(key: string): void {
    if (entries.delete(key)) recomputeLiveThreads();
    if (entries.size === 0 && timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  // Self-rescheduling chain (never setInterval): the next tick is only armed
  // AFTER the previous one's IPC batch settles, so a slow/contended disk can't
  // stack overlapping polls. `ticking` guards against a register() arming a
  // fresh timer while a batch is mid-flight.
  function scheduleTick(): void {
    if (timer || ticking || entries.size === 0) return;
    timer = setTimeout(() => void runTick(), POLL_MS);
  }

  async function runTick(): Promise<void> {
    timer = null;
    ticking = true;
    try {
      await Promise.all([...entries.keys()].map((key) => pollEntry(key)));
    } finally {
      ticking = false;
    }
    scheduleTick();
  }

  async function pollEntry(key: string): Promise<void> {
    const entry = entries.get(key);
    if (!entry) return;
    try {
      const result = await readBridge().workflowGetRun({
        manifestPath: entry.manifestPath,
        location: entry.location,
        ...(entry.transcriptDir ? { transcriptDir: entry.transcriptDir } : {}),
      });
      // The entry may have been removed (terminal/markTerminal) while in flight.
      const current = entries.get(key);
      if (!current) return;
      if (result.run) {
        // Drop only once the manifest reports an explicit terminal status. A
        // quiet running workflow remains visible until it says otherwise.
        if (!isWorkflowRunLive(result.run)) {
          removeEntry(key);
        }
        return;
      }
      // No manifest on disk yet. Launches normally materialize in seconds,
      // so keep showing "working" briefly — but a manifest that NEVER
      // appears is a failed launch, not a slow one. Without this deadline
      // the thread spinner (and the composer's working state) stays lit
      // forever: nothing else owns the entry once the dock row is gone.
      if (Date.now() - current.registeredAt >= MISSING_MANIFEST_DEADLINE_MS) {
        removeEntry(key);
      }
    } catch {
      // A transient read/parse failure must not turn into an implicit task
      // deadline. The next poll can recover the manifest.
    }
  }

  return {
    liveThreadIds: new Set<string>(),
    register(input) {
      const key = entryKey(input.threadId, input.itemId);
      const existing = entries.get(key);
      if (existing) {
        // Refresh mutable fields in case the manifest path/location resolved
        // after the first registration.
        existing.manifestPath = input.manifestPath;
        existing.location = input.location;
        existing.transcriptDir = input.transcriptDir;
        return;
      }
      entries.set(key, {
        threadId: input.threadId,
        itemId: input.itemId,
        manifestPath: input.manifestPath,
        transcriptDir: input.transcriptDir,
        location: input.location,
        registeredAt: Date.now(),
      });
      // Light the spinner immediately - the dock only registers once it has
      // confirmed a background workflow, so we trust it until a poll says
      // otherwise (avoids a non-working flicker during the launch gap).
      recomputeLiveThreads();
      scheduleTick();
    },
    markTerminal(threadId, itemId) {
      removeEntry(entryKey(threadId, itemId));
    },
  };
});

/** True while the thread has at least one background workflow still running. */
export function useThreadHasLiveWorkflow(threadId: string): boolean {
  return useThreadLiveWorkflowStore((s) => s.liveThreadIds.has(threadId));
}
