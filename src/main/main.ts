import { watch } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeTheme,
  session as electronSession,
  type RenderProcessGoneDetails,
} from "electron";
import { BROWSER_SESSION_PARTITION } from "@/shared/browserPartition";
import { resolveThemeMode } from "@/shared/themeMode";
import { isThreadTurnActive, type RemoteThreadCommand } from "@/shared/contracts";
import {
  closeDatabase,
  dbDeleteThread,
  dbGetProject,
  dbGetProjectNotes,
  dbGetProjects,
  dbGetThread,
  dbGetThreadRuntimeItems,
  dbGetThreads,
  dbInsertScheduleRun,
  dbInterruptScheduleRuns,
  dbUpdateScheduleRun,
  dbUpsertThread,
  initDatabase,
  onProjectThreadDataChanged,
} from "./db";
import { cleanupOrphanedAttachments, prepareCraftStationDataRoot } from "./craftstationData";
import { createLocalIpcHandlers, showAddFilesDialog } from "./ipc/localHandlers";
import { registerIpcHandlers } from "./ipc/registerHandlers";
import { createSleepInhibitor } from "./sleepInhibitor";
import { shouldPreventSystemSleep } from "./sleepPolicy";
import {
  createTaskbarAttentionController,
  type TaskbarAttentionController,
} from "./taskbarAttention";
import {
  installLocalFileProtocolHandler,
  registerLocalFileProtocolScheme,
} from "./attachments/localFiles";
import {
  BrowserMcpIngress,
  BrowserPanelManager,
  ChromeBridgeServer,
  ChromeMcpIngress,
  installPickerProtocolHandler,
  registerPickerProtocolScheme,
} from "./browser";
import { buildBrowserUserAgent } from "./browser/userAgent";
import { startUsageLoginCookieMirror } from "./usageLogin/UsageLoginCookieMirror";
import {
  ComputerUseDesktopOverlay,
  ComputerUseMcpIngress,
  type ComputerUseMcpIngressInfo,
} from "./computer-use";
import { SupervisorClient } from "./supervisor/SupervisorClient";
import { createAutoUpdaterController } from "./updates/autoUpdater";
import { createMainWindow } from "./window/createMainWindow";
import {
  installWindowsAcrylicHideShowGuard,
  restoreWindowsWindowAfterShow,
} from "./window/windowMaterial";
import { requestTrackedRendererReload } from "./window/windowHardening";
import { probeRendererContentHealth } from "./window/rendererHealth";
import { recoverRendererContent, scheduleRendererContentCheck } from "./window/rendererRecovery";
import { installMainFileLogger } from "./diagnostics/mainFileLogger";
import {
  createQuickComposerWindow,
  showQuickComposerWindow,
} from "./window/createQuickComposerWindow";
import { showAndFocusWindow } from "./window/showAndFocusWindow";
import { createMainWindowCloseLifecycle } from "./window/mainWindowClose";
import { createTray, type TrayHandle } from "./tray";
import { readKeybindingsFile } from "./keybindingsFile";
import { QuickComposerShortcutManager } from "./quickComposerShortcut";
import { shouldStartMinimized, syncWindowsStartupRegistration } from "./startupSettings";
import { type CraftStationPaths, resolveCraftStationBaseDir } from "@/shared/craftstationPaths";
import {
  incrementCrossagentSelectionUsage,
  removeCrossagentRoutingOverride,
  upsertCrossagentRoutingOverride,
} from "@/shared/crossagentRanking";
import { getAppName } from "@/shared/appName";
import { appIdFor, resolveCraftStationChannel } from "@/shared/channel";
import {
  IPC_EVENT_CHANNELS,
  IPC_WINDOW_CHANNELS,
  isAgentStatusSupervisorEvent,
  quickComposerSubmissionSchema,
  type PrWatchStatusEvent,
  type QuickComposerSubmission,
  type SupervisorEvent,
  type UpdateStatus,
} from "@/shared/ipc";
import type { SharedSettings } from "@/shared/settings";
import { readSharedSettingsFile, writeSharedSettingsFile } from "./sharedSettingsFile";
import { remoteProjectCommandResultSchema, toRemoteThreadExchangeSummary } from "@/shared/remote";
import { WindowsJobObjectManager } from "./windowsJobObject";
import { captureMainException, initializeMainSentry } from "./diagnostics/sentry";
import {
  classifyRendererProcessGone,
  type RendererProcessGoneIntent,
} from "./diagnostics/processGone";
import {
  configureSecretStorageFallbackKeys,
  configureSecretStorageKey,
} from "@/shared/secretStorage";
import { readSecretStorageKeychain } from "./secretStorageKey";
import { createDesktopRemoteAccessController, type DesktopRemoteAccessController } from "./remote";
import { readOrCreateRemoteAccessIdentity } from "./remote/identity";
import { createGitStateExecutor, GitStateService } from "./gitState";
import { SshConnectionManager } from "./ssh/SshConnectionManager";
import {
  buildScheduleThreadContextText,
  createDeviceScheduleService,
  ensureHomeProjectRow,
  extractScheduleRunSummary,
  ScheduleMcpIngress,
  ScheduleRunCoordinator,
} from "./schedules";
import {
  AppControlsMcpIngress,
  buildSharedAppControlsIngressDeps,
  createAppControlsSupervisorCaller,
} from "./app-controls";
import { CrossagentsMcpIngress } from "./crossagentsMcp";
import { refreshMacDockIcon } from "./macDockIcon";
import { persistSupervisorEvent } from "./remote/server/runtimePersistence";
import {
  buildPrWatchExecutionDeps,
  createDevicePrWatchService,
  type PrWatchService,
} from "./prWatch";
import { shouldUseMockKeychain } from "./mockKeychain";

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const channel = resolveCraftStationChannel();
// Unpackaged Electron (dev server + `.cmd` launchers that run
// `electron.exe <root>`) otherwise groups the window under electron.exe and
// Windows keeps showing Electron's stock taskbar glyph even when the
// BrowserWindow has a branded icon. Give every unpackaged Windows window its
// own CraftStation identity; the packaged app keeps its installer-managed
// AppUserModelId.
if (process.platform === "win32" && (isDev || !app.isPackaged)) {
  app.setAppUserModelId(isDev ? "com.craftstation.app.dev" : appIdFor(channel));
}
const baseDirOverride = process.env.CRAFTSTATION_BASE_DIR;

if (process.env.CRAFTSTATION_CDP_PORT) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.CRAFTSTATION_CDP_PORT);
}

// Isolated smoke runs replace HOME so they cannot read developer credentials.
// On macOS that also hides the login keychain from Chromium, which otherwise
// opens a blocking "Keychain Not Found" dialog while safeStorage initializes.
// Chromium's mock keychain is intended for automated tests and must never be
// enabled for packaged or ordinary dev launches.
if (shouldUseMockKeychain({ isDev })) {
  app.commandLine.appendSwitch("use-mock-keychain");
}

// Windows HDR can make DWM acrylic visibly change opacity when Chromium starts
// compositing image content in the display color space. Keep Chromium in sRGB so
// acrylic stays translucent without breathing as image planes appear/disappear.
if (process.platform === "win32") {
  app.commandLine.appendSwitch("force-color-profile", "srgb");
}
if (process.platform === "linux") {
  app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal");
}

const browserUserAgent = buildBrowserUserAgent(app.userAgentFallback);
app.userAgentFallback = browserUserAgent;

if (baseDirOverride) {
  app.setPath("userData", join(baseDirOverride, "userData"));
} else if (isDev) {
  app.setPath("userData", join(app.getPath("userData"), "Dev"));
}

const hasSingleInstanceLock = isDev || app.requestSingleInstanceLock();
let craftstationPaths: CraftStationPaths | null = null;
// Declared before the init block below assigns it; the controller reads both
// the window and settings lazily, so it can be created before either exists.
let taskbarAttention: TaskbarAttentionController | null = null;
if (hasSingleInstanceLock) {
  craftstationPaths = prepareCraftStationDataRoot(
    baseDirOverride ??
      (isDev ? join(homedir(), ".craftstation-dev") : resolveCraftStationBaseDir(channel)),
  );
  // Packaged builds have no console; mirror warnings/errors to disk so launch
  // failures leave evidence. Must run before anything that can fail loudly.
  if (craftstationPaths) installMainFileLogger(craftstationPaths.logsDir);
  taskbarAttention = createTaskbarAttentionController({
    getWindow: () => mainWindow,
    isCategoryEnabled: isTaskbarAttentionCategoryEnabled,
  });
}

const sentryEnabled = initializeMainSentry({ appVersion: app.getVersion(), isDev, channel });

// Fallback global handlers so a stray throw in any main-process callback
// (IPC handler, Electron event listener, timer) is reported rather than
// silently taking the whole app — and the supervisor and all windows — down.
// Sentry's Electron integration also hooks these, but only when a DSN is
// configured and initialization succeeded; this guarantees coverage otherwise.
process.on("uncaughtException", (error) => {
  console.error("[craftstation] uncaught exception:", error);
  captureMainException(error, { "craftstation.feature_area": "main" });
});
process.on("unhandledRejection", (reason) => {
  console.error("[craftstation] unhandled rejection:", reason);
  captureMainException(reason, { "craftstation.feature_area": "main" });
});
const posthogEnabled = process.env.POSTHOG_ENABLED !== "0";
const posthogKey = posthogEnabled ? (process.env.POSTHOG_KEY ?? "").trim() : "";
const posthogHost = (process.env.POSTHOG_HOST ?? "").trim();
const posthogEnableDev = process.env.POSTHOG_ENABLE_DEV === "1";

const WINDOW_CHROME_HEIGHT = 38;

let mainWindow: BrowserWindow | null = null;
let quickComposerWindow: BrowserWindow | null = null;
let quickComposerDialogOpen = false;
let quickComposerDismissTimer: ReturnType<typeof setTimeout> | null = null;
let revealMainAfterQuickComposerDismiss = false;
let mainRendererReady = false;
const pendingQuickComposerSubmissions: QuickComposerSubmission[] = [];
const pendingInAppNotifications: Array<{ title: string; body: string; threadId: string }> = [];
let pendingTrayThreadId: string | null = null;
let windowsJobObjectManager: WindowsJobObjectManager | null = null;
let browserPanelManager: BrowserPanelManager | null = null;
let browserMcpIngress: BrowserMcpIngress | null = null;
let computerUseMcpIngress: ComputerUseMcpIngress | null = null;
let appControlsMcpIngress: AppControlsMcpIngress | null = null;
let scheduleMcpIngress: ScheduleMcpIngress | null = null;
let crossagentsMcpIngress: CrossagentsMcpIngress | null = null;
let computerUseDesktopOverlay: ComputerUseDesktopOverlay | null = null;
let chromeBridgeServer: ChromeBridgeServer | null = null;
let chromeMcpIngress: ChromeMcpIngress | null = null;
let browserExtractWindow: BrowserWindow | null = null;
// Retained module-scope so the native Tray icon stays reachable from GC.
let tray: TrayHandle | null = null;
let quickComposerShortcutManager: QuickComposerShortcutManager | null = null;
let isQuitting = false;

function captureRendererProcessGone(
  details: RenderProcessGoneDetails,
  featureArea: "browser" | "quick-composer" | "renderer",
  intent?: RendererProcessGoneIntent,
): void {
  const diagnostic = classifyRendererProcessGone(
    details,
    process.platform,
    isQuitting ? "app-shutdown" : intent,
  );
  if (!diagnostic) return;
  captureMainException(
    new Error(`Electron renderer process gone (${diagnostic.bucket})`),
    {
      "craftstation.feature_area": featureArea,
      "craftstation.process": "renderer",
    },
    diagnostic.fingerprint,
  );
}

function isCloseToTrayEnabled(): boolean {
  if (!craftstationPaths) return false;
  try {
    return readSharedSettingsFile(craftstationPaths.settingsPath).closeToTray;
  } catch {
    return false;
  }
}

function isTaskbarAttentionCategoryEnabled(category: "done" | "needsAttention" | "error"): boolean {
  if (!craftstationPaths) return false;
  try {
    const settings = readSharedSettingsFile(craftstationPaths.settingsPath);
    return settings.notificationsEnabled && settings.notificationStatuses[category];
  } catch {
    return false;
  }
}

/**
 * Resolves the saved appearance + opt-in translucent ("liquid glass") sidebar in
 * a single settings read, so the window opens already matching the theme and
 * material (flash-free first paint) before the renderer paints.
 */
function resolveWindowChromeOptions(): {
  appearance: "light" | "dark";
  sidebarTranslucency: boolean;
} {
  let mode: "system" | "light" | "dark" = "dark";
  let wantGlass = false;
  if (craftstationPaths) {
    try {
      const settings = readSharedSettingsFile(craftstationPaths.settingsPath);
      mode = settings.themeMode;
      wantGlass = settings.sidebarTranslucency === true;
    } catch {
      // Fall back to dark / opaque.
    }
  }
  return {
    appearance: resolveThemeMode(mode, nativeTheme.shouldUseDarkColors),
    sidebarTranslucency: wantGlass,
  };
}

function primeBrowserAllowFlags(settings?: SharedSettings): void {
  if (!craftstationPaths) return;
  let allowEval = false;
  let allowDataAccess = false;
  try {
    const s = settings ?? readSharedSettingsFile(craftstationPaths.settingsPath);
    allowEval = s.browser?.allowEval === true;
    allowDataAccess = s.browser?.allowDataAccess === true;
  } catch {
    allowEval = false;
    allowDataAccess = false;
  }
  // The embedded browser and the external Chrome bridge share the same
  // eval / data-access gates from browser settings.
  browserMcpIngress?.setAllowEval(allowEval);
  browserMcpIngress?.setAllowDataAccess(allowDataAccess);
  chromeMcpIngress?.setAllowEval(allowEval);
  chromeMcpIngress?.setAllowDataAccess(allowDataAccess);
}

// setLoginItemSettings writes the HKCU Run registry key on Windows; skip it
// when launchAtStartup hasn't changed so routine settings saves stay cheap.
let lastAppliedLaunchAtStartup: boolean | null = null;

function syncStartupSettings(settings?: SharedSettings): void {
  if (!craftstationPaths) return;
  try {
    const s = settings ?? readSharedSettingsFile(craftstationPaths.settingsPath);
    if (s.launchAtStartup === lastAppliedLaunchAtStartup) return;
    syncWindowsStartupRegistration(app, s, process.platform, isDev);
    lastAppliedLaunchAtStartup = s.launchAtStartup;
  } catch (error) {
    console.warn("[craftstation] failed to update Windows startup registration", error);
  }
}

function handleSharedSettingsChanged(settings: SharedSettings): void {
  primeBrowserAllowFlags(settings);
  syncStartupSettings(settings);
}

function recordOwnSubagentsSelectionPreference(
  event: Extract<SupervisorEvent, { type: "ownsubagents-selection-used" }>,
): void {
  const settingsPath = requireCraftStationPaths().settingsPath;
  const current = readSharedSettingsFile(settingsPath);
  const next = {
    ...current,
    ownSubagentSelectionUsage: incrementCrossagentSelectionUsage(
      current.ownSubagentSelectionUsage,
      event.selections,
    ),
  };
  writeSharedSettingsFile(settingsPath, next);
  handleSharedSettingsChanged(next);
  mainWindow?.webContents.send(IPC_EVENT_CHANNELS.sharedSettingsChanged, next);
}

function updateOwnSubagentsRoutingOverride(
  event: Extract<SupervisorEvent, { type: "ownsubagents-routing-override-changed" }>,
): void {
  const settingsPath = requireCraftStationPaths().settingsPath;
  const current = readSharedSettingsFile(settingsPath);
  const next = {
    ...current,
    ownSubagentRoutingOverrides:
      event.change.action === "set"
        ? upsertCrossagentRoutingOverride(
            current.ownSubagentRoutingOverrides,
            event.change.override,
          )
        : removeCrossagentRoutingOverride(current.ownSubagentRoutingOverrides, event.change.tags),
  };
  writeSharedSettingsFile(settingsPath, next);
  handleSharedSettingsChanged(next);
  mainWindow?.webContents.send(IPC_EVENT_CHANNELS.sharedSettingsChanged, next);
}

function quickComposerWindowFor(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  const window = BrowserWindow.fromWebContents(event.sender);
  return window && window === quickComposerWindow && !window.isDestroyed() ? window : null;
}

function flushQuickComposerSubmissions(): void {
  if (!mainRendererReady || !mainWindow || mainWindow.isDestroyed()) return;
  for (const submission of pendingQuickComposerSubmissions.splice(0)) {
    mainWindow.webContents.send(IPC_EVENT_CHANNELS.quickComposerSubmit, submission);
  }
}

function flushTrayThreadOpen(): void {
  if (!mainRendererReady || !mainWindow || mainWindow.isDestroyed() || !pendingTrayThreadId) return;
  const threadId = pendingTrayThreadId;
  pendingTrayThreadId = null;
  mainWindow.webContents.send(IPC_EVENT_CHANNELS.threadOpenRequested, { threadId });
}

function ensureMainWindow(showOnReady = true): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  mainRendererReady = false;
  mainWindow = createMainAppWindow(showOnReady);
  browserPanelManager?.bindHost(mainWindow);
  return mainWindow;
}

// A window whose renderer is dead or stuck shows an unusable dark surface. The
// single-instance lock funnels every later exe launch into the same broken
// window, so recovery has to be capped per run, not per window object.
let mainWindowRecoveries = 0;
const MAX_MAIN_WINDOW_RECOVERIES = 2;

function recreateMainWindowForRecovery(): BrowserWindow | null {
  if (mainWindowRecoveries >= MAX_MAIN_WINDOW_RECOVERIES) {
    console.error(
      "[craftstation] main window recovery exhausted for this run, not recreating again",
    );
    return null;
  }
  mainWindowRecoveries += 1;
  const stale = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  stale?.destroy();
  const fresh = ensureMainWindow(true);
  showAndFocusWindow(fresh);
  return fresh;
}

/**
 * Bring the main window up for a user who just launched the exe again (tray
 * click, second-instance). Re-apply the Windows acrylic material — the show
 * guard only covers hides it wrapped — then verify the renderer actually has
 * content and run the recovery ladder when it does not.
 */
async function revealAndVerifyMainWindow(): Promise<void> {
  const window = ensureMainWindow();
  showAndFocusWindow(window);
  if (process.platform === "win32" && !window.isDestroyed()) {
    restoreWindowsWindowAfterShow(window, resolveWindowChromeOptions());
  }
  const health = await probeRendererContentHealth(window);
  if (health === "healthy" || window.isDestroyed()) return;
  console.error(
    `[craftstation] main window unhealthy on reveal (health=${health}), starting recovery`,
  );
  await recoverRendererContent({ window, label: "main", recreate: recreateMainWindowForRecovery });
  if (mainWindow && !mainWindow.isDestroyed()) showAndFocusWindow(mainWindow);
}

function openThreadFromTray(threadId: string): void {
  pendingTrayThreadId = threadId;
  showAndFocusWindow(ensureMainWindow());
  flushTrayThreadOpen();
}

function showInAppNotification(input: { title: string; body: string; threadId: string }): boolean {
  if (
    !mainRendererReady ||
    !mainWindow ||
    mainWindow.isDestroyed() ||
    mainWindow.webContents.isLoading()
  ) {
    if (pendingInAppNotifications.length >= 3) pendingInAppNotifications.shift();
    pendingInAppNotifications.push(input);
    return true;
  }
  mainWindow.webContents.send(IPC_EVENT_CHANNELS.supervisorEvent, {
    type: "thread-user-notification",
    threadId: input.threadId,
    title: input.title,
    body: input.body,
  } satisfies SupervisorEvent);
  return true;
}

function flushInAppNotifications(): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) return;
  for (const input of pendingInAppNotifications.splice(0)) {
    mainWindow.webContents.send(IPC_EVENT_CHANNELS.supervisorEvent, {
      type: "thread-user-notification",
      threadId: input.threadId,
      title: input.title,
      body: input.body,
    } satisfies SupervisorEvent);
  }
}

function finishQuickComposerDismiss(window: BrowserWindow): void {
  if (quickComposerDismissTimer) {
    clearTimeout(quickComposerDismissTimer);
    quickComposerDismissTimer = null;
  }
  if (!window.isDestroyed()) window.hide();
  if (!revealMainAfterQuickComposerDismiss) return;
  revealMainAfterQuickComposerDismiss = false;
  const target = ensureMainWindow();
  if (target.webContents.isLoading()) {
    target.once("ready-to-show", () => showAndFocusWindow(target));
  } else {
    showAndFocusWindow(target);
  }
}

function requestQuickComposerDismiss(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  window.webContents.send(IPC_EVENT_CHANNELS.quickComposerDismissRequested);
  if (quickComposerDismissTimer) clearTimeout(quickComposerDismissTimer);
  quickComposerDismissTimer = setTimeout(() => finishQuickComposerDismiss(window), 240);
}

// Window options shared by every app-renderer window (main + quick composer);
// each factory adds only the fields distinct to its surface.
function commonAppWindowOptions() {
  return {
    title: getAppName(channel, isDev),
    isDev,
    channel,
    preloadPath: join(__dirname, "preload.cjs"),
    rendererHtmlPath: join(__dirname, "../renderer/index.html"),
    appVersion: app.getVersion(),
    posthogEnableDev,
    posthogEnabled,
    posthogHost,
    posthogKey,
    sentryEnabled,
    browserUserAgent,
    openDevTools: process.env.CRAFTSTATION_OPEN_DEVTOOLS === "1",
    ...(process.env.VITE_DEV_SERVER_URL ? { devServerUrl: process.env.VITE_DEV_SERVER_URL } : {}),
  };
}

function createQuickComposerAppWindow(): BrowserWindow {
  const window = createQuickComposerWindow({
    ...commonAppWindowOptions(),
    onClosed: () => {
      if (quickComposerWindow === window) quickComposerWindow = null;
    },
    onRendererProcessGone: (details, intent) => {
      captureRendererProcessGone(details, "quick-composer", intent);
    },
  });
  window.on("blur", () => {
    setTimeout(() => {
      if (
        !quickComposerDialogOpen &&
        !window.isDestroyed() &&
        window.isVisible() &&
        !window.isFocused()
      ) {
        requestQuickComposerDismiss(window);
      }
    }, 0);
  });
  window.webContents.on("before-input-event", (event, input) => {
    if (input.key !== "Escape" || input.type !== "keyDown") return;
    event.preventDefault();
    requestQuickComposerDismiss(window);
  });
  return window;
}

function toggleQuickComposerWindow(): void {
  if (quickComposerWindow && !quickComposerWindow.isDestroyed()) {
    if (quickComposerWindow.isVisible()) {
      requestQuickComposerDismiss(quickComposerWindow);
    } else {
      showQuickComposerWindow(quickComposerWindow);
    }
    return;
  }
  quickComposerWindow = createQuickComposerAppWindow();
}

function forwardAgentStatusEventToQuickComposer(event: SupervisorEvent): void {
  if (!isAgentStatusSupervisorEvent(event)) return;
  // The overlay refetches agent statuses on focus, so a hidden window has no use
  // for the live stream — skip the cross-process send until it's actually shown.
  if (
    quickComposerWindow &&
    !quickComposerWindow.isDestroyed() &&
    quickComposerWindow.isVisible()
  ) {
    quickComposerWindow.webContents.send(IPC_EVENT_CHANNELS.supervisorEvent, event);
  }
}

function createMainAppWindow(showOnReady = true): BrowserWindow {
  const windowChrome = resolveWindowChromeOptions();
  let window: BrowserWindow;
  const closeLifecycle = createMainWindowCloseLifecycle({
    isQuitting: () => isQuitting,
    closeToTrayEnabled: isCloseToTrayEnabled,
    hide: () => window.hide(),
    markQuitting: () => {
      isQuitting = true;
    },
    quit: () => app.quit(),
  });
  window = createMainWindow({
    ...commonAppWindowOptions(),
    windowChromeHeight: WINDOW_CHROME_HEIGHT,
    appearance: windowChrome.appearance,
    sidebarTranslucency: windowChrome.sidebarTranslucency,
    showOnReady,
    onClosed: () => {
      const wasMainWindow = mainWindow === window;
      if (wasMainWindow) mainWindow = null;
      mainRendererReady = false;
      closeLifecycle.handleClosed();
    },
    onClose: (event) => closeLifecycle.handleClose(event),
    onRendererProcessGone: (details, intent) => {
      mainRendererReady = false;
      captureRendererProcessGone(details, "renderer", intent);
    },
    onReloadExhausted: () => {
      // The reload guard gave up; without a rebuild this window stays dark forever.
      void recoverRendererContent({
        window,
        label: "main",
        recreate: recreateMainWindowForRecovery,
      });
    },
  });
  window.webContents.on("did-start-loading", () => {
    if (mainWindow === window) mainRendererReady = false;
  });
  installWindowsAcrylicHideShowGuard(window, resolveWindowChromeOptions);
  window.on("focus", () => taskbarAttention?.notifyWindowFocus());
  scheduleRendererContentCheck({
    window,
    delayMs: 20_000,
    recover: (target) =>
      recoverRendererContent({
        window: target,
        label: "main",
        recreate: recreateMainWindowForRecovery,
      }),
  });
  return window;
}

function focusBrowserExtractWindow(): void {
  if (!browserExtractWindow || browserExtractWindow.isDestroyed()) return;
  showAndFocusWindow(browserExtractWindow);
}

function revealBrowserInMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showAndFocusWindow(mainWindow);
  }
  browserPanelManager?.notifyState();
  browserPanelManager?.revealPanel();
}

function createBrowserExtractWindow(): BrowserWindow {
  const windowChrome = resolveWindowChromeOptions();
  const window = createMainWindow({
    title: `${getAppName(channel, isDev)} Browser`,
    windowKind: "browserExtract",
    boundsStateKey: "browser-extract-window-bounds",
    defaultWidth: 1120,
    defaultHeight: 760,
    minWidth: 520,
    minHeight: 420,
    isDev,
    channel,
    preloadPath: join(__dirname, "preload.cjs"),
    rendererHtmlPath: join(__dirname, "../renderer/index.html"),
    appVersion: app.getVersion(),
    posthogEnableDev,
    posthogEnabled,
    posthogHost,
    posthogKey,
    sentryEnabled,
    windowChromeHeight: WINDOW_CHROME_HEIGHT,
    browserUserAgent,
    appearance: windowChrome.appearance,
    sidebarTranslucency: windowChrome.sidebarTranslucency,
    openDevTools: false,
    ...(process.env.VITE_DEV_SERVER_URL ? { devServerUrl: process.env.VITE_DEV_SERVER_URL } : {}),
    onClosed: () => {
      browserExtractWindow = null;
      browserPanelManager?.notifyState();
      // Closing the window — whether via the OS controls or "bring back to
      // panel" (injectBrowserToMain) — returns the browser to the main window.
      if (!isQuitting) {
        revealBrowserInMainWindow();
      }
    },
    onRendererProcessGone: (details, intent) => {
      captureRendererProcessGone(details, "browser", intent);
    },
  });
  installWindowsAcrylicHideShowGuard(window, resolveWindowChromeOptions);
  return window;
}

function extractBrowserToWindow(): void {
  if (browserExtractWindow && !browserExtractWindow.isDestroyed()) {
    browserPanelManager?.notifyState();
    focusBrowserExtractWindow();
    return;
  }
  browserExtractWindow = createBrowserExtractWindow();
  // Bind the host (which emits state) only after `browserExtractWindow` is
  // assigned, so the snapshot's `extracted` flag reads true. Otherwise the main
  // window keeps showing its own browser until the next unrelated state emit.
  browserPanelManager?.bindHost(browserExtractWindow);
  focusBrowserExtractWindow();
}

function injectBrowserToMain(): void {
  const window = browserExtractWindow;
  if (!window || window.isDestroyed()) {
    browserExtractWindow = null;
    revealBrowserInMainWindow();
    return;
  }
  // The window's `onClosed` handler returns the browser to the main window.
  window.close();
}

const workingThreads = new Set<string>();
const sleepInhibitor = createSleepInhibitor();

function requireCraftStationPaths(): CraftStationPaths {
  if (!craftstationPaths) {
    throw new Error("CraftStation paths are not initialized.");
  }
  return craftstationPaths;
}

function updatePowerSaveBlocker(): void {
  if (!craftstationPaths) {
    sleepInhibitor.setActive(workingThreads.size > 0);
    return;
  }
  const settings = readSharedSettingsFile(craftstationPaths.settingsPath);
  sleepInhibitor.setActive(shouldPreventSystemSleep(settings, workingThreads.size));
}

function handleSupervisorEventForSleep(event: SupervisorEvent): void {
  if (event.type === "thread-state") {
    const active = event.status === "working" || event.status === "launching";
    if (active) {
      workingThreads.add(event.threadId);
    } else {
      workingThreads.delete(event.threadId);
    }
    updatePowerSaveBlocker();
    return;
  }
  if (event.type === "thread-exited") {
    workingThreads.delete(event.threadId);
    updatePowerSaveBlocker();
  }
}

registerLocalFileProtocolScheme();
registerPickerProtocolScheme();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    if (!app.isReady()) return;
    if (
      craftstationPaths &&
      shouldStartMinimized(
        readSharedSettingsFile(craftstationPaths.settingsPath),
        commandLine,
        process.platform,
      )
    ) {
      return;
    }
    // The user double-launched because the visible window is unusable — verify
    // content health instead of only raising the same possibly-broken window.
    void revealAndVerifyMainWindow();
  });

  void app
    .whenReady()
    .then(async () => {
      refreshMacDockIcon();
      Menu.setApplicationMenu(null);

      installLocalFileProtocolHandler();
      installPickerProtocolHandler();
      // Keep the pre-rebrand partition so browser cookies and sign-ins survive.
      const browserSession = electronSession.fromPartition(BROWSER_SESSION_PARTITION);
      browserSession.setUserAgent(browserUserAgent);

      const paths = requireCraftStationPaths();
      // Re-seal an already-signed-in provider's cookie whenever the live jar
      // refreshes it, so providers with session-scoped auth cookies (Alibaba's
      // console) don't age out of the one snapshot taken at sign-in.
      startUsageLoginCookieMirror({ cacheDir: paths.cacheDir, session: browserSession });
      const initialSettings = readSharedSettingsFile(paths.settingsPath);
      syncStartupSettings(initialSettings);
      const showMainWindowOnReady = !shouldStartMinimized(
        initialSettings,
        process.argv,
        process.platform,
      );
      let jobObjectReady: Promise<void> = Promise.resolve();
      if (process.platform === "win32") {
        const manager = new WindowsJobObjectManager();
        windowsJobObjectManager = manager;
        jobObjectReady = manager.start().catch((error) => {
          console.error(
            "[craftstation] Windows Job Object helper unavailable:",
            error instanceof Error ? error.message : String(error),
          );
          captureMainException(error, { "craftstation.feature_area": "process-lifecycle" });
          if (windowsJobObjectManager === manager) {
            windowsJobObjectManager = null;
          }
        });
      }

      initDatabase(paths.dbPath);
      const secretStorageKeychain = readSecretStorageKeychain(
        paths.baseDir,
        process.platform,
        app.getPath("userData"),
      );
      const secretStorageKey = secretStorageKeychain.current;
      // Configure the same key in main so it can seal captured secrets (e.g. usage
      // login cookies); the supervisor configures it from the env var it receives.
      configureSecretStorageKey(secretStorageKey);
      configureSecretStorageFallbackKeys(secretStorageKeychain.fallbacks);

      const supervisorPath = join(__dirname, "supervisor.cjs");
      const wslHelpersDir = app.isPackaged
        ? join(process.resourcesPath, "wsl-helpers")
        : join(__dirname, "..", "..", "resources", "wsl-helpers");
      const bundledSkillsDir = app.isPackaged
        ? join(process.resourcesPath, "skills")
        : join(__dirname, "..", "..", "resources", "skills");
      const bundledPluginsDir = app.isPackaged
        ? join(process.resourcesPath, "plugins")
        : join(__dirname, "..", "..", "resources", "plugins");
      const sshConnectionManager = new SshConnectionManager({
        mainBundleDir: __dirname,
        agentPluginsDir: app.isPackaged
          ? join(process.resourcesPath, "agent-plugins")
          : join(__dirname, "..", "..", "resources", "agent-plugins"),
        wslHelpersDir,
        bundledSkillsDir,
        bundledPluginsDir,
        cacheDir: join(paths.baseDir, "ssh-runtime-bundles"),
      });

      // Assigned after the browser services are composed and before the
      // supervisor starts emitting events.
      let remoteAccessController: DesktopRemoteAccessController | null = null;
      // Assigned right after the supervisor client below; the `onEvent` tap only
      // fires once the supervisor is started, by which point it is set.
      let scheduleRunCoordinator: ScheduleRunCoordinator | null = null;
      let prWatchService: PrWatchService | null = null;
      let gitStateService: GitStateService | null = null;
      const supervisorClient = new SupervisorClient({
        appVersion: app.getVersion(),
        isDev,
        supervisorPath,
        wslHelpersDir,
        bundledSkillsDir,
        bundledPluginsDir,
        secretStorageKey,
        secretStorageKeyFallbacks: secretStorageKeychain.fallbacks,
        resolveExtraEnv: () => {
          const env: Record<string, string> = {};
          const browserInfo = browserMcpIngress?.getInfo();
          if (browserInfo) {
            env.CRAFTSTATION_BROWSER_MCP_URL = browserInfo.url;
            env.CRAFTSTATION_BROWSER_MCP_TOKEN = browserInfo.token;
          }
          const chromeInfo = chromeMcpIngress?.getInfo();
          if (chromeInfo) {
            env.CRAFTSTATION_CHROME_MCP_URL = chromeInfo.url;
            env.CRAFTSTATION_CHROME_MCP_TOKEN = chromeInfo.token;
          }
          const computerUseInfo = computerUseMcpIngress?.getInfo();
          if (computerUseInfo) {
            env.CRAFTSTATION_COMPUTER_USE_MCP_URL = computerUseInfo.url;
            env.CRAFTSTATION_COMPUTER_USE_MCP_TOKEN = computerUseInfo.token;
          }
          const appControlsInfo = appControlsMcpIngress?.getInfo();
          if (appControlsInfo) {
            env.CRAFTSTATION_APP_CONTROLS_MCP_URL = appControlsInfo.url;
            env.CRAFTSTATION_APP_CONTROLS_MCP_TOKEN = appControlsInfo.token;
          }
          const scheduleInfo = scheduleMcpIngress?.getInfo();
          if (scheduleInfo) {
            env.CRAFTSTATION_SCHEDULE_MCP_URL = scheduleInfo.url;
            env.CRAFTSTATION_SCHEDULE_MCP_TOKEN = scheduleInfo.token;
          }
          const crossagentsInfo = crossagentsMcpIngress?.getInfo();
          if (crossagentsInfo) {
            env.CRAFTSTATION_CROSSAGENTS_MCP_URL = crossagentsInfo.url;
            env.CRAFTSTATION_CROSSAGENTS_MCP_TOKEN = crossagentsInfo.token;
          }
          return env;
        },
        assignPid: async (pid) => {
          await windowsJobObjectManager?.assignPid(pid);
        },
        reportError: (error, tags) => {
          captureMainException(error, tags);
        },
        onEvent: (event) => {
          if (event.type === "ownsubagents-selection-used") {
            try {
              recordOwnSubagentsSelectionPreference(event);
            } catch (error) {
              captureMainException(error, { "craftstation.feature_area": "own-subagents-routing" });
            }
            return;
          }
          if (event.type === "ownsubagents-routing-override-changed") {
            let errorMessage: string | undefined;
            try {
              updateOwnSubagentsRoutingOverride(event);
            } catch (error) {
              errorMessage =
                error instanceof Error ? error.message : "Unable to save the routing preference";
              captureMainException(error, { "craftstation.feature_area": "own-subagents-routing" });
            }
            void supervisorClient
              .call("confirmOwnSubagentsRoutingOverride", {
                requestId: event.requestId,
                ok: errorMessage === undefined,
                ...(errorMessage ? { error: errorMessage } : {}),
              })
              .catch((error) => {
                captureMainException(error, {
                  "craftstation.feature_area": "own-subagents-routing",
                });
              });
            return;
          }
          persistSupervisorEvent(event);
          handleSupervisorEventForSleep(event);
          taskbarAttention?.observeSupervisorEvent(event);
          appControlsMcpIngress?.observeSupervisorEvent(event);
          scheduleRunCoordinator?.observeSupervisorEvent(event);
          prWatchService?.observeSupervisorEvent(event);
          gitStateService?.observeSupervisorEvent(event);
          remoteAccessController?.handleSupervisorEvent(event);
          mainWindow?.webContents.send(IPC_EVENT_CHANNELS.supervisorEvent, event);
          forwardAgentStatusEventToQuickComposer(event);
        },
        onReset: () => {
          workingThreads.clear();
          updatePowerSaveBlocker();
        },
      });
      let schedulesChangedTimer: ReturnType<typeof setTimeout> | null = null;
      const broadcastSchedulesChanged = (): void => {
        if (schedulesChangedTimer) return;
        schedulesChangedTimer = setTimeout(() => {
          schedulesChangedTimer = null;
          mainWindow?.webContents.send(IPC_EVENT_CHANNELS.schedulesChanged);
          remoteAccessController?.getServer()?.publishSupervisorEvent({
            type: "remote-schedules-changed",
          });
        }, 50);
      };
      const scheduleCoordinator = new ScheduleRunCoordinator({
        startThread: (payload) => supervisorClient.call("startThread", payload),
        sendFollowUp: (input) =>
          supervisorClient.call("sendThreadInput", {
            threadId: input.threadId,
            prompt: input.prompt,
            config: input.config,
          }),
        craftAgent: (payload) => supervisorClient.call("craftAgent", payload),
        getAgentStatuses: (wslDistros) => supervisorClient.call("getAgentStatuses", { wslDistros }),
        sendThreadCommand: (command) => {
          if (!mainWindow) return false;
          mainWindow.webContents.send(IPC_EVENT_CHANNELS.remoteThreadCommand, command);
          return true;
        },
        ensureHomeProject: ensureHomeProjectRow,
        getProject: dbGetProject,
        getSharedSettings: () => readSharedSettingsFile(requireCraftStationPaths().settingsPath),
        upsertThread: dbUpsertThread,
        deleteThread: dbDeleteThread,
        threadExists: (threadId) => dbGetThread(threadId) != null,
        insertRun: dbInsertScheduleRun,
        updateRun: dbUpdateScheduleRun,
        getThread: dbGetThread,
        getThreadContextText: (threadId) => {
          try {
            return buildScheduleThreadContextText(dbGetThreadRuntimeItems(threadId));
          } catch {
            return null;
          }
        },
        getThreadTerminalResult: (threadId) => {
          try {
            return extractScheduleRunSummary(dbGetThreadRuntimeItems(threadId));
          } catch {
            return null;
          }
        },
        // Crossagents parity: detached run threads get their harness:nativeId
        // peer address bound once the native session id appears. Lazy lookup —
        // the bus lives inside appControlsMcpIngress, constructed below.
        bindRunThreadAddress: (threadId) => {
          const bus = appControlsMcpIngress?.getInterHarnessMessageBus();
          return bus ? bus.bindNativeAddressForThread(threadId) : Promise.resolve(null);
        },
      });
      scheduleRunCoordinator = scheduleCoordinator;
      const scheduleService = createDeviceScheduleService({
        runTask: (task, invocation) => scheduleCoordinator.runScheduleAsThread(task, invocation),
        onStartupInterrupted: (scheduleId) =>
          dbInterruptScheduleRuns(scheduleId, new Date().toISOString()),
        onChanged: broadcastSchedulesChanged,
      });
      const emitRemoteThreadCommand = (command: RemoteThreadCommand): boolean => {
        if (!mainWindow) return false;
        mainWindow.webContents.send(IPC_EVENT_CHANNELS.remoteThreadCommand, command);
        return true;
      };
      const publishProjectsChanged = (): void => {
        const projects = dbGetProjects();
        remoteAccessController?.getServer()?.publishSupervisorEvent({
          type: "remote-projects-changed",
          projects: remoteProjectCommandResultSchema.parse({ projects }).projects,
        });
        mainWindow?.webContents.send(IPC_EVENT_CHANNELS.projectStateChanged, { projects });
      };
      const sharedAppControlsDeps = buildSharedAppControlsIngressDeps({
        call: (name, payload) => supervisorClient.call(name, payload),
        sendThreadCommand: emitRemoteThreadCommand,
        getSharedSettings: () => readSharedSettingsFile(requireCraftStationPaths().settingsPath),
        publishProjectsChanged,
      });
      prWatchService = createDevicePrWatchService({
        getProject: dbGetProject,
        getPrForBranch: (project, branch) =>
          supervisorClient.call("ghGetPrForBranch", {
            projectLocation: project.location,
            branch,
          }),
        getPrDetails: (project, prNumber) =>
          supervisorClient
            .call("ghGetPrDetails", { projectLocation: project.location, prNumber })
            .then((result) => result.details),
        getPrReviewThreads: (project, prNumber) =>
          supervisorClient
            .call("ghGetPrReviewComments", { projectLocation: project.location, prNumber })
            .then((result) => result.threads),
        getMergeMethod: () =>
          readSharedSettingsFile(requireCraftStationPaths().settingsPath).prMergeMethod,
        mergePr: (project, prNumber, method) =>
          supervisorClient.call("ghMergePr", {
            projectLocation: project.location,
            prNumber,
            method,
            admin: false,
          }),
        onPrMerged: (mergedWatch) =>
          mainWindow?.webContents.send(IPC_EVENT_CHANNELS.prWatchMerged, {
            projectId: mergedWatch.projectId,
            prNumber: mergedWatch.prNumber,
            ...(mergedWatch.worktreePath ? { worktreePath: mergedWatch.worktreePath } : {}),
          }),
        onPrObserved: (observedWatch, pr, details) => {
          mainWindow?.webContents.send(IPC_EVENT_CHANNELS.prWatchStatus, {
            projectId: observedWatch.projectId,
            prNumber: observedWatch.prNumber,
            headBranch: observedWatch.headBranch,
            ...(observedWatch.worktreePath ? { worktreePath: observedWatch.worktreePath } : {}),
            pr,
            ...(details ? { details } : {}),
          } satisfies PrWatchStatusEvent);
          // Paired remote clients read PR state from the git-state snapshot, not
          // this IPC channel, so hand the same observation to the service that
          // publishes their patches.
          gitStateService?.applyObservedPullRequest(observedWatch, pr, details);
        },
        createThread: sharedAppControlsDeps.createThread,
        isThreadActive: (threadId) => {
          const status = dbGetThread(threadId)?.status;
          return status !== undefined && isThreadTurnActive(status);
        },
        ...buildPrWatchExecutionDeps({
          call: (name, payload) => supervisorClient.call(name, payload),
          getSharedSettings: () => readSharedSettingsFile(requireCraftStationPaths().settingsPath),
        }),
      });
      gitStateService = new GitStateService({
        hostId: readOrCreateRemoteAccessIdentity(paths.baseDir).desktopId,
        executor: createGitStateExecutor((name, payload) => supervisorClient.call(name, payload)),
        getProject: dbGetProject,
        onPatch: (patch) => {
          remoteAccessController?.getServer()?.publishSupervisorEvent({
            type: "remote-git-state",
            patch,
          });
          mainWindow?.webContents.send(IPC_EVENT_CHANNELS.gitStateChanged, patch);
        },
      });
      // Latest updater status, captured from the auto-updater's status stream so
      // the app-controls `check_for_update` tool can report the most recent
      // result (the check itself is fire-and-forget and event-driven).
      let lastUpdateStatus: UpdateStatus | null = null;
      // OpenCode GUI threads share one `opencode serve` sidecar per workspace,
      // so MCP endpoint URLs cannot carry a stable per-thread identity. The
      // in-process plugin injects the real calling session per tool call;
      // map it back to the owning thread row via the persisted sessionRef
      // (latest row wins when a session moved between threads).
      const resolveThreadIdBySessionId = (sessionId: string): string | null => {
        try {
          let best: { id: string; updatedAt: string } | null = null;
          for (const thread of dbGetThreads()) {
            if (thread.sessionRef?.providerSessionId !== sessionId) continue;
            if (!best || thread.updatedAt > best.updatedAt) best = thread;
          }
          return best?.id ?? null;
        } catch {
          return null;
        }
      };
      appControlsMcpIngress = new AppControlsMcpIngress({
        getThread: dbGetThread,
        getThreads: dbGetThreads,
        getProjects: dbGetProjects,
        getProject: dbGetProject,
        getProjectNotes: dbGetProjectNotes,
        resolveThreadIdBySessionId,
        ...sharedAppControlsDeps,
        settings: {
          read: () => readSharedSettingsFile(requireCraftStationPaths().settingsPath),
          write: (next) => {
            writeSharedSettingsFile(requireCraftStationPaths().settingsPath, next);
            updatePowerSaveBlocker();
            handleSharedSettingsChanged(next);
            mainWindow?.webContents.send(IPC_EVENT_CHANNELS.sharedSettingsChanged, next);
          },
        },
        getAppInfo: () => ({
          version: app.getVersion(),
          platform: process.platform,
          hasRendererWindow: mainWindow !== null && !mainWindow.isDestroyed(),
        }),
        supervisor: createAppControlsSupervisorCaller((name, payload) =>
          supervisorClient.call(name, payload),
        ),
        emitRemoteThreadCommand,
        // The desktop always has (or ensures) a main window to open into.
        openThreadInUi: (threadId) => {
          openThreadFromTray(threadId);
          return true;
        },
        notifyUser: ({ title, body, threadId }) => {
          const input = { title, body, threadId };
          const delivered = showInAppNotification(input);
          remoteAccessController?.getServer()?.publishSupervisorEvent({
            type: "thread-user-notification",
            ...input,
          });
          return delivered
            ? { delivered: true }
            : {
                delivered: false,
                note: "CraftStation is not ready to show an in-app notification.",
              };
        },
        onExchangeChanged: (exchange) => {
          remoteAccessController?.getServer()?.publishSupervisorEvent({
            type: "remote-thread-collaboration-changed",
            exchanges: [toRemoteThreadExchangeSummary(exchange)],
          });
        },
        checkForUpdate: async () => {
          await autoUpdaterController.checkForUpdate();
          const status = lastUpdateStatus;
          const availableVersion =
            status && (status.type === "update-available" || status.type === "downloaded")
              ? status.version
              : undefined;
          return {
            supported: true,
            currentVersion: app.getVersion(),
            ...(status ? { status: status.type } : {}),
            ...(availableVersion ? { availableVersion } : {}),
            note: "A background update check was triggered; its result surfaces in the app's update UI. status/availableVersion reflect the most recent known check, which may predate this call.",
          };
        },
      });

      const autoUpdaterController = createAutoUpdaterController(
        (status) => {
          lastUpdateStatus = status;
          mainWindow?.webContents.send(IPC_EVENT_CHANNELS.updateStatus, status);
        },
        channel,
        isDev,
        captureMainException,
        () => {
          isQuitting = true;
        },
      );

      browserPanelManager = new BrowserPanelManager(paths, browserUserAgent, {
        isExtracted: () => browserExtractWindow !== null && !browserExtractWindow.isDestroyed(),
        focusExtractedWindow: focusBrowserExtractWindow,
      });
      browserMcpIngress = new BrowserMcpIngress();
      browserMcpIngress.setManagerAccessor(() => browserPanelManager);
      // External-Chrome control: a localhost WS bridge the companion extension
      // connects to, plus a `chrome` MCP ingress agents reach the same way as the
      // embedded `browser` server. They live side by side.
      chromeBridgeServer = new ChromeBridgeServer({
        pairingFilePath: join(paths.baseDir, "chrome-bridge.json"),
      });
      chromeMcpIngress = new ChromeMcpIngress();
      chromeMcpIngress.setConnectionAccessor(() => chromeBridgeServer?.getConnection() ?? null);
      primeBrowserAllowFlags(initialSettings);
      const mcpInfoReady = browserMcpIngress.start().catch((err) => {
        console.error("[craftstation] browser MCP ingress failed to start:", err);
        return null;
      });
      const chromeMcpReady = chromeMcpIngress.start().catch((err) => {
        console.error("[craftstation] chrome MCP ingress failed to start:", err);
        return null;
      });
      const appControlsMcpReady = appControlsMcpIngress.start().catch((err) => {
        console.error("[craftstation] app controls MCP ingress failed to start:", err);
        return null;
      });
      scheduleMcpIngress = new ScheduleMcpIngress({
        scheduleService,
        getThread: dbGetThread,
        resolveThreadIdBySessionId,
        // Schedule and Crossagents share ONE address space: native addresses
        // and sidebar UUIDs resolve through the same InterHarnessMessageBus.
        resolvePeerTarget: (target, sourceThreadId) =>
          appControlsMcpIngress!
            .getInterHarnessMessageBus()
            .resolvePeerTarget(target, sourceThreadId),
        peerAddressOfThread: (threadId) =>
          appControlsMcpIngress!.getInterHarnessMessageBus().peerAddressForThread(threadId),
      });
      const scheduleMcpReady = scheduleMcpIngress.start().catch((err) => {
        console.error("[craftstation] schedule MCP ingress failed to start:", err);
        return null;
      });
      // Independent persistent peer-messaging ingress over the same durable
      // ledger. It shares the message bus with app-controls but owns its own
      // endpoint, tool registry, and lifecycle.
      crossagentsMcpIngress = new CrossagentsMcpIngress({
        bus: appControlsMcpIngress.getInterHarnessMessageBus(),
      });
      const crossagentsMcpReady = crossagentsMcpIngress.start().catch((err) => {
        console.error("[craftstation] crossagents MCP ingress failed to start:", err);
        return null;
      });
      chromeBridgeServer.start().catch((err) => {
        console.error("[craftstation] chrome bridge server failed to start:", err);
      });
      // Computer-use drives the host desktop and is only supported on macOS and
      // Windows (matches createComputerUseDriver). On other platforms the ingress
      // would advertise tools that all fail and would still inject a token into
      // launches, so skip it entirely — resolveExtraEnv then naturally yields
      // nothing because getInfo() stays null.
      let computerUseMcpInfoReady: Promise<ComputerUseMcpIngressInfo | null> =
        Promise.resolve(null);
      if (process.platform === "win32" || process.platform === "darwin") {
        computerUseDesktopOverlay = new ComputerUseDesktopOverlay({
          onExit: (threadIds) => {
            computerUseMcpIngress?.interruptActiveActions();
            for (const threadId of threadIds) {
              void supervisorClient.call("interruptThread", { threadId }).catch((error) => {
                console.error(
                  `[craftstation] failed to interrupt computer-use thread ${threadId}:`,
                  error,
                );
              });
            }
          },
        });
        computerUseMcpIngress = new ComputerUseMcpIngress({
          onActivity: (event) => computerUseDesktopOverlay?.setActivity(event),
          onPointer: (motion) => computerUseDesktopOverlay?.movePointer(motion),
        });
        computerUseMcpInfoReady = computerUseMcpIngress.start().catch((err) => {
          console.error("[craftstation] computer use MCP ingress failed to start:", err);
          return null;
        });
      }

      const controller = createDesktopRemoteAccessController({
        appVersion: app.getVersion(),
        channel,
        paths,
        ...(process.env.VITE_DEV_SERVER_URL
          ? { devServerUrl: process.env.VITE_DEV_SERVER_URL }
          : {}),
        callSupervisor: (name, payload) => supervisorClient.call(name, payload),
        dispatchThreadCommand: (command) => {
          if (!mainWindow) return false;
          mainWindow.webContents.send(IPC_EVENT_CHANNELS.remoteThreadCommand, command);
          return true;
        },
        getBrowserPanelManager: () => browserPanelManager,
        notifySharedSettingsChanged: (settings) => {
          updatePowerSaveBlocker();
          mainWindow?.webContents.send(IPC_EVENT_CHANNELS.sharedSettingsChanged, settings);
        },
        notifyRemoteAccessPairingChanged: (info) => {
          mainWindow?.webContents.send(IPC_EVENT_CHANNELS.remoteAccessPairingChanged, info);
        },
        notifyProjectStateChanged: (projects) => {
          mainWindow?.webContents.send(IPC_EVENT_CHANNELS.projectStateChanged, { projects });
        },
        reportError: captureMainException,
        scheduleService,
        prWatchService,
        gitStateService,
        getThreadCollaborationService: () =>
          appControlsMcpIngress?.getThreadCollaborationService() ?? null,
        updates: {
          currentVersion: () => app.getVersion(),
          status: () => lastUpdateStatus,
          check: () => autoUpdaterController.checkForUpdate(),
          install: () => autoUpdaterController.installUpdate(),
        },
      });
      remoteAccessController = controller;

      quickComposerShortcutManager = new QuickComposerShortcutManager(
        globalShortcut,
        process.platform,
        toggleQuickComposerWindow,
        (accelerator) => {
          tray?.setQuickComposerShortcut(accelerator);
          if (accelerator) {
            console.log(`[craftstation] registered ${accelerator} for quick composer`);
          }
        },
      );
      try {
        quickComposerShortcutManager.apply(
          readKeybindingsFile(requireCraftStationPaths().keybindingsPath).file,
        );
      } catch (error) {
        console.warn("[craftstation] failed to register the quick composer shortcut", error);
      }

      registerIpcHandlers({
        localHandlers: createLocalIpcHandlers({
          getMainWindow: () => mainWindow,
          getBrowserPanelManager: () => browserPanelManager,
          getRemoteAccessServer: controller.getServer,
          setRemoteAccessEnabled: controller.setEnabled,
          getRemoteAccessTailscaleStatus: controller.getTailscaleStatus,
          setRemoteAccessTailscaleHttps: controller.setTailscaleHttps,
          startTailscale: controller.startTailscale,
          setRemoteAccessAdvertisedUrl: controller.setAdvertisedUrl,
          sshConnectionManager,
          requireCraftStationPaths,
          updatePowerSaveBlocker,
          autoUpdater: autoUpdaterController,
          onSharedSettingsChanged: handleSharedSettingsChanged,
          onShowNotification: showInAppNotification,
          onKeybindingsChanged: (file) => quickComposerShortcutManager?.apply(file),
          setGlobalShortcutsSuspended: (suspended) => globalShortcut.setSuspended(suspended),
          onRemoteGitSummaries: controller.updateGitSummaries,
          extractBrowserToWindow,
          injectBrowserToMain,
          requestRelaunch: () => {
            isQuitting = true;
            app.relaunch();
            app.quit();
          },
          scheduleService,
          prWatchService,
          getThreadCollaborationService: () =>
            appControlsMcpIngress?.getThreadCollaborationService() ?? null,
        }),
        callSupervisor: (name, payload) => supervisorClient.call(name, payload),
      });

      ipcMain.handle(IPC_WINDOW_CHANNELS.quickComposerSubmit, (event, payload: unknown) => {
        const overlay = quickComposerWindowFor(event);
        if (!overlay) return;
        const submission = quickComposerSubmissionSchema.parse(payload);
        pendingQuickComposerSubmissions.push(submission);
        revealMainAfterQuickComposerDismiss = true;
        ensureMainWindow(false);
        flushQuickComposerSubmissions();
        if (quickComposerDismissTimer) clearTimeout(quickComposerDismissTimer);
        quickComposerDismissTimer = setTimeout(() => finishQuickComposerDismiss(overlay), 800);
      });
      ipcMain.handle(IPC_WINDOW_CHANNELS.quickComposerDismiss, (event) => {
        const overlay = quickComposerWindowFor(event);
        if (overlay) finishQuickComposerDismiss(overlay);
      });
      ipcMain.handle(IPC_WINDOW_CHANNELS.quickComposerPickFiles, async (event) => {
        const overlay = quickComposerWindowFor(event);
        if (!overlay) return null;
        quickComposerDialogOpen = true;
        const wasVisible = overlay.isVisible();
        try {
          return await showAddFilesDialog(overlay);
        } finally {
          quickComposerDialogOpen = false;
          if (wasVisible && !overlay.isDestroyed()) showQuickComposerWindow(overlay);
        }
      });
      ipcMain.handle(IPC_WINDOW_CHANNELS.quickComposerMainReady, (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window || window !== mainWindow || window.isDestroyed()) return;
        mainRendererReady = true;
        flushQuickComposerSubmissions();
        flushTrayThreadOpen();
        flushInAppNotifications();
      });
      ipcMain.handle(IPC_WINDOW_CHANNELS.taskbarAttentionDismiss, (event, threadId: unknown) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window || window !== mainWindow || window.isDestroyed()) return;
        if (typeof threadId !== "string" || threadId.length === 0) return;
        taskbarAttention?.dismissThread(threadId);
      });
      ipcMain.handle(IPC_WINDOW_CHANNELS.rendererReload, (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (window) requestTrackedRendererReload(window);
      });

      const initialMainWindow = ensureMainWindow(showMainWindowOnReady);

      tray = createTray({
        channel,
        appName: getAppName(channel, isDev),
        getProjects: dbGetProjects,
        getThreads: dbGetThreads,
        onOpenThread: openThreadFromTray,
        onShow: () => showAndFocusWindow(ensureMainWindow()),
        onQuickComposer: toggleQuickComposerWindow,
        onQuit: () => {
          isQuitting = true;
          app.quit();
        },
      });
      tray.setQuickComposerShortcut(quickComposerShortcutManager.active[0] ?? null);
      onProjectThreadDataChanged(() => tray?.refreshMenu());

      await jobObjectReady;

      const hookDebugOn =
        Boolean(process.env.CRAFTSTATION_HOOK_DEBUG) && process.env.CRAFTSTATION_HOOK_DEBUG !== "0";
      if (hookDebugOn) {
        console.log(
          "[craftstation] CRAFTSTATION_HOOK_DEBUG is on — watch for [supervisor] hook-debug lines (HookIngress, WSL bridge, L1/L2 spawn, envelopes).",
        );
      }

      await Promise.all([
        mcpInfoReady,
        chromeMcpReady,
        computerUseMcpInfoReady,
        appControlsMcpReady,
        scheduleMcpReady,
        crossagentsMcpReady,
      ]);
      supervisorClient.start(paths.baseDir);
      // Durable thread-collaboration recovery re-delivers queued exchanges
      // through the supervisor (snapshots / sendThreadInput), so it can only
      // run after the supervisor starts — never inside the MCP boot gate
      // above, where a single queued exchange deadlocks boot (the gate awaits
      // recovery while recovery awaits the supervisor). Mirrors the headless
      // host ordering in createHeadlessRemoteHost.
      void appControlsMcpIngress
        ?.recoverThreadCollaboration()
        .catch((err) => console.error("[craftstation] thread collaboration recovery failed:", err));
      scheduleService.start();
      prWatchService.start();
      gitStateService.start();
      // The remote controller performs one bounded warm-up when enabled.
      // Recurring Git refreshes remain demand-driven by connected clients.

      updatePowerSaveBlocker();
      void controller.startIfEnabled();

      initialMainWindow.once("ready-to-show", () => {
        setTimeout(() => {
          const attachmentPaths = requireCraftStationPaths();
          cleanupOrphanedAttachments(
            attachmentPaths.attachmentsDir,
            dbGetThreads().map((thread) => thread.id),
          );
        }, 0);
      });

      if (!isDev) {
        autoUpdaterController.initialize();
      }

      if (isDev) {
        let debounce: ReturnType<typeof setTimeout> | null = null;
        watch(supervisorPath, () => {
          if (debounce) {
            clearTimeout(debounce);
          }
          debounce = setTimeout(() => {
            console.log("[craftstation] supervisor changed, restarting…");
            supervisorClient.start(requireCraftStationPaths().baseDir);
          }, 200);
        });
      }

      app.on("activate", () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          showAndFocusWindow(mainWindow);
          return;
        }
        ensureMainWindow();
      });

      app.on("before-quit", () => {
        isQuitting = true;
        quickComposerShortcutManager?.dispose();
        quickComposerShortcutManager = null;
        if (quickComposerDismissTimer) clearTimeout(quickComposerDismissTimer);
        quickComposerDismissTimer = null;
        pendingQuickComposerSubmissions.length = 0;
        scheduleService.dispose();
        prWatchService.dispose();
        gitStateService.dispose();
        supervisorClient.dispose();
        windowsJobObjectManager?.dispose();
        windowsJobObjectManager = null;
        browserMcpIngress?.dispose();
        browserMcpIngress = null;
        computerUseMcpIngress?.dispose();
        computerUseMcpIngress = null;
        appControlsMcpIngress?.dispose();
        appControlsMcpIngress = null;
        taskbarAttention?.dispose();
        taskbarAttention = null;
        scheduleMcpIngress?.dispose();
        scheduleMcpIngress = null;
        crossagentsMcpIngress?.dispose();
        crossagentsMcpIngress = null;
        computerUseDesktopOverlay?.dispose();
        computerUseDesktopOverlay = null;
        chromeMcpIngress?.dispose();
        chromeMcpIngress = null;
        chromeBridgeServer?.dispose();
        chromeBridgeServer = null;
        void controller.dispose();
        void sshConnectionManager.dispose();
        browserExtractWindow?.close();
        browserExtractWindow = null;
        quickComposerWindow?.close();
        quickComposerWindow = null;
        browserPanelManager?.dispose();
        browserPanelManager = null;
        sleepInhibitor.dispose();
        tray?.destroy();
        tray = null;
      });
    })
    .catch((error: unknown) => {
      console.error("[craftstation] failed to initialize:", error);
      captureMainException(error, { "craftstation.feature_area": "main-initialization" });
      app.quit();
    });
}

app.on("will-quit", () => {
  closeDatabase();
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin" || tray?.available) return;
  app.quit();
});
