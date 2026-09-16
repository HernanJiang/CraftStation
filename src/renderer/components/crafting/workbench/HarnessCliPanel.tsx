import { AlertTriangle, CheckCircle2, Download, RefreshCw, Settings2, XCircle } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import type { NativeHarnessControlPlaneEntry } from "@/shared/crafting/nativeHarness";
import {
  brandIdForVendorKind,
  ProviderBrandBadge,
} from "@/renderer/views/MainView/parts/Sidebar/parts/providerBrands";
import { findCliUpdateForAgentKind, useUpdateStore } from "@/renderer/state/updateStore";
import { runCliUpdateBinary } from "@/renderer/actions/runCliUpdate";

const statusMeta: Record<
  NativeHarnessControlPlaneEntry["status"],
  { label: string; icon: typeof CheckCircle2; class: string }
> = {
  ready: { label: "就绪", icon: CheckCircle2, class: "text-emerald-400" },
  "not-configured": { label: "未配置", icon: Settings2, class: "text-amber-300" },
  unavailable: { label: "未安装", icon: XCircle, class: "text-neutral-500" },
  error: { label: "异常", icon: AlertTriangle, class: "text-red-400" },
};

/**
 * Harness / CLI panel: the persistent right column of the Workbench. Shows each
 * native harness as a row (Logo · Name · Version · Status · action) and drives
 * install/update/fix through the existing Agent Registry seam. Never exposes a
 * path, credential or private diagnostic.
 */
export function HarnessCliPanel(props: {
  entries: readonly NativeHarnessControlPlaneEntry[];
  loading: boolean;
  highlightedKind?: string | undefined;
  /** Harness kinds with a one-click install in flight (shows 安装中…). */
  installingKinds?: ReadonlySet<string> | undefined;
  onRefresh: () => void;
  /** One-click install through the shared Native Agent install seam. */
  onInstall?: ((entry: NativeHarnessControlPlaneEntry) => void) | undefined;
  onShowDetail: (entry: NativeHarnessControlPlaneEntry) => void;
}) {
  const { entries, loading, highlightedKind, installingKinds, onRefresh, onInstall, onShowDetail } =
    props;
  const { t } = useLingui();
  // In-flight agent binary updates keyed by `${agentKind}:${envKind}:${distro}`.
  // Installer output streams no byte counts, so rows show an honest
  // indeterminate state rather than a fabricated percentage.
  const agentUpdates = useUpdateStore((s) => s.agentUpdates);
  const availableCliUpdates = useUpdateStore((s) => s.availableCliUpdates);
  const updatingKinds = new Set(Object.keys(agentUpdates).map((key) => key.split(":")[0] ?? ""));
  return (
    <aside
      className="flex min-h-0 w-64 shrink-0 flex-col border-l border-white/5"
      data-testid="harness-cli-panel"
      aria-label="Harness/CLI 面板"
    >
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-white/5 px-3">
        <h3 className="text-xs font-semibold text-neutral-300">Harness / CLI</h3>
        <button
          type="button"
          onClick={onRefresh}
          title="刷新状态"
          className="rounded-md p-1 text-neutral-400 hover:bg-white/10 hover:text-white"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
        {entries.length === 0 && !loading ? (
          <p className="p-2 text-[11px] text-neutral-500">没有检测到 Native Harness</p>
        ) : null}
        {entries.map((entry) => {
          const meta = statusMeta[entry.status];
          const Icon = meta.icon;
          const highlighted = highlightedKind === entry.descriptor.harnessKind;
          const installing = installingKinds?.has(entry.descriptor.harnessKind) ?? false;
          const updating = updatingKinds.has(entry.descriptor.harnessKind);
          // Same availability the titlebar "Check all CLIs" menu shows.
          const availableUpdate =
            updating || installing
              ? undefined
              : findCliUpdateForAgentKind(availableCliUpdates, entry.descriptor.harnessKind);
          const canInstall =
            entry.status === "unavailable" && onInstall !== undefined && !installing;
          return (
            <button
              key={entry.descriptor.id}
              type="button"
              data-testid={`harness-cli-row-${entry.descriptor.harnessKind}`}
              disabled={installing}
              title={
                installing
                  ? "正在安装…"
                  : entry.status === "not-configured"
                    ? "点击配置"
                    : entry.status === "unavailable"
                      ? "点击下载并安装"
                      : entry.status === "error"
                        ? "点击查看并修复"
                        : entry.descriptor.label
              }
              onClick={() => {
                if (installing) return;
                if (canInstall) {
                  onInstall?.(entry);
                  return;
                }
                onShowDetail(entry);
              }}
              className={`flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors ${
                highlighted
                  ? "border-amber-400/60 bg-amber-400/10"
                  : "border-white/5 bg-white/[0.03] hover:bg-white/[0.07]"
              } disabled:cursor-wait disabled:opacity-70`}
            >
              <ProviderBrandBadge
                id={brandIdForVendorKind(entry.descriptor.vendor)}
                label={entry.descriptor.label}
                size="compact"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-foreground">
                  {entry.descriptor.label}
                </span>
                <span className="mt-0.5 block text-[10px] text-neutral-500">
                  {entry.descriptor.transport}
                </span>
              </span>
              <span className={`flex shrink-0 items-center gap-1 text-[10px] ${meta.class}`}>
                <Icon className="size-3" />
                {meta.label}
              </span>
              {availableUpdate ? (
                // Span, not button: the row itself is a <button>, and nested
                // buttons are invalid HTML (React hydration error).
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={t`Update ${entry.descriptor.label || entry.descriptor.harnessKind} now`}
                  onClick={(event) => {
                    // Don't select the harness row underneath: the pill updates
                    // the CLI in place through the same path as the titlebar.
                    event.stopPropagation();
                    void runCliUpdateBinary({
                      key: availableUpdate.key,
                      agentKind: availableUpdate.agentKind,
                      label: availableUpdate.label,
                      latest: availableUpdate.latest,
                    });
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    event.stopPropagation();
                    void runCliUpdateBinary({
                      key: availableUpdate.key,
                      agentKind: availableUpdate.agentKind,
                      label: availableUpdate.label,
                      latest: availableUpdate.latest,
                    });
                  }}
                  className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 transition-colors hover:bg-amber-400/30 focus-visible:outline-2 focus-visible:outline-amber-300"
                  title={t`New version available: v${availableUpdate.version} → v${availableUpdate.latest}. Click to update now.`}
                >
                  <Download className="size-3" />
                  {t`Update`}
                </span>
              ) : null}
              {canInstall ? (
                // Span, not button: the row itself is a <button>, and nested
                // buttons are invalid HTML (React hydration error). Installs go
                // through the shared Native Agent install seam — no vendor
                // commands are hardcoded here.
                <span
                  role="button"
                  tabIndex={0}
                  data-testid={`harness-cli-install-${entry.descriptor.harnessKind}`}
                  aria-label={t`Download and install ${entry.descriptor.label || entry.descriptor.harnessKind}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onInstall?.(entry);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    event.stopPropagation();
                    onInstall?.(entry);
                  }}
                  className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-200 transition-colors hover:bg-amber-400/35 focus-visible:outline-2 focus-visible:outline-amber-300"
                  title={t`Download and install ${entry.descriptor.label || entry.descriptor.harnessKind} now`}
                >
                  <Download className="size-3" />
                  下载并安装
                </span>
              ) : null}
              {installing ? (
                <span className="flex shrink-0 items-center gap-1 text-[10px] text-sky-300">
                  <RefreshCw className="size-3 animate-spin" />
                  {t`Installing…`}
                </span>
              ) : null}
              {updating ? (
                <span className="flex shrink-0 items-center gap-1 text-[10px] text-sky-300">
                  <RefreshCw className="size-3 animate-spin" />
                  更新中
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
