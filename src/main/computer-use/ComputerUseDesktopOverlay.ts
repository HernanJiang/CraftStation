import { BrowserWindow, globalShortcut, screen, type Display, type Rectangle } from "electron";
import type { ComputerUseActivityEvent } from "./ComputerUseMcpIngress";
import { isKeyChordToolName } from "./mcp/toolRegistry";
import { pointerMoveDurationMs, type ComputerUsePointerMotion } from "./pointerMotion";

// Fallback for agents that have not adopted explicit enable/disable sessions.
// Long enough to bridge normal reasoning gaps between consecutive actions.
export const COMPUTER_USE_OVERLAY_RELEASE_DELAY_MS = 5_000;

const ESCAPE_ACCELERATOR = "Escape";
const OVERLAY_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="color-scheme" content="dark">
    <title>Computer Use Overlay</title>
    <style>
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      body {
        background: rgba(8, 12, 20, 0.03);
        box-shadow:
          inset 0 0 0 2px rgba(92, 167, 255, 0.6),
          inset 0 0 48px rgba(92, 167, 255, 0.08);
      }
      .badge {
        position: fixed;
        top: 0;
        left: 50%;
        transform: translateX(-50%);
        padding: 8px 14px;
        border: 1px solid rgba(92, 167, 255, 0.7);
        border-top: 0;
        border-radius: 0 0 12px 12px;
        background: rgba(8, 12, 20, 0.92);
        color: #f7f9fc;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
        font: 600 13px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        white-space: nowrap;
        z-index: 2;
      }
      #trail {
        position: fixed;
        inset: 0;
        width: 100%;
        height: 100%;
        z-index: 1;
        pointer-events: none;
      }
      #pointer {
        position: fixed;
        top: 0;
        left: 0;
        width: 52px;
        height: 52px;
        z-index: 3;
        pointer-events: none;
        display: none;
        filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.45));
        will-change: transform;
      }
      #pointer.show { display: block; }
      #pointer .hit {
        position: absolute;
        top: -5px;
        left: -5px;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #8B7BFF;
        border: 2px solid #f7f9fc;
        box-shadow: 0 0 0 4px rgba(139, 123, 255, 0.28);
      }
      #pointer .logo {
        position: absolute;
        top: 8px;
        left: 8px;
        width: 40px;
        height: 40px;
        transform-origin: top left;
      }
      #pointer.pulse .logo { animation: cs-pulse 180ms ease-out; }
      @keyframes cs-pulse {
        0% { transform: scale(1); }
        40% { transform: scale(0.86); }
        100% { transform: scale(1); }
      }
    </style>
  </head>
  <body>
    <canvas id="trail"></canvas>
    <div id="pointer" aria-hidden="true">
      <div class="hit"></div>
      <div class="logo">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="40" height="40">
          <rect x="32" y="32" width="960" height="960" rx="220" fill="#0E0E14"/>
          <path fill-rule="evenodd" fill="#EAF0FB"
            d="M352,300 H556 A152,152 0 0 1 556,604 H472 V730 H352 Z M472,392 H548 A60,60 0 0 1 548,512 H472 Z"/>
          <circle cx="636" cy="694" r="46" fill="#8B7BFF"/>
        </svg>
      </div>
    </div>
    <div class="badge">CraftStation using your computer | Esc to Exit</div>
    <script>
      (function () {
        var canvas = document.getElementById("trail");
        var pointer = document.getElementById("pointer");
        var ctx = canvas.getContext("2d");
        var pos = { x: 0, y: 0 };
        var visible = false;
        var trail = [];
        var TRAIL_MS = 420;

        function resize() {
          canvas.width = window.innerWidth;
          canvas.height = window.innerHeight;
          paint();
        }
        window.addEventListener("resize", resize);
        resize();

        function paint() {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          var t = performance.now();
          while (trail.length && t - trail[0].t > TRAIL_MS) trail.shift();
          if (trail.length < 2) return;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          for (var i = 1; i < trail.length; i++) {
            var age = (t - trail[i].t) / TRAIL_MS;
            ctx.strokeStyle = "rgba(139,123,255," + ((1 - age) * 0.75).toFixed(3) + ")";
            ctx.lineWidth = 4 * (1 - age) + 1.5;
            ctx.beginPath();
            ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
            ctx.lineTo(trail[i].x, trail[i].y);
            ctx.stroke();
          }
        }

        function place(x, y) {
          pos.x = x;
          pos.y = y;
          pointer.style.transform = "translate(" + x + "px," + y + "px)";
          trail.push({ x: x, y: y, t: performance.now() });
          paint();
        }

        function showAt(x, y) {
          visible = true;
          pointer.classList.add("show");
          place(x, y);
        }

        function hidePointer() {
          visible = false;
          pointer.classList.remove("show");
          pointer.classList.remove("pulse");
          paint();
        }

        function pulse() {
          pointer.classList.remove("pulse");
          void pointer.offsetWidth;
          pointer.classList.add("pulse");
        }

        function animateTo(tx, ty, duration, done) {
          var sx = pos.x;
          var sy = pos.y;
          var start = performance.now();
          function frame(now) {
            var u = duration <= 0 ? 1 : Math.min(1, (now - start) / duration);
            var e = 1 - Math.pow(1 - u, 3);
            place(sx + (tx - sx) * e, sy + (ty - sy) * e);
            if (u < 1) requestAnimationFrame(frame);
            else if (done) done();
          }
          requestAnimationFrame(frame);
        }

        window.__csPointer = function (msg) {
          if (!msg || msg.kind === "hide") {
            hidePointer();
            return;
          }
          var duration = typeof msg.durationMs === "number" ? msg.durationMs : 0;
          if (msg.kind === "drag" && typeof msg.fromX === "number" && typeof msg.fromY === "number") {
            showAt(msg.fromX, msg.fromY);
            animateTo(msg.x, msg.y, duration, pulse);
            return;
          }
          if (!visible) {
            showAt(msg.x, msg.y);
            pulse();
            return;
          }
          animateTo(msg.x, msg.y, duration, msg.kind === "click" || msg.kind === "scroll" ? pulse : undefined);
        };
      })();
    </script>
  </body>
</html>`;
const OVERLAY_URL = `data:text/html;charset=utf-8,${encodeURIComponent(OVERLAY_HTML)}`;

interface OverlayWindow {
  loaded: boolean;
  ready: Promise<void>;
  bounds: Rectangle;
  window: BrowserWindow;
}

export interface ComputerUseDesktopOverlayOptions {
  onExit(threadIds: string[]): void;
}

function containsPoint(bounds: Rectangle, x: number, y: number): boolean {
  return x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.width && y < bounds.y + bounds.height;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ComputerUseDesktopOverlay {
  private readonly activeThreads = new Set<string>();
  private readonly activeSessions = new Set<string>();
  private readonly activeCalls = new Map<string, number>();
  private escapeSuppressedCalls = 0;
  private readonly releaseTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly windows = new Map<number, OverlayWindow>();
  private escapeRegistered = false;
  private visible = false;
  private disposed = false;
  private lastPointer: { x: number; y: number } | null = null;

  constructor(private readonly options: ComputerUseDesktopOverlayOptions) {}

  setActivity(event: ComputerUseActivityEvent): void {
    if (this.disposed) return;
    const releaseTimer = this.releaseTimers.get(event.threadId);
    if (releaseTimer) {
      clearTimeout(releaseTimer);
      this.releaseTimers.delete(event.threadId);
    }

    if (event.kind === "session") {
      if (event.active) {
        this.activeSessions.add(event.threadId);
        this.activeThreads.add(event.threadId);
        this.show();
      } else {
        this.activeSessions.delete(event.threadId);
        if (!this.activeCalls.has(event.threadId)) {
          this.activeThreads.delete(event.threadId);
          if (this.activeThreads.size === 0) this.hide();
        }
      }
      this.syncEscapeShortcut();
      return;
    }

    if (event.active) {
      this.activeCalls.set(event.threadId, (this.activeCalls.get(event.threadId) ?? 0) + 1);
      this.activeThreads.add(event.threadId);
      if (isKeyChordToolName(event.toolName)) this.escapeSuppressedCalls += 1;
      this.show();
      this.syncEscapeShortcut();
      return;
    }

    const activeCalls = Math.max(0, (this.activeCalls.get(event.threadId) ?? 1) - 1);
    if (activeCalls > 0) this.activeCalls.set(event.threadId, activeCalls);
    else this.activeCalls.delete(event.threadId);
    if (isKeyChordToolName(event.toolName)) {
      this.escapeSuppressedCalls = Math.max(0, this.escapeSuppressedCalls - 1);
    }
    this.syncEscapeShortcut();
    if (
      !this.activeThreads.has(event.threadId) ||
      this.activeSessions.has(event.threadId) ||
      activeCalls > 0
    ) {
      return;
    }
    this.releaseTimers.set(
      event.threadId,
      setTimeout(() => {
        this.releaseTimers.delete(event.threadId);
        this.activeThreads.delete(event.threadId);
        if (this.activeThreads.size === 0) this.hide();
      }, COMPUTER_USE_OVERLAY_RELEASE_DELAY_MS),
    );
  }

  async movePointer(motion: ComputerUsePointerMotion): Promise<void> {
    if (this.disposed) return;
    this.show();
    const previous = this.lastPointer;
    const durationMs =
      motion.kind === "drag" && motion.fromX !== undefined && motion.fromY !== undefined
        ? pointerMoveDurationMs(motion.fromX, motion.fromY, motion.x, motion.y)
        : previous
          ? pointerMoveDurationMs(previous.x, previous.y, motion.x, motion.y)
          : 0;
    this.lastPointer = { x: motion.x, y: motion.y };
    await Promise.all(
      [...this.windows.values()].map((overlay) => this.injectPointer(overlay, motion, durationMs)),
    );
    if (durationMs > 0) await delay(durationMs);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearActivity();
    for (const overlay of this.windows.values()) {
      if (!overlay.window.isDestroyed()) overlay.window.destroy();
    }
    this.windows.clear();
  }

  private async injectPointer(
    overlay: OverlayWindow,
    motion: ComputerUsePointerMotion,
    durationMs: number,
  ): Promise<void> {
    await overlay.ready;
    if (this.disposed || overlay.window.isDestroyed()) return;
    const local = containsPoint(overlay.bounds, motion.x, motion.y);
    const payload = local
      ? {
          kind: motion.kind,
          x: motion.x - overlay.bounds.x,
          y: motion.y - overlay.bounds.y,
          durationMs,
          ...(motion.fromX !== undefined &&
          motion.fromY !== undefined &&
          containsPoint(overlay.bounds, motion.fromX, motion.fromY)
            ? {
                fromX: motion.fromX - overlay.bounds.x,
                fromY: motion.fromY - overlay.bounds.y,
              }
            : {}),
        }
      : { kind: "hide" };
    try {
      await overlay.window.webContents.executeJavaScript(
        `window.__csPointer(${JSON.stringify(payload)})`,
      );
    } catch {
      // Overlay page may have been destroyed mid-call; never block the click.
    }
  }

  private show(): void {
    if (this.visible) {
      this.syncDisplayWindows();
      return;
    }
    this.visible = true;
    this.syncDisplayWindows();
    for (const overlay of this.windows.values()) {
      if (overlay.loaded && !overlay.window.isVisible()) overlay.window.showInactive();
    }
  }

  private syncDisplayWindows(): void {
    const displays = screen.getAllDisplays();
    this.removeMissingDisplays(displays);
    for (const display of displays) {
      const overlay = this.windows.get(display.id) ?? this.createWindow(display);
      overlay.bounds = display.bounds;
      overlay.window.setBounds(display.bounds);
      if (overlay.loaded && this.visible && !overlay.window.isVisible()) {
        overlay.window.showInactive();
      }
    }
  }

  private createWindow(display: Display): OverlayWindow {
    const window = new BrowserWindow({
      ...display.bounds,
      transparent: true,
      backgroundColor: "#00000000",
      frame: false,
      focusable: false,
      fullscreenable: false,
      hasShadow: false,
      maximizable: false,
      minimizable: false,
      movable: false,
      resizable: false,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    let resolveReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const overlay: OverlayWindow = {
      loaded: false,
      ready,
      bounds: display.bounds,
      window,
    };
    this.windows.set(display.id, overlay);
    window.setAlwaysOnTop(true, "screen-saver");
    window.setIgnoreMouseEvents(true);
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.on("closed", () => {
      if (this.windows.get(display.id)?.window === window) this.windows.delete(display.id);
    });
    void window.loadURL(OVERLAY_URL).then(() => {
      overlay.loaded = true;
      resolveReady();
      if (!this.disposed && this.visible && !window.isDestroyed()) {
        window.showInactive();
      }
    });
    return overlay;
  }

  private removeMissingDisplays(displays: Display[]): void {
    const displayIds = new Set(displays.map((display) => display.id));
    for (const [displayId, overlay] of this.windows) {
      if (displayIds.has(displayId)) continue;
      this.windows.delete(displayId);
      if (!overlay.window.isDestroyed()) overlay.window.destroy();
    }
  }

  private hide(): void {
    this.visible = false;
    this.lastPointer = null;
    this.unregisterEscape();
    for (const overlay of this.windows.values()) {
      if (!overlay.window.isDestroyed()) overlay.window.hide();
    }
  }

  private syncEscapeShortcut(): void {
    const shouldRegister = this.activeThreads.size > 0 && this.escapeSuppressedCalls === 0;
    if (shouldRegister === this.escapeRegistered) return;
    if (!shouldRegister) {
      this.unregisterEscape();
      return;
    }
    this.escapeRegistered = globalShortcut.register(ESCAPE_ACCELERATOR, () => {
      const threadIds = [...this.activeThreads];
      this.clearActivity();
      this.options.onExit(threadIds);
    });
  }

  private unregisterEscape(): void {
    if (!this.escapeRegistered) return;
    globalShortcut.unregister(ESCAPE_ACCELERATOR);
    this.escapeRegistered = false;
  }

  private clearActivity(): void {
    for (const releaseTimer of this.releaseTimers.values()) clearTimeout(releaseTimer);
    this.releaseTimers.clear();
    this.activeThreads.clear();
    this.activeSessions.clear();
    this.activeCalls.clear();
    this.escapeSuppressedCalls = 0;
    this.hide();
  }
}
