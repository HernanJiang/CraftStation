import { app, nativeImage, type BrowserWindow } from "electron";
import type { ThreadStatus } from "@/shared/contracts";
import type { SupervisorEvent } from "@/shared/ipc";

type TaskbarAttentionCategory = "done" | "needsAttention" | "error";

const ACTIVE_STATUSES: ReadonlySet<ThreadStatus> = new Set([
  "working",
  "needs_approval",
  "needs_reply",
  "launching",
]);

// 32x32 amber dot with a dark ring, generated offline and embedded so the
// packaged app never depends on an extra resource path.
const OVERLAY_DOT = nativeImage.createFromDataURL(
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAa0lEQVR42u2XOw4AEBBE9VqF07ulmgsIWfYzkplkW+9VdjYl5reUUsduwsBmIlKwqsjqwd7ydtQkpOCTiCv8WUIDvpJwh19JhApYwEUSFKAABcIF+BNCLCOIdRxeSCAqGUQphajlMIcJY5UJHRhnCecjQ7UAAAAASUVORK5CYII=",
);

function classifyTransition(
  oldStatus: ThreadStatus | undefined,
  newStatus: ThreadStatus,
  newAttention: string,
): TaskbarAttentionCategory | null {
  if (newStatus === "error") return "error";
  if (
    newStatus === "needs_approval" ||
    newStatus === "needs_reply" ||
    newAttention === "needs_approval" ||
    newAttention === "needs_reply"
  ) {
    return "needsAttention";
  }
  if (
    oldStatus !== undefined &&
    ACTIVE_STATUSES.has(oldStatus) &&
    (newStatus === "idle" || newStatus === "finished")
  ) {
    return "done";
  }
  return null;
}

export interface TaskbarAttentionController {
  observeSupervisorEvent(event: SupervisorEvent): void;
  /** The user opened the thread — its pending indicator is acknowledged. */
  dismissThread(threadId: string): void;
  /** Window focus stops the flash; the badge stays until per-thread dismiss. */
  notifyWindowFocus(): void;
  dispose(): void;
}

/**
 * Taskbar completion indicator (GitHub issue #12): when a background thread
 * settles while the window is unfocused, badge the taskbar icon and flash the
 * frame so the user can see completion without switching back. The badge
 * stays until the user opens that thread; the flash stops on window focus.
 */
export function createTaskbarAttentionController(input: {
  getWindow: () => BrowserWindow | null;
  /** Reads the live notification settings; called only on settle transitions. */
  isCategoryEnabled: (category: TaskbarAttentionCategory) => boolean;
}): TaskbarAttentionController {
  const lastStatusByThread = new Map<string, ThreadStatus>();
  const flaggedThreads = new Set<string>();
  let flashing = false;

  function liveWindow(): BrowserWindow | null {
    const win = input.getWindow();
    return win && !win.isDestroyed() ? win : null;
  }

  function paint(): void {
    const win = liveWindow();
    if (!win) return;
    if (flaggedThreads.size === 0) {
      win.setOverlayIcon(null, "");
      if (flashing) {
        win.flashFrame(false);
        flashing = false;
      }
      return;
    }
    const count = flaggedThreads.size;
    win.setOverlayIcon(
      OVERLAY_DOT,
      count === 1 ? "1 task needs your attention" : `${count} tasks need your attention`,
    );
    if (!win.isFocused()) {
      win.flashFrame(true);
      flashing = true;
      if (process.platform === "darwin") app.dock?.bounce("informational");
    }
  }

  const controller: TaskbarAttentionController = {
    observeSupervisorEvent(event) {
      if (event.type === "thread-exited") {
        lastStatusByThread.delete(event.threadId);
        if (flaggedThreads.delete(event.threadId)) paint();
        return;
      }
      if (event.type !== "thread-state") return;
      const previous = lastStatusByThread.get(event.threadId);
      lastStatusByThread.set(event.threadId, event.status);
      // The user's own stop/steer is an acknowledgement, not a completion.
      if (event.forceCloseActiveTurn) return;
      const category = classifyTransition(previous, event.status, event.attention);
      if (!category || !input.isCategoryEnabled(category)) return;
      const win = liveWindow();
      if (!win || win.isFocused()) return;
      flaggedThreads.add(event.threadId);
      paint();
    },

    dismissThread(threadId) {
      if (flaggedThreads.delete(threadId)) paint();
    },

    notifyWindowFocus() {
      if (!flashing) return;
      flashing = false;
      liveWindow()?.flashFrame(false);
    },

    dispose() {
      flaggedThreads.clear();
      lastStatusByThread.clear();
      const win = liveWindow();
      if (!win) return;
      win.setOverlayIcon(null, "");
      if (flashing) win.flashFrame(false);
      flashing = false;
    },
  };

  return controller;
}
