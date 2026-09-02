import type { SelectedModelEntry, HarnessReference } from "@/shared/crafting/workbenchTypes";
import { ProviderBrandBadge } from "@/renderer/views/MainView/parts/Sidebar/parts/providerBrands";

/**
 * Shared Inspector: a single detail pane for the currently selected Model or
 * Harness material. Only safe, non-secret fields are shown.
 */
export function SharedInspector(props: {
  model?: SelectedModelEntry | undefined;
  harness?: HarnessReference | undefined;
}) {
  const { model, harness } = props;
  if (!model && !harness) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-[11px] text-neutral-500">
        选择一件物品查看详情
      </div>
    );
  }
  return (
    <div
      className="rounded-xl border border-white/10 bg-white/[0.02] p-3"
      data-testid="shared-inspector"
    >
      {model ? (
        <div className="flex items-start gap-3">
          <ProviderBrandBadge id={model.providerKind} label={model.providerLabel} size="avatar" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-semibold text-foreground">{model.displayName}</p>
            <p className="truncate text-[11px] text-neutral-400" title={model.modelId}>
              模型 ID · {model.modelId}
            </p>
            <p className="truncate text-[11px] text-neutral-400">
              渠道 · {model.providerLabel} / {model.channelLabel}
            </p>
            {model.accountId ? (
              <p className="truncate text-[11px] text-neutral-400">账号 · {model.accountId}</p>
            ) : null}
            {model.contextSize ? (
              <p className="text-[11px] text-neutral-400">上下文 · {model.contextSize}</p>
            ) : null}
            <p className="truncate text-[10px] text-neutral-600" title={model.entryId}>
              {model.entryId}
            </p>
          </div>
        </div>
      ) : null}
      {harness ? (
        <div className="mt-3 flex items-start gap-3 border-t border-white/5 pt-3">
          <ProviderBrandBadge id={harness.vendor} label={harness.displayName} size="avatar" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-semibold text-foreground">{harness.displayName}</p>
            <p className="text-[11px] text-neutral-400">
              Harness · {harness.harnessKind} · {harness.version ?? "?"}
            </p>
            <p className="text-[11px] text-neutral-400">状态 · {harness.status}</p>
            <p className="truncate text-[10px] text-neutral-600">{harness.transport}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
