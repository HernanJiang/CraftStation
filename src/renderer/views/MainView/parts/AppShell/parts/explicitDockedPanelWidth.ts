const EXPLICIT_DOCK_MIN_CHAT_WIDTH = 320;
const EXPLICIT_DOCK_MIN_PANEL_WIDTH = 280;

/**
 * Keep CraftStation's explicit auxiliary workspace in normal document flow.
 * When the window shrinks, cap the tools width before it can cover or squeeze
 * the composer to zero. If the window cannot fit both preferred minimums, use
 * an even split instead of turning the tools surface into a click-blocking
 * overlay.
 */
export function resolveExplicitDockedPanelWidth(input: {
  requestedWidth: number;
  shellWidth: number;
  sidebarWidth: number;
}): number {
  const availableWidth = Math.max(0, input.shellWidth - input.sidebarWidth);
  if (availableWidth === 0) return input.requestedWidth;
  const maxWithReadableChat = availableWidth - EXPLICIT_DOCK_MIN_CHAT_WIDTH;
  const safeMaximum =
    maxWithReadableChat >= EXPLICIT_DOCK_MIN_PANEL_WIDTH
      ? maxWithReadableChat
      : Math.floor(availableWidth / 2);
  return Math.max(0, Math.min(input.requestedWidth, safeMaximum));
}

export function shouldUseRightPanelOverlay(input: {
  hasExplicitOpenState: boolean;
  forceSidebarExpanded: boolean;
  wantsRightOverlay: boolean;
  wouldBeMainWidth: number | null;
  contentMinWidth: number;
}): boolean {
  return (
    !input.hasExplicitOpenState &&
    !input.forceSidebarExpanded &&
    input.wantsRightOverlay &&
    input.wouldBeMainWidth !== null &&
    input.wouldBeMainWidth < input.contentMinWidth
  );
}
