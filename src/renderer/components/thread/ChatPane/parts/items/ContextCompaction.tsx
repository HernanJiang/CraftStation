import { memo } from "react";
import { Surface } from "@heroui/react";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { TranslateFn } from "@/renderer/i18n/i18n";
import { Layers } from "lucide-react";
import { isContextCompactionToolName } from "@/shared/contextCompaction";
import type { ToolCallPayload } from "@/shared/contracts";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import { formatTokenCount } from "@/renderer/components/thread/formatTokenCount";
import { useShimmer } from "@/renderer/thinkingAnimator";
import { chatMessageSurfaceClass } from "./chatMessageSurface";

interface ContextCompactionProps {
  item: RuntimeChatItem;
}

export const ContextCompaction = memo(function ContextCompaction({ item }: ContextCompactionProps) {
  const { t } = useLingui();
  const isRunning = item.state !== "completed";
  const summary = isRunning ? null : formatCompactionSummary(item.payload, t);
  const thinkingTextRef = useShimmer<HTMLSpanElement>(isRunning);

  if (isRunning) {
    const compactingLabel = t`Compacting context`;
    return (
      <Surface variant="transparent" className={chatMessageSurfaceClass}>
        <div className="inline-flex min-w-0 items-center gap-1.5 text-[length:var(--lc-chat-font-size-meta)] text-foreground-muted">
          <Layers className="size-3 shrink-0 craftstation-compacting-icon" />
          <span
            ref={thinkingTextRef}
            className="craftstation-thinking-text"
            data-craftstation-shimmer-text={compactingLabel}
          >
            {compactingLabel}
          </span>
        </div>
      </Surface>
    );
  }

  return (
    <Surface variant="transparent" className={chatMessageSurfaceClass}>
      <div className="flex min-w-0 flex-col items-stretch justify-center text-[length:var(--lc-chat-font-size-meta)] text-foreground-muted">
        <span className="inline-flex min-w-0 items-center gap-1.5 self-start leading-none italic opacity-80">
          <Layers className="size-3 shrink-0 craftstation-compacted-icon" />
          {summary ?? t`Context compacted`}
        </span>
      </div>
    </Surface>
  );
});

interface CompactMetadata {
  trigger?: "manual" | "auto" | string;
  pre_tokens?: number;
  post_tokens?: number;
  duration_ms?: number;
}

function formatCompactionSummary(payload: unknown, t: TranslateFn): string | null {
  const meta = readCompactMetadata(payload);
  if (!meta) return null;
  const before = formatTokenLabel(meta.pre_tokens);
  const after = formatTokenLabel(meta.post_tokens);
  const isManual = meta.trigger === "manual";
  if (before && after) {
    return isManual
      ? t(msg`Context manually compacted: ${before} → ${after} tokens`)
      : t(msg`Context compacted: ${before} → ${after} tokens`);
  }
  if (before) {
    return isManual
      ? t(msg`Context manually compacted from ${before} tokens`)
      : t(msg`Context compacted from ${before} tokens`);
  }
  return null;
}

function readCompactMetadata(payload: unknown): CompactMetadata | null {
  if (!payload || typeof payload !== "object") return null;
  const args = (payload as { args?: unknown }).args;
  if (!args || typeof args !== "object") return null;
  return args as CompactMetadata;
}

function formatTokenLabel(value: number | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return formatTokenCount(value);
}

export function isContextCompactionToolCall(item: RuntimeChatItem): boolean {
  if (item.type !== "tool_call") return false;
  return isContextCompactionToolName((item.payload as ToolCallPayload | undefined)?.name);
}
