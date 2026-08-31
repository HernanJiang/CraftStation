import { create } from "zustand";
import type { SessionSwitchState } from "@/shared/sessionHandoff";

interface SessionHandoffStore {
  statesByThread: Record<string, SessionSwitchState | undefined>;
  setState: (threadId: string, state: SessionSwitchState) => void;
  clearState: (threadId: string) => void;
}

export const useSessionHandoffStore = create<SessionHandoffStore>((set) => ({
  statesByThread: {},
  setState: (threadId, state) =>
    set((current) => ({
      statesByThread: { ...current.statesByThread, [threadId]: state },
    })),
  clearState: (threadId) =>
    set((current) => {
      const statesByThread = { ...current.statesByThread };
      delete statesByThread[threadId];
      return { statesByThread };
    }),
}));
