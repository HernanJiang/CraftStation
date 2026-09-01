import { Trans, useLingui } from "@lingui/react/macro";
import {
  getRuntimeItemPayload,
  type RuntimeChatItem,
} from "@/renderer/state/slices/runtimeEventSlice";
import type { RuntimeSegmentItemPayload } from "@/shared/contracts";

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

export function RuntimeSegmentMarker({ item }: { item: RuntimeChatItem }) {
  const { t } = useLingui();
  const payload = getRuntimeItemPayload<RuntimeSegmentItemPayload>(item, "runtime_segment");
  if (!payload) return null;
  return (
    <div
      className="my-2 flex w-full items-center gap-3 text-xs text-muted"
      aria-label={t`Runtime segment ${payload.ordinal + 1}`}
    >
      <span className="h-px min-w-4 flex-1 bg-border" aria-hidden />
      <div className="min-w-0 text-center">
        <div className="truncate font-medium text-foreground/80">
          <Trans>Runtime segment {payload.ordinal + 1}</Trans> · {payload.modelId} ·{" "}
          {payload.harnessKind}
        </div>
        <div className="truncate">
          {payload.recipeId} · <Trans>Session {shortId(payload.runtimeSessionId)}</Trans> ·{" "}
          <Trans>Entity {shortId(payload.entityId)}</Trans>
        </div>
        {payload.nativeSessionRef && (
          <div className="truncate font-mono">
            nativeSessionRef={shortId(payload.nativeSessionRef)}
          </div>
        )}
      </div>
      <span className="h-px min-w-4 flex-1 bg-border" aria-hidden />
    </div>
  );
}
