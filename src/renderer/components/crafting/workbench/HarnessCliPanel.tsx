import { AlertTriangle, CheckCircle2, RefreshCw, Settings2, XCircle } from "lucide-react";
import type { NativeHarnessControlPlaneEntry } from "@/shared/crafting/nativeHarness";
import { ProviderBrandBadge } from "@/renderer/views/MainView/parts/Sidebar/parts/providerBrands";

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
  onRefresh: () => void;
  onShowDetail: (entry: NativeHarnessControlPlaneEntry) => void;
}) {
  const { entries, loading, highlightedKind, onRefresh, onShowDetail } = props;
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
          return (
            <button
              key={entry.descriptor.id}
              type="button"
              onClick={() => onShowDetail(entry)}
              className={`flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors ${
                highlighted
                  ? "border-amber-400/60 bg-amber-400/10"
                  : "border-white/5 bg-white/[0.03] hover:bg-white/[0.07]"
              }`}
            >
              <ProviderBrandBadge
                id={entry.descriptor.vendor}
                label={entry.descriptor.label}
                size="avatar"
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
            </button>
          );
        })}
      </div>
    </aside>
  );
}
