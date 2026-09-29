import { RefreshCw } from "lucide-react";
import type { NativeHarnessControlPlaneEntry } from "@/shared/crafting/nativeHarness";
import { HarnessCliRow } from "./HarnessCliRow";

/**
 * Harness / CLI panel: a standalone column listing every native harness as a
 * row (Logo · Name · Version · Status · action). The provider→harness map tab
 * renders the same rows paired with their provider via {@link HarnessCliRow}.
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
        {entries.map((entry) => (
          <HarnessCliRow
            key={entry.descriptor.id}
            entry={entry}
            highlighted={highlightedKind === entry.descriptor.harnessKind}
            installing={installingKinds?.has(entry.descriptor.harnessKind) ?? false}
            onInstall={onInstall}
            onShowDetail={onShowDetail}
          />
        ))}
      </div>
    </aside>
  );
}
