import { nextZoomFactor, normalizeZoomFactor, type ZoomDirection } from "@/shared/zoom";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";

/**
 * Whole-app UI zoom step (Ctrl +/-/0). Reads the persisted factor, steps it
 * with shared pure math, and writes it back through the normal settings
 * persist path — the AppProvider effect applies it to `documentElement`.
 */
export function adjustAppZoom(direction: ZoomDirection): number {
  const store = useSharedSettings.getState();
  const next =
    direction === "reset"
      ? nextZoomFactor(store.zoomFactor, "reset")
      : nextZoomFactor(normalizeZoomFactor(store.zoomFactor), direction);
  store.setZoomFactor(next);
  return next;
}
