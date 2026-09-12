import {
  getRuntimeItemPayload,
  type RuntimeChatItem,
} from "@/renderer/state/slices/runtimeEventSlice";
import type { ModelSwitchItemPayload } from "@/shared/contracts";

/**
 * Inline boundary marking a model/harness switch inside one logical thread.
 * Persisted as a `model_switch` runtime item, so reopening the thread keeps
 * every switch node. Three phases: `handover` (rebuild in flight — the only
 * visible explanation while the thread sits in silent working), `done`
 * (`── 模型已切换 A → B ──`), `failed` (with the honest reason).
 */
export function ModelSwitchMarker({ item }: { item: RuntimeChatItem }) {
  const payload = getRuntimeItemPayload<ModelSwitchItemPayload>(item, "model_switch");
  if (!payload) return null;
  if (payload.phase === "failed") {
    const label = `模型切换失败 ${payload.fromModel} → ${payload.toModel}${
      payload.error ? `：${payload.error}` : ""
    }`;
    return (
      <div
        className="my-2 flex w-full items-center gap-3 text-xs text-danger"
        aria-label={label}
        data-testid={`model-switch-${item.id}`}
      >
        <span className="h-px min-w-4 flex-1 bg-border" aria-hidden />
        <div className="min-w-0 truncate font-medium">✕ {label}</div>
        <span className="h-px min-w-4 flex-1 bg-border" aria-hidden />
      </div>
    );
  }
  if (payload.phase === "handover" || item.state !== "completed") {
    const label = `正在交接上下文 ${payload.fromModel} → ${payload.toModel}`;
    return (
      <div
        className="my-2 flex w-full items-center gap-3 text-xs text-muted"
        aria-label={label}
        data-testid={`model-switch-${item.id}`}
      >
        <span className="h-px min-w-4 flex-1 bg-border" aria-hidden />
        <div className="min-w-0 animate-pulse truncate font-medium text-foreground/80">
          ⇄ {label}…
        </div>
        <span className="h-px min-w-4 flex-1 bg-border" aria-hidden />
      </div>
    );
  }
  const label = `模型已切换 ${payload.fromModel} → ${payload.toModel}`;
  return (
    <div
      className="my-2 flex w-full items-center gap-3 text-xs text-muted"
      aria-label={label}
      data-testid={`model-switch-${item.id}`}
    >
      <span className="h-px min-w-4 flex-1 bg-border" aria-hidden />
      <div className="min-w-0 truncate font-medium text-foreground/80">⇄ {label}</div>
      <span className="h-px min-w-4 flex-1 bg-border" aria-hidden />
    </div>
  );
}
