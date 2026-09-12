/**
 * Whole-app UI zoom (VS Code / Codex parity): a single factor applied to
 * `document.documentElement` via CSS `zoom`, so fonts, icons, panels, chat,
 * Side Panel and settings all scale together — never just the chat font.
 */

export const ZOOM_DEFAULT = 1;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
export const ZOOM_STEP = 0.1;

export type ZoomDirection = "in" | "out" | "reset";

/** Pure step math (tested): clamp + 2-decimal rounding, reset returns 1. */
export function nextZoomFactor(current: number, direction: ZoomDirection): number {
  if (direction === "reset") return ZOOM_DEFAULT;
  const base = Number.isFinite(current) ? current : ZOOM_DEFAULT;
  const next = direction === "in" ? base + ZOOM_STEP : base - ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(next * 100) / 100));
}

/** Normalize persisted/foreign values into the supported range. */
export function normalizeZoomFactor(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value))
    : ZOOM_DEFAULT;
}
