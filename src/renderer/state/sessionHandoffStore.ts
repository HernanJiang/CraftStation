import { create } from "zustand";
import type { RuntimeExecutionEnvelope, SessionSwitchState } from "@/shared/sessionHandoff";

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

/**
 * Single renderer accessor for a thread's active Runtime execution envelope
 * (v0.9 F1). Crafted active commands must carry this envelope so the
 * supervisor can fence them against the ledger's active Segment. Returns
 * `undefined` — never a derived guess — unless the supervisor-published switch
 * state is `phase="active"` with a runtime-bound active Segment; the renderer
 * never derives a binding epoch itself. Legacy (non-crafted) threads have no
 * state here, so their callers keep sending no envelope.
 */
export function getRuntimeExecutionEnvelope(
  threadId: string,
): RuntimeExecutionEnvelope | undefined {
  const state = useSessionHandoffStore.getState().statesByThread[threadId];
  const segment = state?.activeSegment;
  if (!state || state.phase !== "active" || !segment?.runtimeSessionId) return undefined;
  return {
    segmentId: segment.id,
    runtimeSessionId: segment.runtimeSessionId,
    bindingEpoch: segment.bindingEpoch,
  };
}
