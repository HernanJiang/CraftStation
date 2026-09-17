import { autoUpdater } from "electron-updater";
import type { CraftStationChannel } from "@/shared/channel";
import type { UpdateStatus } from "@/shared/ipc";
import type { CraftStationDiagnosticTags } from "@/shared/diagnostics/sentryPrivacy";
import {
  buildUpdateDiagnosticTags,
  classifyUpdateFailure,
  UpdateDiagnosticError,
  type UpdateFailureKind,
  type UpdateOperation,
} from "./updateErrorPolicy";

/**
 * Delay before the first update check once the app is ready. Matches VS Code's
 * update service, which waits ~30s after startup before its first check.
 */
const INITIAL_CHECK_DELAY_MS = 30_000;

/**
 * Cadence for recurring background update checks while the app keeps running.
 * Modeled on VS Code's update service, which polls hourly after startup so a
 * long-lived window still discovers releases without ever being restarted.
 */
const PERIODIC_CHECK_INTERVAL_MS = 60 * 60 * 1_000;
const CHECK_REQUEST_TIMEOUT_MS = 8_000;
const CHECK_RETRY_DELAYS_MS = [400] as const;
const DOWNLOAD_RETRY_DELAYS_MS = [500, 1_000] as const;
/** No download-progress bytes for this long ⇒ treat the download as stalled. */
const DOWNLOAD_STALL_TIMEOUT_MS = 120_000;
const DOWNLOAD_STALL_POLL_MS = 15_000;
const TRANSIENT_REPORT_COOLDOWN_MS = 6 * 60 * 60 * 1_000;
const GITHUB_UPDATE_OWNER = "HernanJiang";
const GITHUB_UPDATE_REPO = "CraftStation";
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_UPDATE_OWNER}/${GITHUB_UPDATE_REPO}/releases`;

function isPortableWindowsBuild(): boolean {
  return Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} timed out after ${ms}ms`);
      error.name = "TimeoutError";
      reject(error);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export interface AutoUpdaterController {
  initialize(): void;
  checkForUpdate(): Promise<void>;
  startUpdateDownload(): Promise<void>;
  installUpdate(): void;
}

export function createAutoUpdaterController(
  sendStatus: (status: UpdateStatus) => void,
  channel: CraftStationChannel,
  isDev: boolean,
  reportError: (error: unknown, tags?: CraftStationDiagnosticTags) => void = () => {},
  beforeInstall: () => void = () => {},
): AutoUpdaterController {
  let initialized = false;
  // True while a check or download is in flight; gates the periodic timer so a
  // scheduled tick never stacks a redundant check on top of an active one.
  let checkInFlight = false;
  // True once an update is downloaded and waiting to install; we stop polling
  // until the user restarts to apply it.
  let updateReady = false;
  let periodicTimer: ReturnType<typeof setInterval> | null = null;
  let checkPromise: Promise<void> | null = null;
  let downloadPromise: Promise<void> | null = null;
  let updateAvailable = false;
  let activeAttempt: { operation: UpdateOperation; eventError: unknown | null } | null = null;
  // User-initiated checks/downloads toast; launch/hourly probes stay silent.
  let notifyOnFailure = false;
  const transientReportTimes = new Map<string, number>();
  // Stall guard for downloads that stop emitting progress without settling.
  let lastDownloadProgressAt = 0;
  let stallTimer: ReturnType<typeof setInterval> | null = null;

  function sendFailureStatus(failure: { kind: UpdateFailureKind }, notify: boolean): void {
    if (!notify || failure.kind === "optional-manifest-missing") {
      sendStatus({ type: "update-not-available" });
      return;
    }
    sendStatus({
      type: "error",
      messageKey:
        failure.kind === "transient-network"
          ? "update.serviceUnavailable"
          : "update.operationFailed",
    });
  }

  function reportClassifiedFailure(operation: UpdateOperation, outcome: UpdateFailureKind): void {
    if (
      outcome === "optional-manifest-missing" ||
      (outcome === "required-manifest-missing" && !notifyOnFailure)
    ) {
      console.warn("[craftstation] update manifest is not available.");
      return;
    }
    if (outcome === "transient-network") {
      const key = `${operation}:${outcome}`;
      const now = Date.now();
      const lastReportAt = transientReportTimes.get(key);
      if (lastReportAt !== undefined && now - lastReportAt < TRANSIENT_REPORT_COOLDOWN_MS) {
        return;
      }
      transientReportTimes.set(key, now);
      console.warn(`[craftstation] updater ${operation} transient failure after retries.`);
      return;
    }
    reportError(
      new UpdateDiagnosticError(operation, outcome),
      buildUpdateDiagnosticTags(channel, operation, outcome),
    );
  }

  async function runOperation(
    operation: UpdateOperation,
    invoke: () => Promise<unknown>,
  ): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      const attemptState = { operation, eventError: null as unknown | null };
      activeAttempt = attemptState;
      try {
        await invoke();
        if (attemptState.eventError) {
          throw attemptState.eventError instanceof Error
            ? attemptState.eventError
            : new Error("Updater emitted a non-Error failure.");
        }
        return;
      } catch (error) {
        const failure = classifyUpdateFailure(attemptState.eventError ?? error, operation, channel);
        const retryDelay = (
          operation === "check" ? CHECK_RETRY_DELAYS_MS : DOWNLOAD_RETRY_DELAYS_MS
        )[attempt];
        if (failure.retryable && retryDelay !== undefined) {
          if (activeAttempt === attemptState) activeAttempt = null;
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          continue;
        }
        reportClassifiedFailure(operation, failure.kind);
        const notify = operation === "download" || notifyOnFailure;
        sendFailureStatus(failure, notify);
        if (!notify || failure.kind === "optional-manifest-missing") {
          return;
        }
        throw error;
      } finally {
        if (activeAttempt === attemptState) {
          activeAttempt = null;
        }
      }
    }
  }

  function beginDownload(): Promise<void> {
    if (downloadPromise) return downloadPromise;
    checkInFlight = true;
    notifyOnFailure = true;
    lastDownloadProgressAt = Date.now();
    armDownloadStallGuard();
    downloadPromise = runOperation("download", () => autoUpdater.downloadUpdate()).finally(() => {
      downloadPromise = null;
      disarmDownloadStallGuard();
      notifyOnFailure = false;
      if (!updateReady) checkInFlight = false;
    });
    return downloadPromise;
  }

  // A stalled download (no bytes for STALL_TIMEOUT) never settles on its own:
  // progress events stop, no error fires, and every later check/download
  // no-ops against the stuck promise while the UI shows nothing. Trip it into
  // a visible transient-network error and release the gates so the next check
  // retries. A late underlying completion still lands via update-downloaded.
  function armDownloadStallGuard(): void {
    disarmDownloadStallGuard();
    stallTimer = setInterval(() => {
      if (!downloadPromise || updateReady) {
        disarmDownloadStallGuard();
        return;
      }
      if (Date.now() - lastDownloadProgressAt <= DOWNLOAD_STALL_TIMEOUT_MS) return;
      disarmDownloadStallGuard();
      downloadPromise = null;
      checkInFlight = false;
      reportClassifiedFailure("download", "transient-network");
      sendFailureStatus({ kind: "transient-network" }, true);
    }, DOWNLOAD_STALL_POLL_MS);
    stallTimer.unref?.();
  }

  function disarmDownloadStallGuard(): void {
    if (stallTimer) {
      clearInterval(stallTimer);
      stallTimer = null;
    }
  }

  function beginCheck(notify: boolean): Promise<void> {
    // Acknowledge every check up front — including ones that dedupe onto an
    // in-flight run — so the update menu never sits silent while main decides.
    sendStatus({ type: "checking" });
    if (checkPromise) return checkPromise;
    checkInFlight = true;
    notifyOnFailure = notify;
    updateAvailable = false;
    checkPromise = runOperation("check", () =>
      withTimeout(
        Promise.resolve().then(() => autoUpdater.checkForUpdates()),
        CHECK_REQUEST_TIMEOUT_MS,
        "update check",
      ),
    )
      .then(() => {
        if (updateAvailable && !updateReady && !isPortableWindowsBuild()) {
          void beginDownload().catch(() => {});
        } else {
          checkInFlight = false;
        }
      })
      .catch(() => {
        checkInFlight = false;
      })
      .finally(() => {
        checkPromise = null;
        if (!downloadPromise) notifyOnFailure = false;
      });
    return checkPromise;
  }

  // Fire a background check, but only when the updater is otherwise idle. Used
  // by both the initial launch check and the recurring interval.
  function runScheduledCheck(): void {
    if (checkInFlight || updateReady) {
      return;
    }
    void beginCheck(false);
  }

  function initialize(): void {
    if (initialized) {
      return;
    }
    initialized = true;

    // Keep downloads automatic from the user's perspective, while invoking
    // downloadUpdate ourselves so transient retries and final reporting belong
    // to one typed operation instead of the updater's global error event.
    autoUpdater.autoDownload = false;
    // A renderer stuck during hydration cannot reach the normal install
    // button. Once an update is downloaded, Cmd/Ctrl+Q still provides a
    // main-process-owned recovery path that applies it on quit.
    autoUpdater.autoInstallOnAppQuit = !isPortableWindowsBuild();
    autoUpdater.forceDevUpdateConfig = Boolean(process.env.UPDATE_SERVER_URL);
    (autoUpdater as { requestTimeout?: number }).requestTimeout = CHECK_REQUEST_TIMEOUT_MS;

    if (channel === "nightly") {
      autoUpdater.channel = "nightly";
      autoUpdater.allowPrerelease = true;
    } else {
      autoUpdater.allowPrerelease = false;
    }

    const localUpdateUrl = process.env.UPDATE_SERVER_URL;
    if (localUpdateUrl) {
      autoUpdater.setFeedURL({ provider: "generic", url: localUpdateUrl });
    } else {
      autoUpdater.setFeedURL({
        provider: "github",
        owner: GITHUB_UPDATE_OWNER,
        repo: GITHUB_UPDATE_REPO,
      });
    }

    autoUpdater.on("checking-for-update", () => {
      checkInFlight = true;
      sendStatus({ type: "checking" });
    });
    autoUpdater.on("update-available", (info) => {
      updateAvailable = true;
      if (isPortableWindowsBuild()) {
        checkInFlight = false;
        sendStatus({
          type: "update-available",
          version: info.version,
          manualDownloadUrl: GITHUB_RELEASES_URL,
          openDownload: notifyOnFailure,
        });
        return;
      }
      checkInFlight = true;
      sendStatus({ type: "update-available", version: info.version });
    });
    autoUpdater.on("update-not-available", () => {
      checkInFlight = false;
      sendStatus({ type: "update-not-available" });
    });
    autoUpdater.on("download-progress", (progress) => {
      checkInFlight = true;
      lastDownloadProgressAt = Date.now();
      sendStatus({
        type: "downloading",
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      });
    });
    autoUpdater.on("update-downloaded", (info) => {
      checkInFlight = false;
      updateReady = true;
      sendStatus({ type: "downloaded", version: info.version });
    });
    autoUpdater.on("error", (error) => {
      if (activeAttempt) {
        activeAttempt.eventError = error;
        return;
      }
      const operation: UpdateOperation = downloadPromise ? "download" : "check";
      const failure = classifyUpdateFailure(error, operation, channel);
      reportClassifiedFailure(operation, failure.kind);
      checkInFlight = false;
      sendFailureStatus(failure, operation === "download" || notifyOnFailure);
    });

    // First check ~30s after launch, then keep checking hourly so an app that
    // is never restarted still surfaces new releases (the sidebar install
    // affordance reacts to the resulting status).
    setTimeout(runScheduledCheck, INITIAL_CHECK_DELAY_MS);
    periodicTimer = setInterval(runScheduledCheck, PERIODIC_CHECK_INTERVAL_MS);
    // Don't let the recurring timer keep the process alive on its own.
    periodicTimer.unref?.();
  }

  async function checkForUpdate(): Promise<void> {
    if (isDev && !process.env.UPDATE_SERVER_URL) {
      sendStatus({ type: "error", messageKey: "update.devUnavailable" });
      return;
    }
    try {
      await beginCheck(true);
    } catch {
      // beginCheck owns classification, reporting, and UI status. Keep this IPC
      // resolved because the renderer invokes it fire-and-forget.
    }
  }

  async function startUpdateDownload(): Promise<void> {
    await beginDownload();
  }

  function installUpdate(): void {
    // Stop the recurring check so it can't race quitAndInstall.
    if (periodicTimer) {
      clearInterval(periodicTimer);
      periodicTimer = null;
    }
    beforeInstall();
    autoUpdater.quitAndInstall(process.platform === "win32", true);
  }

  return {
    initialize,
    checkForUpdate,
    startUpdateDownload,
    installUpdate,
  };
}
