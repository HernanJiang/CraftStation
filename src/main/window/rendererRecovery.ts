import type { BrowserWindow } from "electron";
import { probeRendererContentHealth } from "./rendererHealth";
import { requestTrackedRendererReload } from "./windowHardening";

export interface RendererRecoveryOptions {
  window: BrowserWindow;
  /** Log-only surface label (e.g. "main"). */
  label?: string;
  /**
   * Rebuild the window from scratch after a reload failed to restore content.
   * Returning null (or throwing) ends the ladder; the caller decides whether a
   * replacement window can still be created.
   */
  recreate?: () => BrowserWindow | null;
  /** Injectable delays (ms) so tests don't wait on real timers. */
  waitWindows?: RendererRecoveryWaitWindows;
}

/** Wait windows for each recovery step; defaults tuned for cold app start. */
export interface RendererRecoveryWaitWindows {
  /** Max time for a reload to finish loading the document. */
  reloadLoadMs?: number;
  /** Max time for React to mount after the document finished loading. */
  mountMs?: number;
  /** Cooldown before the recreate step runs. */
  recreateDelayMs?: number;
}

const DEFAULTS = { reloadLoadMs: 15_000, mountMs: 10_000, recreateDelayMs: 1_000 } as const;

type WaitWindows = Required<RendererRecoveryWaitWindows>;

export type RendererRecoveryOutcome = "healthy" | "reloaded" | "recreated" | "unrecovered";

/**
 * One recovery attempt at a time per window: a second-instance launch burst and
 * the startup content check can both observe the same unhealthy window, and a
 * reload + recreate racing each other would thrash the user's window.
 */
const inflightRecoveries = new WeakMap<BrowserWindow, Promise<RendererRecoveryOutcome>>();

/** Minimum spacing between recovery ladders for the same window. */
const RECOVERY_COOLDOWN_MS = 30_000;
const lastRecoveryStartedAt = new WeakMap<BrowserWindow, number>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForMount(window: BrowserWindow, waits: WaitWindows): Promise<boolean> {
  const loadDeadline = Date.now() + waits.reloadLoadMs;
  while (window.webContents.isLoading()) {
    if (window.isDestroyed() || Date.now() > loadDeadline) return false;
    await sleep(250);
  }
  const mountDeadline = Date.now() + waits.mountMs;
  for (;;) {
    if (window.isDestroyed()) return false;
    if ((await probeRendererContentHealth(window)) === "healthy") return true;
    if (Date.now() > mountDeadline) return false;
    await sleep(1_000);
  }
}

/**
 * Restore a window whose renderer is dead or stuck on the boot splash: reload
 * the renderer once, verify content actually mounted, then fall back to
 * rebuilding the window. Returns the final observed outcome.
 */
export async function recoverRendererContent(
  options: RendererRecoveryOptions,
): Promise<RendererRecoveryOutcome> {
  const { window, label = "main", recreate } = options;
  const inflight = inflightRecoveries.get(window);
  if (inflight) return inflight;

  const lastStartedAt = lastRecoveryStartedAt.get(window) ?? 0;
  const waits: WaitWindows = { ...DEFAULTS, ...options.waitWindows };
  const run = (async (): Promise<RendererRecoveryOutcome> => {
    if (window.isDestroyed()) return "unrecovered";
    if (Date.now() - lastStartedAt < RECOVERY_COOLDOWN_MS) return "unrecovered";
    lastRecoveryStartedAt.set(window, Date.now());

    const prefix = `[craftstation] ${label} window`;
    const initialHealth = await probeRendererContentHealth(window);
    if (initialHealth === "healthy") return "healthy";
    console.error(`${prefix} content unhealthy (health=${initialHealth}), reloading renderer`);

    if (requestTrackedRendererReload(window)) {
      if (await waitForMount(window, waits)) {
        console.error(`${prefix} recovered after renderer reload`);
        return "reloaded";
      }
      console.error(`${prefix} still unhealthy after renderer reload`);
    }

    if (!recreate) return "unrecovered";
    await sleep(waits.recreateDelayMs);
    if (window.isDestroyed()) return "unrecovered";
    console.error(`${prefix} recreating window`);
    let replacement: BrowserWindow | null = null;
    try {
      replacement = recreate();
    } catch (error) {
      console.error(`${prefix} window recreation failed:`, error);
      return "unrecovered";
    }
    return replacement ? "recreated" : "unrecovered";
  })();

  inflightRecoveries.set(window, run);
  try {
    return await run;
  } finally {
    inflightRecoveries.delete(window);
  }
}

export interface ScheduledContentCheckOptions {
  window: BrowserWindow;
  /** Initial mount grace period, also used for the first show. */
  delayMs: number;
  /** Recovery ladder invoked when the check observes unhealthy content. */
  recover: (window: BrowserWindow) => Promise<unknown>;
}

/**
 * Check initial content and recheck whenever the user reveals the window.
 * A healthy launch does not guarantee that a renderer hidden to tray will
 * still have content later. Hidden windows are left alone, including when the
 * user closes the window while an asynchronous health probe is in flight.
 */
export function scheduleRendererContentCheck(options: ScheduledContentCheckOptions): void {
  const { window, delayMs, recover } = options;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hasShown = window.isVisible();
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const schedule = (delay: number) => {
    clear();
    timer = setTimeout(() => {
      timer = undefined;
      if (window.isDestroyed() || !window.isVisible()) return;
      void check().catch((error) => {
        console.error(
          `[renderer-recovery] phase=window operation=content-check status=failed windowId=${window.id} code=renderer-content-check-failed; inspect renderer load and recovery logs`,
          error,
        );
      });
    }, delay);
    (timer as unknown as { unref?: () => void }).unref?.();
  };
  const check = async () => {
    const health = await probeRendererContentHealth(window);
    if (health === "healthy" || window.isDestroyed() || !window.isVisible()) return;
    await recover(window);
  };
  const onReveal = () => {
    schedule(hasShown ? 1_000 : delayMs);
    hasShown = true;
  };
  window.on("show", onReveal);
  window.on("restore", onReveal);
  window.on("hide", clear);
  window.on("closed", clear);
  schedule(delayMs);
}
