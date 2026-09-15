import type { BrowserWindow } from "electron";

/**
 * Content health of a window's renderer, as seen from the main process.
 *
 * A "black screen" window can have three distinct shapes and each needs its own
 * recovery signal:
 * - `dead`   — the renderer process is gone, destroyed, or cannot answer script
 *              execution (crashed, failed to launch, hung v8).
 * - `stuck`  — the document loaded but React never mounted (the boot splash is
 *              still the only content, so the user sees a bare dark window).
 * - `healthy`— the app mounted (`#root` has content and the boot splash left).
 */
export type RendererContentHealth = "healthy" | "stuck" | "dead";

/**
 * Evaluated in the window's renderer. Must never throw across app upgrades:
 * an older/newer renderer still answers with the probe's own shape.
 */
export const RENDERER_CONTENT_HEALTH_EXPRESSION = `(() => {
  try {
    const root = document.getElementById("root");
    return {
      rootChildren: root ? root.childElementCount : -1,
      bootSplash: Boolean(document.getElementById("craftstation-boot-splash")),
    };
  } catch {
    return { rootChildren: -1, bootSplash: true };
  }
})()`;

export interface ProbeRendererContentHealthOptions {
  /** How long to wait for executeJavaScript before declaring the renderer dead. */
  timeoutMs?: number;
}

export async function probeRendererContentHealth(
  window: Pick<BrowserWindow, "isDestroyed" | "webContents">,
  options: ProbeRendererContentHealthOptions = {},
): Promise<RendererContentHealth> {
  if (window.isDestroyed()) return "dead";
  const webContents = window.webContents;
  if (webContents.isDestroyed() || webContents.isCrashed()) return "dead";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    const result = await Promise.race([
      webContents.executeJavaScript(RENDERER_CONTENT_HEALTH_EXPRESSION, true),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          timedOut = true;
          resolve(undefined);
        }, options.timeoutMs ?? 4_000);
      }),
    ]);
    if (timedOut) return "dead";
    if (!result || typeof result !== "object") return "stuck";
    const rootChildren = (result as { rootChildren?: number }).rootChildren ?? -1;
    const bootSplash = (result as { bootSplash?: boolean }).bootSplash ?? true;
    if (rootChildren > 0 && !bootSplash) return "healthy";
    return "stuck";
  } catch {
    return "dead";
  } finally {
    if (timer) clearTimeout(timer);
  }
}
