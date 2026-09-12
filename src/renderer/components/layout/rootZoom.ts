/**
 * Root CSS zoom factor (Ctrl +/-). All imperative geometry in the renderer
 * must agree on units:
 *
 * - ResizeObserver `contentRect` and `getComputedStyle` report UNSCALED
 *   layout px.
 * - `getBoundingClientRect`, `clientX/Y` and other viewport APIs report
 *   SCALED (zoomed) px.
 *
 * Mixing them writes zoomed px as CSS (scaled a second time at paint): at
 * zoom 1.5 the thread pane renders 2.25x tall and the composer drops below
 * the fold. Divide viewport-unit reads by this factor before using them as
 * CSS px. Returns 1 outside a DOM or when zoom is unset/invalid.
 */
export function rootZoomFactor(): number {
  if (typeof document === "undefined") return 1;
  const raw = Number.parseFloat(getComputedStyle(document.documentElement).zoom);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

/** getBoundingClientRect normalized to unscaled CSS px (see above). */
export function readUnscaledRect(element: HTMLElement): { width: number; height: number } {
  const rect = element.getBoundingClientRect();
  const zoom = rootZoomFactor();
  return { width: rect.width / zoom, height: rect.height / zoom };
}
