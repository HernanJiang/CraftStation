import { useEffect } from "react";
import { create } from "zustand";
import type { ProjectLocation } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";

const EMPTY_SET: ReadonlySet<string> = new Set();

interface State {
  byKey: Record<string, ReadonlySet<string>>;
  loadingKeys: Record<string, true>;
  set: (key: string, names: ReadonlySet<string>) => void;
  markLoading: (key: string) => void;
  clearLoading: (key: string) => void;
}

const useStore = create<State>()((setState) => ({
  byKey: {},
  loadingKeys: {},
  set: (key, names) =>
    setState((state) => {
      const nextLoading = { ...state.loadingKeys };
      delete nextLoading[key];
      return { byKey: { ...state.byKey, [key]: names }, loadingKeys: nextLoading };
    }),
  markLoading: (key) =>
    setState((state) =>
      state.loadingKeys[key] ? {} : { loadingKeys: { ...state.loadingKeys, [key]: true } },
    ),
  clearLoading: (key) =>
    setState((state) => {
      if (!state.loadingKeys[key]) return {};
      const next = { ...state.loadingKeys };
      delete next[key];
      return { loadingKeys: next };
    }),
}));

function keyFor(projectLocation: ProjectLocation): string {
  return JSON.stringify(projectLocation);
}

async function fetchAndCache(projectLocation: ProjectLocation): Promise<void> {
  const key = keyFor(projectLocation);
  const state = useStore.getState();
  if (state.byKey[key] || state.loadingKeys[key]) return;
  state.markLoading(key);
  try {
    const result = await readBridge().listProjectTree({ projectLocation, directoryPath: "" });
    const names = new Set(result.entries.map((entry) => entry.name));
    useStore.getState().set(key, names);
  } catch {
    useStore.getState().clearLoading(key);
  }
}

/**
 * Returns top-level entry names for a project. Lazily fetched and cached per
 * `projectLocation`. Returns an empty set while loading or on failure — callers
 * should treat empty as "validation unavailable" rather than "no entries".
 */
export function useProjectRootNames(
  projectLocation: ProjectLocation | undefined,
): ReadonlySet<string> {
  const key = projectLocation ? keyFor(projectLocation) : "";
  const names = useStore((s) => (key ? s.byKey[key] : undefined));

  useEffect(() => {
    if (!projectLocation) return;
    void fetchAndCache(projectLocation);
  }, [projectLocation]);

  return names ?? EMPTY_SET;
}
