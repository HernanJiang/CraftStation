import { AlertTriangle, CheckCircle2, Download, RefreshCw, Settings2, XCircle } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import type { NativeHarnessControlPlaneEntry } from "@/shared/crafting/nativeHarness";
import {
  brandIdForVendorKind,
  ProviderBrandBadge,
} from "@/renderer/views/MainView/parts/Sidebar/parts/providerBrands";
import { findCliUpdateForAgentKind, useUpdateStore } from "@/renderer/state/updateStore";
import { runCliUpdateBinary } from "@/renderer/actions/runCliUpdate";

export const harnessStatusMeta: Record<
  NativeHarnessControlPlaneEntry["status"],
  { label: string; icon: typeof CheckCircle2; class: string }
> = {
  ready: { label: "就绪", icon: CheckCircle2, class: "text-emerald-600 dark:text-emerald-400" },
  "not-configured": {
    label: "未配置",
    icon: Settings2,
    class: "text-amber-600 dark:text-amber-300",
  },
  unavailable: { label: "未安装", icon: XCircle, class: "text-neutral-500" },
  error: { label: "异常", icon: AlertTriangle, class: "text-red-600 dark:text-red-400" },
};

/**
 * One Harness/CLI row (Logo · Name · Transport · Status · actions). Shared by
 * the Harness/CLI panel and the provider→harness map. Never exposes a path,
 * credential or private diagnostic.
 */
export function HarnessCliRow(props: {
  entry: NativeHarnessControlPlaneEntry;
  highlighted?: boolean | undefined;
  installing?: boolean | undefined;
  /** Override the row test id (per-model map rows render one cell per model). */
  testId?: string | undefined;
  /** Extra muted suffix appended to the transport line (e.g. "2 个模型"). */
  metaSuffix?: string | undefined;
  /** One-click install through the shared Native Agent install seam. */
  onInstall?: ((entry: NativeHarnessControlPlaneEntry) => void) | undefined;
  onShowDetail: (entry: NativeHarnessControlPlaneEntry) => void;
}) {
  const { entry, highlighted, installing, onInstall, onShowDetail } = props;
  const { t } = useLingui();
  // In-flight agent binary updates keyed by `${agentKind}:${envKind}:${distro}`.
  // Installer output streams no byte counts, so rows show an honest
  // indeterminate state rather than a fabricated percentage.
  const agentUpdates = useUpdateStore((s) => s.agentUpdates);
  const availableCliUpdates = useUpdateStore((s) => s.availableCliUpdates);
  const updating = Object.keys(agentUpdates).some(
    (key) => key.split(":")[0] === entry.descriptor.harnessKind,
  );
  const meta = harnessStatusMeta[entry.status];
  const Icon = meta.icon;
  // Same availability the titlebar "Check all CLIs" menu shows.
  const availableUpdate =
    updating || installing
      ? undefined
      : findCliUpdateForAgentKind(availableCliUpdates, entry.descriptor.harnessKind);
  const canInstall = entry.status === "unavailable" && onInstall !== undefined && !installing;
  return (
    <button
      type="button"
      data-testid={props.testId ?? `harness-cli-row-${entry.descriptor.harnessKind}`}
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
          {props.metaSuffix ? ` · ${props.metaSuffix}` : ""}
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
          className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 transition-colors hover:bg-amber-500/25 focus-visible:outline-2 focus-visible:outline-amber-600 dark:bg-amber-400/15 dark:text-amber-300 dark:hover:bg-amber-400/30 dark:focus-visible:outline-amber-300"
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
          className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 transition-colors hover:bg-amber-500/30 focus-visible:outline-2 focus-visible:outline-amber-600 dark:bg-amber-400/20 dark:text-amber-200 dark:hover:bg-amber-400/35 dark:focus-visible:outline-amber-300"
          title={t`Download and install ${entry.descriptor.label || entry.descriptor.harnessKind} now`}
        >
          <Download className="size-3" />
          下载并安装
        </span>
      ) : null}
      {installing ? (
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-sky-700 dark:text-sky-300">
          <RefreshCw className="size-3 animate-spin" />
          {t`Installing…`}
        </span>
      ) : null}
      {updating ? (
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-sky-700 dark:text-sky-300">
          <RefreshCw className="size-3 animate-spin" />
          更新中
        </span>
      ) : null}
    </button>
  );
}
