import { create } from "zustand";
import type { ScheduledTask } from "@/shared/contracts";
import { scheduleRelatesToThread } from "@/shared/schedules";
import { readBridge } from "@/renderer/bridge";

const REFRESH_DEBOUNCE_MS = 80;

interface ScheduleStoreState {
  tasks: ScheduledTask[];
  loading: boolean;
  focusedScheduleId: string | null;
  refresh: () => Promise<void>;
  setFocusedScheduleId: (id: string | null) => void;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<void> | null = null;

export const useScheduleStore = create<ScheduleStoreState>((set, get) => ({
  tasks: [],
  loading: false,
  focusedScheduleId: null,
  setFocusedScheduleId: (id) => set({ focusedScheduleId: id }),
  refresh: async () => {
    if (inflight) return inflight;
    const getSchedules = readBridge().getSchedules;
    if (typeof getSchedules !== "function") return;
    set({ loading: get().tasks.length === 0 });
    inflight = getSchedules()
      .then((tasks) => {
        set({ tasks, loading: false });
      })
      .catch(() => {
        set({ loading: false });
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  },
}));

export function selectSchedulesForThread(
  tasks: readonly ScheduledTask[],
  threadId: string,
): ScheduledTask[] {
  return tasks.filter((task) => scheduleRelatesToThread(task, threadId));
}

/**
 * Subscribe to Host schedule-changed broadcasts and keep one in-memory cache.
 * This is not a second persistence — every read is ScheduleService via IPC.
 */
export function startScheduleSync(): () => void {
  const bridge = readBridge();
  const unsubscribe = bridge.onSchedulesChanged?.(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void useScheduleStore.getState().refresh();
    }, REFRESH_DEBOUNCE_MS);
  });
  void useScheduleStore.getState().refresh();
  return () => {
    unsubscribe?.();
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };
}
