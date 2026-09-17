import { memo, useMemo } from "react";
import { Surface } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import type { MessageItemPayload } from "@/shared/contracts";
import type { AppStoreState } from "@/renderer/state/slices/shared";
import { PixelLoader } from "@/renderer/components/common/PixelLoader";
import { useAppStore } from "@/renderer/state/appStore";
import { useExperimentStore } from "@/renderer/state/experimentStore";
import {
  getRuntimeItemPayload,
  type RuntimeChatItem,
} from "@/renderer/state/slices/runtimeEventSlice";
import { selectCompletedTurnsByAnchorItem } from "../../chatPaneSelectors";
import { formatClockTime } from "@/renderer/utils/formatTime";
import { chatMessageSurfaceClass } from "./chatMessageSurface";
import { useChatPaneActions } from "../../chatPaneActionsContext";
import { CopyTextButton } from "./CopyTextButton";
import { ForkTurnButton } from "./ForkTurnButton";
import { ImageCard } from "./ImageCard";
import { imageViewSourceFromImageBlock } from "./imageViewSource";
import { SmoothItemMarkdown } from "./ItemMarkdown";
import { isToolGroupItem } from "./toolCallCategorization";

interface AssistantMessageProps {
  threadId: string;
  item: RuntimeChatItem;
  isTurnActive: boolean;
}

export const AssistantMessage = memo(function AssistantMessage({
  threadId,
  item,
  isTurnActive,
}: AssistantMessageProps) {
  const { t } = useLingui();
  const actions = useChatPaneActions();
  const turnRecord = useAppStore((state) =>
    selectCompletedTurnsByAnchorItem(state, threadId).get(item.id),
  );
  const completedTurnWasRemapped = useAppStore((state) => {
    if (!turnRecord) return false;
    return (state.runtimeCompletedTurnsByThread[threadId] ?? []).some(
      (source) =>
        source.startedAt === turnRecord.startedAt &&
        source.endedAt === turnRecord.endedAt &&
        source.anchorItemId !== item.id,
    );
  });
  // The copy action only appears under a turn's *final* answer. Two gates:
  // fork stays strict (only a settled turn whose answer has no trailing rows
  // at all may anchor a branch), while copy is forgiving: trailing tool-like
  // rows (tool calls, reasoning, command/edit/search results) are turn
  // machinery, not a newer answer, so a settled turn whose visible text is
  // followed only by tools still owns a copyable answer. Anything
  // message-like (another answer, plan, question, error) keeps the text
  // intermediate under both gates. Every turn keeps its button, not just the
  // most recent one. Sub-agent messages (those nested under a tool call) are
  // ignored so they neither qualify nor cancel a top-level answer's terminal
  // status. A completed item at the live tail is still an intermediate update
  // until the turn itself settles, so it must not expose a copy action yet.
  const scanFinalStatus = (
    state: AppStoreState,
    transparentTools: boolean,
  ): "confirmed" | "candidate" | "none" => {
    if (item.parentItemId) return "none";
    // Some providers append a metadata-only assistant item after the visible
    // answer. Completed-turn resolution deliberately remaps that invisible
    // trailer to the preceding visible row; trust that lifecycle boundary so
    // copy/fork controls do not disappear for Gemini/Antigravity transcripts.
    if (completedTurnWasRemapped) return "confirmed";
    const ids = state.runtimeItemIdsByThread[threadId];
    const byId = state.runtimeItemsByIdByThread[threadId];
    if (!ids || !byId) return "none";
    const index = ids.indexOf(item.id);
    if (index < 0) return "none";
    for (let i = index + 1; i < ids.length; i += 1) {
      const next = byId[ids[i]!];
      if (!next || next.parentItemId) continue;
      if (transparentTools && isToolGroupItem(next)) continue;
      return next.type === "user_message" ? "confirmed" : "none";
    }
    return isTurnActive ? "candidate" : "confirmed";
  };
  const finalAnswerStatus = useAppStore((state) => scanFinalStatus(state, false));
  const copyableStatus = useAppStore((state) => scanFinalStatus(state, true));
  const stream = item.streams.assistant_text ?? "";
  const payload = getRuntimeItemPayload<MessageItemPayload>(item, "assistant_message");
  const rawText =
    stream.length > 0
      ? stream
      : (payload?.content
          ?.map((b) => (b.kind === "text" ? b.text : ""))
          .filter(Boolean)
          .join("\n") ?? "");
  const isStreaming = item.state !== "completed";
  // Agents (e.g. ACP providers) can embed images directly in a message as image
  // content blocks; render them inline beneath any text.
  const imageSources = useMemo(
    () =>
      (payload?.content ?? [])
        .filter((b) => b.kind === "image")
        .map((b) => imageViewSourceFromImageBlock(b, actions?.remoteImageRefUrl))
        .filter((s): s is NonNullable<typeof s> => s !== null),
    [actions?.remoteImageRefUrl, payload?.content],
  );
  const showCopyButton = copyableStatus === "confirmed" && !isStreaming && rawText.length > 0;
  // Fork stays on the strict gate: only a settled turn whose answer has no
  // trailing rows at all may anchor a branch. Remote threads are owned by
  // their host desktop (a local fork row could neither open nor resume there)
  // and experiment candidates are lifecycle-owned by their experiment, so
  // both stay copy-only.
  const isRemoteThread = useAppStore(
    (state) => state.threads.find((thread) => thread.id === threadId)?.remoteServerId !== undefined,
  );
  const isExperimentThread = useExperimentStore((state) =>
    Object.values(state.experiments).some((experiment) =>
      experiment.candidates.some((candidate) => candidate.threadId === threadId),
    ),
  );
  const showFork =
    finalAnswerStatus === "confirmed" &&
    !isStreaming &&
    rawText.length > 0 &&
    !isRemoteThread &&
    !isExperimentThread;
  const endedClock = turnRecord ? formatClockTime(turnRecord.endedAt) : "";
  const endedFull = turnRecord ? new Date(turnRecord.endedAt).toLocaleString() : "";
  // The tail answer's copy action becomes available only once its turn
  // settles. Reserve the same strip while the answer is still a candidate so
  // revealing the button cannot grow the virtual row and move the transcript
  // past the pinned bottom edge.
  const reserveCopyButtonSpace = copyableStatus !== "none" && rawText.length > 0;
  return (
    <Surface variant="transparent" className={chatMessageSurfaceClass}>
      <div className="min-w-0 leading-snug">
        {rawText.length > 0 ? (
          <SmoothItemMarkdown text={rawText} isStreaming={isStreaming} />
        ) : null}
        {imageSources.length > 0 ? (
          <div className="mt-1 flex flex-col gap-2">
            {imageSources.map((source, index) => (
              <ImageCard key={`${source.src.slice(0, 64)}:${index}`} source={source} />
            ))}
          </div>
        ) : null}
        {isStreaming && rawText.length === 0 && imageSources.length === 0 ? (
          <div className="text-foreground-muted">
            <PixelLoader size="xxs" />
          </div>
        ) : null}
      </div>
      {reserveCopyButtonSpace ? (
        <div className="craftstation-message-action-strip mt-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/checkpoint:opacity-100 focus-within:opacity-100">
          {showCopyButton ? (
            <CopyTextButton text={rawText} label={t`Copy message`} />
          ) : (
            <span aria-hidden="true" className="block size-5" />
          )}
          {showFork ? <ForkTurnButton threadId={threadId} itemId={item.id} /> : null}
          {endedClock ? (
            <span
              title={endedFull}
              className="px-1 text-[10px] text-muted/70 [font-variant-numeric:tabular-nums]"
            >
              {endedClock}
            </span>
          ) : null}
        </div>
      ) : null}
    </Surface>
  );
});
