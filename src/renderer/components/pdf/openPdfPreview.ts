import { readBridge } from "@/renderer/bridge";
import type { ProjectLocation } from "@/shared/contracts";
import { toFileUrl } from "@/shared/promptContent";
import { resolveAbsolutePath } from "@/renderer/utils/resolveAbsolutePath";
import { useBrowserPanelStore } from "@/renderer/state/browserPanelStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { joinProjectPosixPath, toWslUncPath } from "@/shared/wsl";

function isHostAbsolutePath(path: string): boolean {
  return (
    path.startsWith("/") ||
    path.startsWith("\\\\") ||
    path.startsWith("//") ||
    /^[A-Za-z]:[\\/]/.test(path)
  );
}

/**
 * Resolve a project-relative or absolute path to a host-OS path for `file://`
 * (UNC for WSL linux paths).
 */
export function resolvePdfHostPath(path: string, projectLocation?: ProjectLocation): string {
  if (!projectLocation) return path;

  if (projectLocation.kind === "wsl") {
    // Already a Windows/UNC host path (e.g. from a file picker).
    if (path.startsWith("\\\\") || path.startsWith("//") || /^[A-Za-z]:[\\/]/.test(path)) {
      return path;
    }
    const linuxPath = path.startsWith("/") ? path : joinProjectPosixPath(projectLocation, path);
    return toWslUncPath(projectLocation.distro, linuxPath);
  }

  if (isHostAbsolutePath(path)) return path;
  return resolveAbsolutePath(projectLocation, path);
}

/**
 * Open a local PDF in the in-app browser (Chromium PDF viewer).
 * Uses `browserCreateTab({ reveal: true })` so presentation matches link opens
 * (right panel vs overlay; floats above the file editor when needed).
 * Reuses an existing tab pointing at the same file (activating it instead of
 * opening yet another duplicate) — repeated preview clicks previously piled
 * up one tab per click.
 */
export function openPdfPreview(absolutePath: string, projectLocation?: ProjectLocation): void {
  const hostPath = resolvePdfHostPath(absolutePath, projectLocation);
  const url = toFileUrl(hostPath);
  const existing = useBrowserPanelStore.getState().tabs.find((t) => t.url === url);
  if (existing) {
    void readBridge()
      .browserActivateTab({ tabId: existing.tabId })
      .catch(() => {});
    const panel = usePanelStore.getState();
    if (panel.auxiliaryPanelPlacement === "hidden") {
      panel.setAuxiliaryPanelPlacement("right");
    }
    panel.setRightPanelTab("browser");
    panel.openBrowserPanel();
    return;
  }
  void readBridge()
    .browserCreateTab({ url, activate: true, reveal: true })
    .catch(() => {});
}
