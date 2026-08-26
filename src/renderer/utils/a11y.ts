/**
 * Keyboard handler for `role="button"` divs — fires `onActivate` on Enter/Space
 * (the keys native <button> elements respond to) and calls `preventDefault` so
 * Space doesn't scroll the page.
 */
export function handleKeyActivate(
  e: React.KeyboardEvent,
  onActivate: () => void,
  opts?: { stopPropagation?: boolean },
): void {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    if (opts?.stopPropagation) e.stopPropagation();
    onActivate();
  }
}
