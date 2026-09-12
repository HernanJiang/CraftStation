import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Download,
  GitPullRequest,
  Hammer,
  PanelLeft,
  RefreshCw,
} from "lucide-react";
import { Dropdown, Label } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { ControlTooltip } from "@/renderer/components/common/ControlTooltip";
import { cycleRecentThread } from "@/renderer/actions/recentThreadCycle";
import { runCliUpdateBinary } from "@/renderer/actions/runCliUpdate";
import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { toggleSidebar } from "@/renderer/state/sidebarOverlayStore";
import { TopShortcutBar } from "./TopShortcuts/TopShortcutBar";
import { useUpdateStore } from "@/renderer/state/updateStore";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { envLabelForStatus } from "@/renderer/utils/acpRegistryAuth";
import { extractAcpGenericInstanceId, type AgentStatus } from "@/shared/contracts";
import { isNewerVersion } from "@/shared/agents/updateResolver";

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
      setUpdates(found);
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

  return (
    <Dropdown>
      <ControlTooltip
        label={updates.length > 0 ? `有 ${updates.length} 个 CLI 可更新` : t`Check for updates`}
        detail={t`Check all installed agent CLIs`}
      >
        <Dropdown.Trigger
          data-testid="titlebar-cli-update-button"
          aria-label={t`Check for CLI updates`}
          className={`${buttonClass} relative mr-1 px-1.5 ${
            updates.length > 0 ? "text-amber-300" : ""
          }`}
          onPress={() => void runCheck({ force: true })}
        >
          {checking ? (
            <RefreshCw className="size-3.5 animate-spin" />
          ) : (
            <Download className="size-3.5" />
          )}
          {updates.length > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 min-w-3 rounded-full bg-amber-400 px-0.5 text-center text-[8px] leading-3 font-bold text-black">
              {updates.length}
            </span>
          ) : null}
        </Dropdown.Trigger>
      </ControlTooltip>
      <Dropdown.Popover placement="bottom end" className="min-w-[280px] rounded-[14px]">
        <Dropdown.Menu
          aria-label={t`CLI updates`}
          onAction={(key) => {
            if (key === "check") void runCheck({ force: true });
            const entry = updates.find((candidate) => candidate.key === String(key));
            if (entry) void updateOne(entry);
          }}
        >
          <Dropdown.Item id="check" textValue={t`Check for updates`}>
            <RefreshCw className={checking ? "size-4 animate-spin" : "size-4"} />
            <Label>{checking ? t`Checking…` : t`Check all CLIs`}</Label>
          </Dropdown.Item>
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
          {updates.length === 0 ? (
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

      <nav className="craftstation-titlebar-control ml-1 flex min-w-0 flex-1 items-center gap-0.5">
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
        <TopShortcutBar />
      </nav>

      <div className="craftstation-titlebar-drag min-w-8 flex-1 self-stretch" aria-hidden="true" />
      <span
        data-testid="titlebar-app-version"
        className="craftstation-titlebar-control mr-1 shrink-0 px-1.5 text-[11px] tabular-nums text-muted"
        title={t`CraftStation version`}
      >
        v{readBridge().appVersion}
      </span>
      <CliUpdateMenu />
      {updatePhase === "downloading" || updatePhase === "downloaded" ? (
        <button
          type="button"
          disabled={updatePhase !== "downloaded"}
          onClick={() => void readBridge().installUpdate()}
          className="craftstation-titlebar-control mr-1 inline-flex h-6 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--row-hover)] px-2 text-[11px] text-muted transition-colors hover:bg-[var(--row-active)] hover:text-foreground disabled:cursor-default disabled:hover:bg-[var(--row-hover)]"
        >
          {updatePhase === "downloaded" ? (
            <Download className="size-3.5" />
          ) : (
            <RefreshCw className="size-3.5 animate-spin" />
          )}
          <span>
            {updatePhase === "downloaded"
              ? `${t`Update available`}${updateVersion ? ` v${updateVersion}` : ""}`
              : t`Downloading… ${Math.round(updatePercent)}%`}
          </span>
        </button>
      ) : null}
      {/* Electron's native min/max/close buttons occupy the transparent overlay at the right. */}
      <div
        data-testid="titlebar-window-controls-spacer"
        className="w-[138px] shrink-0"
        aria-hidden="true"
      />
    </header>
  );
}
