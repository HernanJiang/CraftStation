import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Download,
  Gauge,
  GitPullRequest,
  Hammer,
  PanelLeft,
  RefreshCw,
} from "lucide-react";
import { Dropdown, Label, toast } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { ControlTooltip } from "@/renderer/components/common/ControlTooltip";
import { cycleRecentThread } from "@/renderer/actions/recentThreadCycle";
import { runCliUpdateBinary } from "@/renderer/actions/runCliUpdate";
import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { toggleSidebar } from "@/renderer/state/sidebarOverlayStore";
import { TopShortcutBar } from "./TopShortcuts/TopShortcutBar";
import { useUpdateStore, type UpdatePhase } from "@/renderer/state/updateStore";
import { useScheduleStore } from "@/renderer/state/scheduleStore";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { envLabelForStatus } from "@/renderer/utils/acpRegistryAuth";
import { extractAcpGenericInstanceId, type AgentStatus } from "@/shared/contracts";
import { isNewerVersion } from "@/shared/agents/updateResolver";
import { formatBytes } from "@/shared/formatBytes";

const CRAFTSTATION_RELEASES_URL = "https://github.com/HernanJiang/CraftStation/releases";

/**
 * "2.1 MB / 85.4 MB · 108 KB/s" — the proof-of-life detail for slow CDN
 * downloads where the percentage visibly sticks at 0% (issue #11).
 */
function formatDownloadProgressDetail(
  transferred: number | null,
  total: number | null,
  bytesPerSecond: number | null,
): string | null {
  if (transferred == null || total == null || total <= 0) return null;
  const bytes = `${formatBytes(transferred)} / ${formatBytes(total)}`;
  return bytesPerSecond != null && bytesPerSecond > 0
    ? `${bytes} · ${formatBytes(bytesPerSecond)}/s`
    : bytes;
}

const buttonClass =
  "craftstation-titlebar-control inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-xs text-muted transition-all duration-150 hover:-translate-y-px hover:bg-[var(--row-hover)] hover:text-foreground active:translate-y-0";

type CliUpdate = {
  key: string;
  status: AgentStatus;
  latest: string;
};

export function CliUpdateMenu() {
  const { t } = useLingui();
  const agentStatuses = useAgentStatusesStore((state) => state.agentStatuses);
  const wslAgentStatuses = useAgentStatusesStore((state) => state.wslAgentStatuses);
  const appPhase = useUpdateStore((state) => state.phase);
  const appVersion = useUpdateStore((state) => state.version);
  const appPercent = useUpdateStore((state) => state.downloadPercent);
  const appManualUrl = useUpdateStore((state) => state.manualDownloadUrl);
  const appTransferred = useUpdateStore((state) => state.downloadTransferred);
  const appTotal = useUpdateStore((state) => state.downloadTotal);
  const appSpeed = useUpdateStore((state) => state.downloadBytesPerSecond);
  const [checking, setChecking] = useState(false);
  const [updates, setUpdates] = useState<CliUpdate[]>([]);
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);
  const inFlightRef = useRef(0);
  const statusesRef = useRef<{ key: string; status: AgentStatus }[]>([]);
  const autoCheckedKeysetRef = useRef<string | null>(null);
  const statuses = useMemo(() => {
    const byKey = new Map<string, AgentStatus>();
    for (const status of [...agentStatuses, ...wslAgentStatuses]) {
      if (
        !status.installed ||
        !status.version ||
        extractAcpGenericInstanceId(status.kind) ||
        !status.update
      ) {
        continue;
      }
      const key = `${status.kind}:${status.envKind ?? "native"}:${status.envDistro ?? ""}`;
      byKey.set(key, status);
    }
    return [...byKey.entries()].map(([key, status]) => ({ key, status }));
  }, [agentStatuses, wslAgentStatuses]);

  const runCheck = useCallback(async (options?: { force?: boolean }) => {
    // Re-entrancy guard for the automatic path: agent-status store churn
    // re-renders this component constantly while any thread is active, and a
    // new check per render kept the titlebar spinner spinning forever. Manual
    // presses (and post-update refreshes) bypass the guard with `force`.
    if (inFlightRef.current > 0 && !options?.force) return;
    inFlightRef.current += 1;
    setChecking(true);
    // The app itself rides the same menu: every check — including the
    // once-per-launch automatic one — also probes GitHub for a newer
    // CraftStation release, so CLI and app updates are checked in sync
    // (main dedupes + hourly-polls anyway). Automatic checks stay silent
    // (no error toast on failure); manual presses notify. Failures surface
    // through onUpdateStatus; never let an IPC rejection bubble to the
    // window as an unhandled rejection.
    void Promise.resolve()
      .then(() => readBridge().checkForUpdate(options?.force ? {} : { automatic: true }))
      .catch((error: unknown) => {
        console.error("[craftstation][updates] check-for-update failed", error);
      });
    try {
      // Safety valve: each upstream probe aborts at 8s per URL, but adapters
      // can chain several URLs — never let the spinner stick past 30s.
      const settled = await Promise.race([
        Promise.all(
          statusesRef.current.map(async ({ key, status }) => {
            try {
              const result = await readBridge().getLatestAgentVersion({ agentKind: status.kind });
              return result.version && isNewerVersion(result.version, status.version ?? "")
                ? ({ key, status, latest: result.version } satisfies CliUpdate)
                : undefined;
            } catch {
              return undefined;
            }
          }),
        ),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 30_000)),
      ]);
      if (!settled) return;
      const found = settled.filter((entry): entry is CliUpdate => entry !== undefined);
      setUpdates((previous) => {
        // Same availability → keep the previous array identity. Replacing the
        // array on every check rebuilds the open menu's item collection around
        // the user's pointer, which read as "click did nothing".
        const signature = (list: CliUpdate[]) =>
          list
            .map((entry) => `${entry.key}@${entry.latest}`)
            .sort()
            .join("|");
        return signature(previous) === signature(found) ? previous : found;
      });
      // Publish for the synthesis-bench Harness surfaces so the titlebar menu
      // and the bench cards/rows always reflect the same availability.
      useUpdateStore.getState().setAvailableCliUpdates(
        found.map((entry) => ({
          key: entry.key,
          agentKind: entry.status.kind,
          label: entry.status.label,
          version: entry.status.version ?? "",
          latest: entry.latest,
        })),
      );
    } finally {
      inFlightRef.current -= 1;
      if (inFlightRef.current === 0) setChecking(false);
    }
  }, []);

  // Auto-check once per mount and again only when the SET of updatable CLIs
  // changes (install/uninstall) — not on every agent-status array identity
  // churn, which happens on nearly every supervisor event.
  useEffect(() => {
    statusesRef.current = statuses;
    const keyset = statuses
      .map((entry) => entry.key)
      .sort()
      .join(",");
    if (autoCheckedKeysetRef.current === keyset) return;
    autoCheckedKeysetRef.current = keyset;
    void runCheck();
  }, [statuses, runCheck]);

  const updateOne = async (entry: CliUpdate) => {
    if (updatingKey) return;
    setUpdatingKey(entry.key);
    try {
      // Shared path with the bench Harness rows/cards; afterwards re-run the
      // version check so a failed landing reappears in this menu.
      await runCliUpdateBinary({
        key: entry.key,
        agentKind: entry.status.kind,
        label: entry.status.label,
        latest: entry.latest,
      });
      await runCheck({ force: true });
    } finally {
      setUpdatingKey(null);
    }
  };

  // The app itself is part of this menu: badge + row when a CraftStation
  // release is pending (downloaded / manual package / downloading). The
  // background hourly check drives the same store, so this also surfaces
  // updates found without opening the menu.
  const appUpdatePending = appPhase === "downloaded" || appPhase === "available-manual";
  const appDownloadDetail = formatDownloadProgressDetail(appTransferred, appTotal, appSpeed);
  const badgeCount = updates.length + (appUpdatePending ? 1 : 0);
  // Local acknowledgment: while the menu's own check is in flight but main
  // hasn't reported anything yet (deduped onto an in-flight check, slow
  // network, missed event), still show progress instead of silence.
  const appCheckingQuietly = checking && (appPhase === "idle" || appPhase === "error");

  return (
    <Dropdown>
      <ControlTooltip
        label={badgeCount > 0 ? `有 ${badgeCount} 个更新可用` : t`Check for updates`}
        detail={t`Check all installed agent CLIs`}
      >
        {/* Opening the menu must only open the menu. A forced check inside the
              same press replaced `updates` mid-gesture, so the popover's item
              collection rebuilt before the click landed — the reported
              "single click does nothing, popover flashes" defect. Refreshes run
              via the explicit menu action and the once-per-keyset auto check. */}
        <Dropdown.Trigger
          data-testid="titlebar-cli-update-button"
          aria-label={t`Check for CLI updates`}
          className={`${buttonClass} relative mr-1 px-1.5 ${
            badgeCount > 0 ? "text-amber-300" : ""
          }`}
        >
          {checking ? (
            <RefreshCw className="size-3.5 animate-spin" />
          ) : (
            <Download className="size-3.5" />
          )}
          {badgeCount > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 min-w-3 rounded-full bg-amber-400 px-0.5 text-center text-[8px] leading-3 font-bold text-black">
              {badgeCount}
            </span>
          ) : null}
        </Dropdown.Trigger>
      </ControlTooltip>
      <Dropdown.Popover placement="bottom end" className="min-w-[280px] rounded-[14px]">
        <Dropdown.Menu
          aria-label={t`CLI updates`}
          onAction={(key) => {
            if (key === "check") void runCheck({ force: true });
            if (key === "app-install") void readBridge().installUpdate();
            if (key === "app-download" && appManualUrl) {
              void readBridge().openExternal(appManualUrl);
            }
            if (key === "app-download-browser") {
              void readBridge().openExternal(CRAFTSTATION_RELEASES_URL);
            }
            const entry = updates.find((candidate) => candidate.key === String(key));
            if (entry) void updateOne(entry);
          }}
        >
          <Dropdown.Item id="check" textValue={t`Check for updates`}>
            <RefreshCw className={checking ? "size-4 animate-spin" : "size-4"} />
            <Label>{checking ? t`Checking…` : t`Check all CLIs`}</Label>
          </Dropdown.Item>
          {appPhase === "downloaded" ? (
            <Dropdown.Item
              key="app-install"
              id="app-install"
              textValue={`CraftStation ${appVersion ?? ""}`}
            >
              <Download className="size-4 text-amber-300" />
              <Label>
                {t`CraftStation`}
                {appVersion ? ` v${appVersion}` : ""} · {t`Restart to install`}
              </Label>
            </Dropdown.Item>
          ) : null}
          {appPhase === "available-manual" && appManualUrl ? (
            <Dropdown.Item
              key="app-download"
              id="app-download"
              textValue={`CraftStation ${appVersion ?? ""}`}
            >
              <Download className="size-4 text-amber-300" />
              <Label>
                {t`CraftStation`}
                {appVersion ? ` v${appVersion}` : ""} · {t`Download package`}
              </Label>
            </Dropdown.Item>
          ) : null}
          {appPhase === "checking" || appCheckingQuietly ? (
            <Dropdown.Item
              key="app-checking"
              id="app-checking"
              textValue={t`Checking for CraftStation update`}
            >
              <RefreshCw className="size-4 animate-spin" />
              <Label>{t`Checking for CraftStation update…`}</Label>
            </Dropdown.Item>
          ) : null}
          {appPhase === "downloading" ? (
            <Dropdown.Item
              key="app-downloading"
              id="app-downloading"
              textValue={t`Downloading CraftStation update`}
            >
              <RefreshCw className="size-4 animate-spin" />
              <Label>
                {t`CraftStation`} · {t`Downloading… ${Math.round(appPercent)}%`}
                {appDownloadDetail ? ` · ${appDownloadDetail}` : ""}
              </Label>
            </Dropdown.Item>
          ) : null}
          {appPhase === "downloading" ? (
            <Dropdown.Item
              key="app-download-browser"
              id="app-download-browser"
              textValue={t`Download in browser instead`}
            >
              <Download className="size-4" />
              <Label>{t`Download in browser instead`}</Label>
            </Dropdown.Item>
          ) : null}
          {updates.map((entry) => (
            <Dropdown.Item
              key={entry.key}
              id={entry.key}
              textValue={`${entry.status.label} ${entry.latest}`}
            >
              <Download className="size-4 text-amber-300" />
              <Label>
                {entry.status.label}
                {envLabelForStatus(entry.status)
                  ? ` · ${envLabelForStatus(entry.status)}`
                  : ""} · v
                {entry.status.version} → v{entry.latest}
                {updatingKey === entry.key ? ` · ${t`Updating…`}` : ""}
              </Label>
            </Dropdown.Item>
          ))}
          {updates.length === 0 &&
          !appUpdatePending &&
          appPhase !== "downloading" &&
          appPhase !== "checking" &&
          !appCheckingQuietly ? (
            <Dropdown.Item id="none" textValue={t`All CLIs are up to date`}>
              <Label>{checking ? t`Checking installed CLIs…` : t`All CLIs are up to date`}</Label>
            </Dropdown.Item>
          ) : null}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

export function MainTitlebar() {
  const { t } = useLingui();
  const view = useAppStore((state) => state.view);
  const openPullRequests = useAppStore((state) => state.openPullRequests);
  const openSchedules = useAppStore((state) => state.openSchedules);
  const openGitHubActions = useAppStore((state) => state.openGitHubActions);
  const updatePhase = useUpdateStore((state) => state.phase);
  const updateVersion = useUpdateStore((state) => state.version);
  const updatePercent = useUpdateStore((state) => state.downloadPercent);
  const updateTransferred = useUpdateStore((state) => state.downloadTransferred);
  const updateTotal = useUpdateStore((state) => state.downloadTotal);
  const updateSpeed = useUpdateStore((state) => state.downloadBytesPerSecond);
  const updateDownloadDetail = formatDownloadProgressDetail(
    updateTransferred,
    updateTotal,
    updateSpeed,
  );
  const scheduleCount = useScheduleStore((state) => state.tasks.length);
  const usageStatsActive = usePanelStore(
    (state) => state.modelUsageDialogOpen && state.modelUsageWorkspaceTab === "stats",
  );

  // Version pill doubles as a manual update check. The store subscription
  // (not the IPC resolution) observes the outcome so the "up to date" toast
  // still lands when the check dedupes onto an in-flight one; error and
  // update-found outcomes already surface through the normal status channel.
  const checkAppUpdate = useCallback(() => {
    if (useUpdateStore.getState().phase === "checking") return;
    let sawChecking = false;
    let settled = false;
    const finish = (phase: UpdatePhase) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      if (phase === "idle") toast.success(t`CraftStation is up to date`);
    };
    const unsubscribe = useUpdateStore.subscribe((state) => {
      if (state.phase === "checking") sawChecking = true;
      else if (sawChecking) finish(state.phase);
    });
    void Promise.resolve()
      .then(() => readBridge().checkForUpdate({}))
      .catch((error: unknown) => {
        console.error("[craftstation][updates] version-pill check failed", error);
      })
      .finally(() => {
        if (!sawChecking) finish(useUpdateStore.getState().phase);
      });
  }, [t]);

  return (
    <header className="craftstation-titlebar flex h-[38px] min-w-0 items-center bg-[var(--window-header-background)] px-2 text-foreground">
      <div className="craftstation-titlebar-control flex shrink-0 items-center gap-0.5">
        <ControlTooltip label={t`Toggle sidebar`} shortcut="Ctrl+B">
          <button
            type="button"
            className={buttonClass}
            aria-label={t`Toggle sidebar`}
            onClick={toggleSidebar}
          >
            <PanelLeft className="size-4" />
          </button>
        </ControlTooltip>
        <ControlTooltip label={t`Back`}>
          <button
            type="button"
            className={`${buttonClass} px-1.5`}
            aria-label={t`Back`}
            onClick={() => cycleRecentThread(-1)}
          >
            <ArrowLeft className="size-4" />
          </button>
        </ControlTooltip>
        <ControlTooltip label={t`Forward`}>
          <button
            type="button"
            className={`${buttonClass} px-1.5`}
            aria-label={t`Forward`}
            onClick={() => cycleRecentThread(1)}
          >
            <ArrowRight className="size-4" />
          </button>
        </ControlTooltip>
      </div>

      <nav className="ml-1 flex min-w-0 flex-1 items-center gap-0.5">
        <ControlTooltip label={t`Pull requests`} detail={t`View and review pull requests`}>
          <button
            type="button"
            className={`${buttonClass} ${view.kind === "pullRequests" ? "bg-[var(--row-active)] text-foreground" : ""}`}
            onClick={() => startTransition(() => openPullRequests())}
          >
            <GitPullRequest className="size-3.5" />
            <span>{t`Pull requests`}</span>
          </button>
        </ControlTooltip>
        <ControlTooltip label={t`Plan`} detail={t`View plans and scheduled tasks`}>
          <button
            type="button"
            className={`${buttonClass} ${view.kind === "schedules" ? "bg-[var(--row-active)] text-foreground" : ""}`}
            onClick={() => startTransition(() => openSchedules())}
          >
            <CalendarDays className="size-3.5" />
            <span>{t`Plan`}</span>
            {scheduleCount > 0 ? (
              <span
                data-testid="titlebar-schedule-count"
                className="min-w-3.5 rounded-full bg-foreground/12 px-1 text-[10px] font-medium leading-4 tabular-nums text-foreground/80"
              >
                {scheduleCount}
              </span>
            ) : null}
          </button>
        </ControlTooltip>
        <ControlTooltip label={t`Work`} detail={t`View automated work`}>
          <button
            type="button"
            className={buttonClass}
            onClick={() => startTransition(() => openGitHubActions())}
          >
            <Hammer className="size-3.5" />
            <span>{t`Work`}</span>
          </button>
        </ControlTooltip>
        <ControlTooltip label={t`Usage`}>
          <button
            type="button"
            data-testid="titlebar-usage"
            className={`${buttonClass} ${usageStatsActive ? "bg-[var(--row-active)] text-foreground" : ""}`}
            onClick={() =>
              startTransition(() =>
                usePanelStore.getState().openModelUsageWorkspace({ tab: "stats" }),
              )
            }
          >
            <Gauge className="size-3.5" />
            <span>{t`Usage`}</span>
          </button>
        </ControlTooltip>
        <TopShortcutBar />
      </nav>

      <div className="craftstation-titlebar-drag w-2 shrink-0 self-stretch" aria-hidden="true" />
      <div className="flex shrink-0 items-center">
        <ControlTooltip
          label={t`Check for updates`}
          detail={t`Click to check for a new CraftStation version`}
        >
          <button
            type="button"
            data-testid="titlebar-app-version"
            aria-label={t`Check for CraftStation updates`}
            disabled={updatePhase === "checking"}
            onClick={checkAppUpdate}
            className={`${buttonClass} mr-1 px-1.5 text-[11px] tabular-nums`}
          >
            {updatePhase === "checking" ? <RefreshCw className="size-3 animate-spin" /> : null}v
            {readBridge().appVersion}
          </button>
        </ControlTooltip>
        <CliUpdateMenu />
        {updatePhase === "downloading" || updatePhase === "downloaded" ? (
          <button
            type="button"
            data-testid="titlebar-update-progress"
            aria-label={
              updatePhase === "downloaded" ? t`Restart to install` : t`Download in browser instead`
            }
            onClick={() => {
              if (updatePhase === "downloaded") {
                void readBridge().installUpdate();
                return;
              }
              // A download that never leaves 0% used to be a disabled button,
              // so the click the user reached for did nothing.
              void readBridge().openExternal(CRAFTSTATION_RELEASES_URL);
            }}
            className="craftstation-titlebar-control mr-1 inline-flex h-6 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--row-hover)] px-2 text-[11px] text-muted transition-colors hover:bg-[var(--row-active)] hover:text-foreground"
          >
            {updatePhase === "downloaded" ? (
              <Download className="size-3.5" />
            ) : (
              <RefreshCw className="size-3.5 animate-spin" />
            )}
            <span>
              {updatePhase === "downloaded"
                ? `${t`Update available`}${updateVersion ? ` v${updateVersion}` : ""}`
                : updateDownloadDetail
                  ? `${t`Downloading… ${Math.round(updatePercent)}%`} · ${updateDownloadDetail}`
                  : `${t`Downloading… ${Math.round(updatePercent)}%`} · ${t`Download in browser instead`}`}
            </span>
          </button>
        ) : null}
      </div>
      {/* Electron's native min/max/close buttons occupy the transparent overlay at the right. */}
      <div
        data-testid="titlebar-window-controls-spacer"
        className="w-[138px] shrink-0"
        aria-hidden="true"
      />
    </header>
  );
}
