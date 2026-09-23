import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateStatus } from "@/shared/ipc";

const autoUpdaterMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    forceDevUpdateConfig: false,
    allowPrerelease: false,
    channel: "",
    checkForUpdates: vi.fn<() => Promise<void>>(),
    downloadUpdate: vi.fn<() => Promise<void>>(),
    on: vi.fn<(event: string, listener: (...args: unknown[]) => void) => void>(
      (event, listener) => {
        handlers.set(event, listener);
      },
    ),
    quitAndInstall: vi.fn<(isSilent?: boolean, isForceRunAfter?: boolean) => void>(),
    setFeedURL: vi.fn<(options: unknown) => void>(),
    requestTimeout: undefined as number | undefined,
    disableDifferentialDownload: false,
    /** Test helper: invoke a registered electron-updater event listener. */
    emit(event: string, ...args: unknown[]) {
      handlers.get(event)?.(...args);
    },
  };
});

vi.mock("electron-updater", () => ({
  autoUpdater: autoUpdaterMock,
}));

import { createAutoUpdaterController } from "./autoUpdater";

const INITIAL_CHECK_DELAY_MS = 30_000;
const PERIODIC_CHECK_INTERVAL_MS = 60 * 60 * 1_000;

describe("createAutoUpdaterController", () => {
  let previousPortableDir: string | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    previousPortableDir = process.env.PORTABLE_EXECUTABLE_DIR;
    delete process.env.PORTABLE_EXECUTABLE_DIR;
    autoUpdaterMock.checkForUpdates.mockResolvedValue(undefined);
    autoUpdaterMock.downloadUpdate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (previousPortableDir === undefined) delete process.env.PORTABLE_EXECUTABLE_DIR;
    else process.env.PORTABLE_EXECUTABLE_DIR = previousPortableDir;
  });

  it("runs the install hook before quitAndInstall", () => {
    const beforeInstall = vi.fn<() => void>();
    const controller = createAutoUpdaterController(
      vi.fn(),
      "stable",
      false,
      vi.fn(),
      beforeInstall,
    );

    controller.installUpdate();

    expect(beforeInstall.mock.invocationCallOrder[0]!).toBeLessThan(
      autoUpdaterMock.quitAndInstall.mock.invocationCallOrder[0]!,
    );
    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledWith(process.platform === "win32", true);
  });

  it("keeps automatic delivery controller-owned and installs on app quit", () => {
    autoUpdaterMock.autoInstallOnAppQuit = false;
    const controller = createAutoUpdaterController(vi.fn(), "stable", false);

    controller.initialize();

    expect(autoUpdaterMock.autoDownload).toBe(false);
    expect(autoUpdaterMock.disableDifferentialDownload).toBe(true);
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(true);
    expect(autoUpdaterMock.requestTimeout).toBe(8_000);
    expect(autoUpdaterMock.setFeedURL).toHaveBeenCalledWith({
      provider: "github",
      owner: "HernanJiang",
      repo: "CraftStation",
    });
  });

  it("starts the controller-owned download when a check finds an update", async () => {
    const controller = createAutoUpdaterController(vi.fn(), "stable", false);
    controller.initialize();
    autoUpdaterMock.checkForUpdates.mockImplementationOnce(async () => {
      autoUpdaterMock.emit("update-available", { version: "1.2.3" });
    });

    await controller.checkForUpdate();

    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledOnce();
  });

  it("treats a missing nightly manifest as an optional probe", async () => {
    const sendStatus = vi.fn<(status: { type: string; message?: string }) => void>();
    const reportError = vi.fn<(error: unknown, tags?: Record<string, string>) => void>();
    const controller = createAutoUpdaterController(sendStatus, "nightly", false, reportError);
    controller.initialize();

    const failure = Object.assign(
      new Error("Cannot find nightly-mac.yml in the latest release artifacts (404)"),
      { statusCode: 404 },
    );
    autoUpdaterMock.checkForUpdates.mockImplementationOnce(async () => {
      autoUpdaterMock.emit("error", failure);
      throw failure;
    });

    await expect(controller.checkForUpdate()).resolves.toBeUndefined();

    expect(sendStatus).toHaveBeenCalledWith({ type: "update-not-available" });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("keeps automatic check failures silent", async () => {
    const sendStatus = vi.fn<(status: { type: string; message?: string }) => void>();
    const controller = createAutoUpdaterController(sendStatus, "stable", false, vi.fn());
    controller.initialize();
    const failure = Object.assign(new Error("latest-mac.yml returned 404"), { statusCode: 404 });
    autoUpdaterMock.checkForUpdates.mockImplementationOnce(async () => {
      autoUpdaterMock.emit("error", failure);
      throw failure;
    });

    // Launch/CLI-menu auto-checks must never surface an error row or toast —
    // they report as "not available", exactly like the hourly poll.
    await expect(controller.checkForUpdate({ automatic: true })).resolves.toBeUndefined();

    expect(sendStatus).toHaveBeenCalledWith({ type: "checking" });
    expect(sendStatus).toHaveBeenCalledWith({ type: "update-not-available" });
    expect(sendStatus).not.toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
  });

  it("keeps unsupported development auto-checks silent while preserving manual feedback", async () => {
    vi.stubEnv("UPDATE_SERVER_URL", undefined);
    try {
      const sendStatus = vi.fn<(status: UpdateStatus) => void>();
      const controller = createAutoUpdaterController(sendStatus, "stable", true, vi.fn());
      await controller.checkForUpdate({ automatic: true });
      expect(sendStatus).not.toHaveBeenCalled();
      expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled();
      await controller.checkForUpdate({});
      expect(sendStatus).toHaveBeenCalledExactlyOnceWith({
        type: "error",
        messageKey: "update.devUnavailable",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps a missing stable manifest observable with normalized tags", async () => {
    const reportError = vi.fn<(error: unknown, tags?: Record<string, string>) => void>();
    const controller = createAutoUpdaterController(vi.fn(), "stable", false, reportError);
    controller.initialize();
    const failure = Object.assign(new Error("latest-mac.yml returned 404"), { statusCode: 404 });
    autoUpdaterMock.checkForUpdates.mockImplementationOnce(async () => {
      autoUpdaterMock.emit("error", failure);
      throw failure;
    });

    await controller.checkForUpdate();

    expect(reportError).toHaveBeenCalledOnce();
    expect(reportError.mock.calls[0]?.[0]).toMatchObject({
      name: "UpdateDiagnosticError",
      message: "Updater check failed: required-manifest-missing.",
    });
    expect(reportError.mock.calls[0]?.[1]).toEqual({
      "craftstation.feature_area": "updates",
      "craftstation.channel": "stable",
      "craftstation.platform": process.platform,
      "event.origin": "updater.check.required-manifest-missing",
    });
  });

  it("does not report transient check failures when a retry succeeds", async () => {
    const reportError = vi.fn<(error: unknown, tags?: Record<string, string>) => void>();
    const controller = createAutoUpdaterController(vi.fn(), "stable", false, reportError);
    controller.initialize();
    const transient = Object.assign(new Error("socket closed"), { code: "ECONNRESET" });
    autoUpdaterMock.checkForUpdates
      .mockImplementationOnce(async () => {
        autoUpdaterMock.emit("error", transient);
        throw transient;
      })
      .mockResolvedValueOnce(undefined);

    const checking = controller.checkForUpdate();
    await vi.advanceTimersByTimeAsync(400);
    await checking;

    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("logs one bounded warning without capturing exhausted transient retries as errors", async () => {
    const reportError = vi.fn<(error: unknown, tags?: Record<string, string>) => void>();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sendStatus = vi.fn<(status: UpdateStatus) => void>();
    const controller = createAutoUpdaterController(sendStatus, "stable", false, reportError);
    controller.initialize();
    const transient = Object.assign(new Error("socket closed"), { code: "EPIPE" });
    autoUpdaterMock.checkForUpdates.mockImplementation(async () => {
      autoUpdaterMock.emit("error", transient);
      throw transient;
    });

    const first = controller.checkForUpdate();
    await vi.advanceTimersByTimeAsync(400);
    await first;
    const second = controller.checkForUpdate();
    await vi.advanceTimersByTimeAsync(400);
    await second;

    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(4);
    expect(reportError).not.toHaveBeenCalled();
    expect(sendStatus).toHaveBeenLastCalledWith({
      type: "error",
      messageKey: "update.serviceUnavailable",
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "[craftstation] updater check transient failure after retries.",
    );
    warn.mockRestore();
  });

  it("uses a localized message key when update checks are unavailable in development", async () => {
    const sendStatus = vi.fn<(status: UpdateStatus) => void>();
    const controller = createAutoUpdaterController(sendStatus, "stable", true);

    await controller.checkForUpdate();

    expect(sendStatus).toHaveBeenCalledWith({
      type: "error",
      messageKey: "update.devUnavailable",
    });
  });

  it("keeps signature failures observable without sending the raw error", async () => {
    const reportError = vi.fn<(error: unknown, tags?: Record<string, string>) => void>();
    const controller = createAutoUpdaterController(vi.fn(), "stable", false, reportError);
    controller.initialize();
    const failure = new Error(
      "Code signature invalid for /Users/person/private/CraftStation.zip from https://example.test",
    );
    autoUpdaterMock.downloadUpdate.mockImplementationOnce(async () => {
      autoUpdaterMock.emit("error", failure);
      throw failure;
    });

    await expect(controller.startUpdateDownload()).rejects.toBe(failure);

    expect(reportError).toHaveBeenCalledOnce();
    const reported = reportError.mock.calls[0]?.[0] as Error;
    expect(reported.message).toBe("Updater download failed: artifact-integrity.");
    expect(reported.message).not.toContain("/Users/");
    expect(reported.message).not.toContain("https://");
  });

  it("does not toast a scheduled launch check when the GitHub feed is missing", async () => {
    const sendStatus = vi.fn<(status: UpdateStatus) => void>();
    const reportError = vi.fn<(error: unknown, tags?: Record<string, string>) => void>();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const controller = createAutoUpdaterController(sendStatus, "stable", false, reportError);
    controller.initialize();
    const failure = Object.assign(
      new Error(
        "Unable to find latest version on GitHub (https://github.com/HernanJiang/CraftStation/releases/latest), please ensure a production release exists: 404",
      ),
      { statusCode: 404 },
    );
    autoUpdaterMock.checkForUpdates.mockImplementation(async () => {
      autoUpdaterMock.emit("error", failure);
      throw failure;
    });

    await vi.advanceTimersByTimeAsync(INITIAL_CHECK_DELAY_MS);

    expect(sendStatus).toHaveBeenCalledWith({ type: "update-not-available" });
    expect(sendStatus).not.toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
    expect(reportError).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("[craftstation] update manifest is not available.");
    warn.mockRestore();
  });

  it("keeps unexpected scheduled check failures silent", async () => {
    const sendStatus = vi.fn<(status: UpdateStatus) => void>();
    const controller = createAutoUpdaterController(sendStatus, "stable", false);
    controller.initialize();
    const failure = new Error("Updater emitted a non-Error failure.");
    autoUpdaterMock.checkForUpdates.mockImplementation(async () => {
      autoUpdaterMock.emit("error", failure);
      throw failure;
    });

    await vi.advanceTimersByTimeAsync(INITIAL_CHECK_DELAY_MS);

    expect(sendStatus).toHaveBeenCalledWith({ type: "update-not-available" });
    expect(sendStatus).not.toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
  });

  it("still reports a user-initiated missing stable feed", async () => {
    const sendStatus = vi.fn<(status: UpdateStatus) => void>();
    const reportError = vi.fn<(error: unknown, tags?: Record<string, string>) => void>();
    const controller = createAutoUpdaterController(sendStatus, "stable", false, reportError);
    controller.initialize();
    const failure = Object.assign(new Error("latest.yml returned 404"), { statusCode: 404 });
    autoUpdaterMock.checkForUpdates.mockImplementationOnce(async () => {
      autoUpdaterMock.emit("error", failure);
      throw failure;
    });

    await controller.checkForUpdate();

    expect(sendStatus).toHaveBeenCalledWith({
      type: "error",
      messageKey: "update.operationFailed",
    });
    expect(reportError).toHaveBeenCalledOnce();
  });

  it("runs an initial check after launch and then keeps checking on the hourly interval", async () => {
    const controller = createAutoUpdaterController(vi.fn(), "stable", false);
    controller.initialize();

    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(INITIAL_CHECK_DELAY_MS);
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);

    // Settle the in-flight flag (nothing new found) so the next tick may run.
    autoUpdaterMock.emit("update-not-available");

    await vi.advanceTimersByTimeAsync(PERIODIC_CHECK_INTERVAL_MS);
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("skips a periodic check while a check or download is still in flight", async () => {
    const controller = createAutoUpdaterController(vi.fn(), "stable", false);
    controller.initialize();

    await vi.advanceTimersByTimeAsync(INITIAL_CHECK_DELAY_MS);
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);

    // Simulate a check that found an update and is mid-download (no terminal
    // event yet), so the updater is still busy when the interval fires.
    autoUpdaterMock.emit("checking-for-update");
    autoUpdaterMock.emit("download-progress", {
      percent: 42,
      bytesPerSecond: 1000,
      transferred: 420,
      total: 1000,
    });

    await vi.advanceTimersByTimeAsync(PERIODIC_CHECK_INTERVAL_MS);
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("stops checking once an update is downloaded and after install", async () => {
    const controller = createAutoUpdaterController(vi.fn(), "stable", false);
    controller.initialize();

    await vi.advanceTimersByTimeAsync(INITIAL_CHECK_DELAY_MS);
    autoUpdaterMock.emit("update-downloaded", { version: "1.2.3" });

    // An update is staged for install — no point polling further.
    await vi.advanceTimersByTimeAsync(PERIODIC_CHECK_INTERVAL_MS);
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);

    // Installing clears the interval, so advancing time does nothing more.
    controller.installUpdate();
    await vi.advanceTimersByTimeAsync(PERIODIC_CHECK_INTERVAL_MS);
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("starts the download when the update is found after the check deadline", async () => {
    const sendStatus = vi.fn<(status: UpdateStatus) => void>();
    const controller = createAutoUpdaterController(sendStatus, "stable", false);
    controller.initialize();
    autoUpdaterMock.checkForUpdates.mockImplementation(() => new Promise(() => {}));

    const checking = controller.checkForUpdate();
    await vi.advanceTimersByTimeAsync(8_000);
    await vi.advanceTimersByTimeAsync(400);
    await vi.advanceTimersByTimeAsync(8_000);
    await checking;

    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled();
    autoUpdaterMock.emit("update-available", { version: "1.5.7" });
    await vi.advanceTimersByTimeAsync(0);

    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledOnce();
    expect(sendStatus).toHaveBeenCalledWith({ type: "update-available", version: "1.5.7" });
  });

  it("fails a hung GitHub check instead of leaving the UI on Checking", async () => {
    const sendStatus = vi.fn<(status: UpdateStatus) => void>();
    const controller = createAutoUpdaterController(sendStatus, "stable", false);
    controller.initialize();
    autoUpdaterMock.checkForUpdates.mockImplementation(() => new Promise(() => {}));

    const checking = controller.checkForUpdate();
    await vi.advanceTimersByTimeAsync(8_000);
    await vi.advanceTimersByTimeAsync(400);
    await vi.advanceTimersByTimeAsync(8_000);
    await checking;

    expect(sendStatus).toHaveBeenCalledWith({
      type: "error",
      messageKey: "update.serviceUnavailable",
    });
  });
  it("acknowledges every check up front, even a deduped one", async () => {
    const sendStatus = vi.fn<(status: UpdateStatus) => void>();
    const controller = createAutoUpdaterController(sendStatus, "stable", false);
    controller.initialize();
    autoUpdaterMock.checkForUpdates.mockImplementation(() => new Promise(() => {}));

    const first = controller.checkForUpdate();
    const second = controller.checkForUpdate();
    await vi.advanceTimersByTimeAsync(0);

    // The menu never sits silent: both callers get an immediate checking
    // status while electron works, and only one wire check runs.
    expect(sendStatus.mock.calls.filter(([status]) => status.type === "checking")).toHaveLength(2);
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(8_000 + 400 + 8_000);
    await first;
    await second;
  });

  it("trips a stalled download into a visible error and releases the gate", async () => {
    const sendStatus = vi.fn<(status: UpdateStatus) => void>();
    const controller = createAutoUpdaterController(sendStatus, "stable", false);
    controller.initialize();
    // Download starts but never emits progress or settles.
    autoUpdaterMock.downloadUpdate.mockImplementation(() => new Promise(() => {}));

    const first = controller.startUpdateDownload();
    await vi.advanceTimersByTimeAsync(119_000);
    expect(sendStatus).not.toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
    // The guard polls every 15s and trips past 120s of silence (135s tick).
    await vi.advanceTimersByTimeAsync(16_000);

    expect(sendStatus).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
    // The gate is released: a retry actually re-enters downloadUpdate.
    // (The original promises stay pending by design — a late underlying
    // completion still lands via update-downloaded — so never await them.)
    const second = controller.startUpdateDownload();
    await vi.advanceTimersByTimeAsync(0);
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(136_000);
  });

  it("points portable Windows builds at GitHub Releases instead of auto-installing", async () => {
    const previous = process.env.PORTABLE_EXECUTABLE_DIR;
    process.env.PORTABLE_EXECUTABLE_DIR = "D:\\CraftStation";
    try {
      const sendStatus = vi.fn<(status: UpdateStatus) => void>();
      const controller = createAutoUpdaterController(sendStatus, "stable", false);
      controller.initialize();
      autoUpdaterMock.checkForUpdates.mockImplementationOnce(async () => {
        autoUpdaterMock.emit("update-available", { version: "1.2.6" });
      });

      await controller.checkForUpdate();

      expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled();
      expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(false);
      expect(sendStatus).toHaveBeenCalledWith({
        type: "update-available",
        version: "1.2.6",
        manualDownloadUrl: expect.stringMatching(
          /^https:\/\/(github\.com|gitee\.com)\/HernanJiang\/CraftStation\/releases$/,
        ),
        openDownload: true,
      });
    } finally {
      if (previous === undefined) delete process.env.PORTABLE_EXECUTABLE_DIR;
      else process.env.PORTABLE_EXECUTABLE_DIR = previous;
    }
  });
});
