import { BrowserWindow, screen, type Rectangle, type RenderProcessGoneDetails } from "electron";
import type { CraftStationChannel } from "@/shared/channel";
import type { RendererProcessGoneIntent } from "@/main/diagnostics/processGone";
import { installSessionPermissions } from "../browser/permissions";
import { showAndFocusWindow } from "./showAndFocusWindow";
import {
  buildRendererAdditionalArguments,
  installAppNavigationGuards,
  installRendererReloadGuard,
  noteRendererWindowClose,
} from "./windowHardening";
import { rectOverlapsWorkArea } from "./windowGeometry";

const QUICK_COMPOSER_LOG_LABEL = "quick composer";

export const QUICK_COMPOSER_WIDTH = 560;
export const QUICK_COMPOSER_HEIGHT = 470;

export interface CreateQuickComposerWindowOptions {
  title: string;
  windowKind?: "quickComposer" | "temporaryChat";
  isDev: boolean;
  channel: CraftStationChannel;
  preloadPath: string;
  rendererHtmlPath: string;
  appVersion: string;
  posthogEnableDev: boolean;
  posthogEnabled: boolean;
  posthogHost: string;
  posthogKey: string;
  sentryEnabled: boolean;
  browserUserAgent: string;
  onClosed(): void;
  /** Keep the window hidden after the renderer loads. Used to prepare a CLI before the user opens it. */
  initiallyHidden?: boolean;
  onRendererProcessGone?: (
    details: RenderProcessGoneDetails,
    intent: RendererProcessGoneIntent | undefined,
  ) => void;
  devServerUrl?: string;
}

export function resolveQuickComposerBounds(workArea: Rectangle): Rectangle {
  const width = Math.min(QUICK_COMPOSER_WIDTH, workArea.width);
  const height = Math.min(QUICK_COMPOSER_HEIGHT, workArea.height);
  const bottomGap = Math.max(72, Math.round(workArea.height * 0.18));
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.max(workArea.y, workArea.y + workArea.height - bottomGap - height),
    width,
    height,
  };
}

export function positionQuickComposerWindow(window: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  window.setBounds(resolveQuickComposerBounds(display.workArea), false);
}

export function isQuickComposerBoundsVisible(
  bounds: Rectangle,
  workAreas: readonly Rectangle[],
): boolean {
  return workAreas.some((workArea) => rectOverlapsWorkArea(bounds, workArea));
}

export function showQuickComposerWindow(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  if (
    !isQuickComposerBoundsVisible(
      window.getBounds(),
      screen.getAllDisplays().map((display) => display.workArea),
    )
  ) {
    positionQuickComposerWindow(window);
  }
  showAndFocusWindow(window);
}

export function createQuickComposerWindow(
  options: CreateQuickComposerWindowOptions,
): BrowserWindow {
  const bounds = resolveQuickComposerBounds(
    screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea,
  );
  const temporary = options.windowKind === "temporaryChat";
  if (temporary) {
    bounds.height = Math.min(
      640,
      screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea.height,
    );
    bounds.y = Math.max(
      screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea.y,
      bounds.y - 85,
    );
  }
  const window = new BrowserWindow({
    title: `${options.title} ${temporary ? "临时对话" : "Quick Composer"}`,
    show: false,
    frame: false,
    transparent: true,
    resizable: temporary,
    ...(temporary ? { minWidth: 400, minHeight: 440 } : {}),
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    // DWM's own rounded frame leaves square scraps on a transparent window.
    // The page clips itself; keep the native frame square and borderless.
    ...(temporary ? { thickFrame: false, roundedCorners: false } : {}),
    backgroundColor: "#00000000",
    autoHideMenuBar: true,
    ...bounds,
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // A hidden prepare must keep running while the user has not opened the window yet.
      ...(temporary ? { backgroundThrottling: false } : {}),
      additionalArguments: buildRendererAdditionalArguments({
        appVersion: options.appVersion,
        isDev: options.isDev,
        windowKind: options.windowKind ?? "quickComposer",
        channel: options.channel,
        posthogEnableDev: options.posthogEnableDev,
        posthogEnabled: options.posthogEnabled,
        posthogHost: options.posthogHost,
        posthogKey: options.posthogKey,
        sentryEnabled: options.sentryEnabled,
      }),
    },
  });
  installSessionPermissions(window.webContents.session);
  window.webContents.setUserAgent(options.browserUserAgent);
  if (process.platform === "darwin") {
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  installAppNavigationGuards(window, {
    isDev: options.isDev,
    label: QUICK_COMPOSER_LOG_LABEL,
    ...(options.devServerUrl ? { devServerUrl: options.devServerUrl } : {}),
  });

  if (!options.initiallyHidden) {
    window.once("ready-to-show", () => showQuickComposerWindow(window));
  }

  const loadRenderer = () => {
    if (options.isDev) {
      void window.loadURL(options.devServerUrl as string);
    } else {
      void window.loadFile(options.rendererHtmlPath);
    }
  };
  loadRenderer();

  installRendererReloadGuard(window, {
    loadRenderer,
    label: QUICK_COMPOSER_LOG_LABEL,
    ...(options.onRendererProcessGone
      ? { onRendererProcessGone: options.onRendererProcessGone }
      : {}),
  });

  window.on("close", (event) => noteRendererWindowClose(window, event));
  window.on("closed", options.onClosed);
  return window;
}
