/**
 * Shared whole-app-zoom compensation for floating overlays (see styles.css).
 * HeroUI/React-Aria compute overlay geometry in visual px but emit plain CSS
 * px, which the root zoom re-scales — every popover/menu drifts by
 * (zoom-1)×distance under Ctrl +/-. The `root` class counter-scales the
 * positioned layer so engine coordinates land exactly; the `content` class
 * re-scales the inner layer so menu text/icons keep whole-app zoom.
 *
 * Applied centrally (ResponsiveMenuSurface + raw Dropdown popovers + the
 * capsule panel) — never per button, never JS-measured, no magic pixels.
 * At factor 1 both classes are empty strings, so default-state DOM is
 * untouched.
 */
export function overlayZoomClasses(zoomFactor: number | undefined): {
  /** Class for the positioned overlay element (engine coordinates land here). */
  root: string;
  /** Class for the inner content element (keeps whole-app scale). */
  content: string;
} {
  if (zoomFactor === undefined || zoomFactor === 1) return { root: "", content: "" };
  return {
    root: "craftstation-overlay-zoom-root",
    content: "craftstation-overlay-zoom-content",
  };
}

/** Append an optional class to a base className without stray spaces. */
export function withOverlayClass(base: string | undefined, extra: string): string {
  return [base, extra].filter(Boolean).join(" ");
}
