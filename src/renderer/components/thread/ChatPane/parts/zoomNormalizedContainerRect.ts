import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { normalizeZoomFactor } from "@/shared/zoom";

const PATCHED_KEY = "__craftstationZoomNormalizedRect";

type PatchableContainer = HTMLElement & { [PATCHED_KEY]?: true };

/**
 * LegendList (3.3.3) measures item containers with getBoundingClientRect() —
 * both in its mount pass and in the deferred web shrink confirmation. Under
 * the whole-app CSS `zoom` on <html> those readings are visual pixels (scaled
 * by the factor), while every other LegendList coordinate — style.top row
 * positions, scrollTop, ResizeObserver borderBoxSize — is in layout pixels.
 * The scaled sizes inflate row slots by the factor and push following rows
 * down, leaving blank gaps between messages that then persist into the
 * timeline snapshot cache. Normalizing the container's rect back to layout
 * pixels restores the invariant for every measurement path at any zoom.
 *
 * Idempotent per container; reads the live factor at call time so zoom changes
 * need no re-patch. At factor 1 the native rect passes through untouched.
 */
export function normalizeContainerRectForAppZoom(container: HTMLElement | null): void {
  if (!container || (container as PatchableContainer)[PATCHED_KEY]) return;
  const original = container.getBoundingClientRect.bind(container);
  container.getBoundingClientRect = () => {
    const rect = original();
    const zoom = normalizeZoomFactor(useSharedSettings.getState().zoomFactor);
    if (zoom === 1) return rect;
    const divide = (value: number) => (Number.isFinite(value) ? value / zoom : value);
    return {
      x: divide(rect.x),
      y: divide(rect.y),
      top: divide(rect.top),
      left: divide(rect.left),
      right: divide(rect.right),
      bottom: divide(rect.bottom),
      width: divide(rect.width),
      height: divide(rect.height),
      toJSON: () => (typeof rect.toJSON === "function" ? rect.toJSON() : {}),
    } as DOMRect;
  };
  (container as PatchableContainer)[PATCHED_KEY] = true;
}
