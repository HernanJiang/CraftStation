import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { readBridge } from "@/renderer/bridge";
import { friendlyError } from "@/shared/messages";
import type { CompatibilityBridgeStatusView } from "@/shared/crafting/compatibilityBridge";

/**
 * Components Inventory: Component/Ingredient materials.
 *
 * The only real component source today is the Compatibility Bridge
 * (CLIProxyAPI sidecar) status, read live from the Supervisor — never
 * hardcoded. The Start/Stop actions below drive the same singleton the
 * compatibility gate reads, so a started bridge immediately unlocks
 * bridge-routed combinations. Other component kinds (Context, Tool Policy,
 * Memory, …) remain a reserved seam until a registry lands.
 */
export function ComponentsInventory(props: {
  onSelect: () => void;
  /** Pinned current-selection summary row (first row of the column). */
  summary?: ReactNode | undefined;
}) {
  const { t } = useLingui();
  const [bridge, setBridge] = useState<CompatibilityBridgeStatusView | "unknown">("unknown");
  const [busy, setBusy] = useState<"starting" | "stopping" | null>(null);

  const refreshBridge = useCallback(async () => {
    try {
      setBridge(await readBridge().getCompatibilityBridgeStatus({}));
    } catch {
      setBridge("unknown");
    }
  }, []);

  useEffect(() => {
    void refreshBridge();
  }, [refreshBridge]);

  const controlBridge = async (action: "starting" | "stopping") => {
    setBusy(action);
    try {
      setBridge(
        action === "starting"
          ? await readBridge().startCompatibilityBridge({})
          : await readBridge().stopCompatibilityBridge({}),
      );
    } catch (error) {
      toast.danger(friendlyError(error));
      await refreshBridge();
    } finally {
      setBusy(null);
    }
  };

  const bridgeKnown = bridge !== "unknown";
  const running = bridgeKnown && bridge.running;

  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-2"
      data-testid="components-inventory"
      aria-label="组件背包"
    >
      <header className="flex shrink-0 items-center justify-between px-1">
        <h3 className="text-xs font-semibold text-neutral-300">组件</h3>
        <span className="flex items-center gap-1 text-[10px] text-neutral-500">
          {bridgeKnown ? 1 : "–"}
          <button
            type="button"
            onClick={() => void refreshBridge()}
            title={t`Refresh component status`}
            aria-label={t`Refresh component status`}
            data-testid="components-refresh"
            className="rounded p-0.5 transition-colors hover:bg-white/10 hover:text-white"
          >
            <RefreshCw className="size-3" />
          </button>
        </span>
      </header>
      {props.summary ? <div className="shrink-0">{props.summary}</div> : null}
      <div
        className="grid min-h-0 flex-1 grid-cols-4 content-start gap-1.5 overflow-y-auto pr-1"
        data-testid="components-inventory-grid"
      >
        <button
          type="button"
          onClick={props.onSelect}
          title={
            bridgeKnown
              ? `CLIProxyAPI 兼容桥 · ${running ? `运行中 ${bridge.endpoint ?? ""}` : "未运行"}`
              : "CLIProxyAPI 兼容桥 · 状态未知"
          }
          data-testid="component-cpa"
          className="aspect-square flex flex-col items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] p-1 text-center transition-colors hover:bg-white/10"
        >
          <span
            className={`size-2 rounded-full ${running ? "bg-emerald-400" : "bg-neutral-600"}`}
            aria-hidden="true"
          />
          <span className="w-full truncate text-[9px] leading-tight text-neutral-300">
            CLIProxyAPI
          </span>
          <span className="w-full truncate text-[8px] leading-tight text-neutral-500">
            {bridgeKnown ? (running ? "运行中" : "未运行") : "未知"}
          </span>
        </button>
        <button
          type="button"
          onClick={props.onSelect}
          title="更多组件槽 · 暂未开放"
          className="aspect-square flex items-center justify-center rounded-lg border border-dashed border-white/15 text-neutral-500 transition-colors hover:border-white/30 hover:text-white"
        >
          <Plus className="size-4" />
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 px-1">
        {running ? (
          <button
            type="button"
            onClick={() => void controlBridge("stopping")}
            disabled={busy !== null}
            data-testid="bridge-stop"
            className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-neutral-300 transition-colors hover:bg-white/10 disabled:opacity-40"
          >
            {busy === "stopping" ? t`Stopping…` : t`Stop bridge`}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void controlBridge("starting")}
            disabled={busy !== null || !bridgeKnown}
            data-testid="bridge-start"
            className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-neutral-300 transition-colors hover:bg-white/10 disabled:opacity-40"
          >
            {busy === "starting" ? t`Starting…` : t`Start bridge`}
          </button>
        )}
      </div>
    </section>
  );
}
