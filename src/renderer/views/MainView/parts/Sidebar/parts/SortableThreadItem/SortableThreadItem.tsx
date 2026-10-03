import { useState } from "react";
import { Pin } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import type { Project, Thread } from "@/shared/contracts";
import { useExperimentStore } from "@/renderer/state/experimentStore";
import { useSortable } from "@dnd-kit/react/sortable";
import { useIsDraggingThread, type DragSourceData } from "@/renderer/dnd";
import { SidebarButton } from "@/renderer/components/common/SidebarButton";
import { getStatusTone } from "@/renderer/components/providers/statusTone";
import { ThreadProviderIcon } from "@/renderer/components/providers/ThreadProviderIcon";
import { ThreadContextMenu } from "@/renderer/views/MainView/parts/Sidebar/parts/ThreadContextMenu";
import { InlineRenameInput } from "../InlineRenameInput";
import { ThreadItemSuffix } from "./parts/ThreadItemSuffix";
import type { ContextMenuOpenRequest } from "@/renderer/components/common/ContextMenu";
import { RelativeTime } from "@/renderer/components/common/RelativeTime";
import {
  useIsCurrentThread,
  useThreadHasBackgroundActivity,
  useThreadHasDraft,
} from "@/renderer/hooks/uiSelectors";
import { openThread, renameThread } from "@/renderer/actions/threadActions";
import {
  selectThreadHasUnreadNotification,
  useNotificationStore,
} from "@/renderer/state/notificationStore";

export function SortableThreadItem(props: {
  thread: Thread;
  threadIndex: number;
  project: Project;
  showWorktreeBadge: boolean;
  showWorktreeFilesButton?: boolean;
  editingThreadId: string | null;
  setEditingThreadId: (id: string | null) => void;
  /**
   * Unique key of this rendered row (e.g. `thread:id` for the project list,
   * `workspace:id` for the inbox shortcut, `pinned:id` for the pinned
   * section). The same thread can appear in several sidebar sections at once,
   * so editing identity must be per-row — keying on `thread.id` alone makes
   * every duplicate row mount a rename input that steals each other's focus.
   */
  editKey: string;
  group: string;
  sortDisabled?: boolean;
  /** Trailing project label for cross-project (flat) lists. */
  projectTag?: React.ReactNode;
  /** Workspace inbox rows unpin back to their project instead of starring. */
  pinState?: { pinned: boolean; onToggle: () => void };
  /**
   * Distinct sortable id for a second entry of the same thread. The inbox
   * row is a shortcut, so it must not share `thread:${id}` with the project row.
   */
  sortableId?: string;
  /** Shortcut rows are not drag sources; dragging would reorder the real thread. */
  dragDisabled?: boolean;
}) {
  const {
    thread,
    project,
    editingThreadId,
    sortDisabled = false,
    projectTag,
    pinState,
    sortableId,
    dragDisabled = false,
    editKey,
  } = props;
  const isExperimentCandidate = useExperimentStore(
    (state) => thread.groupId !== undefined && state.experiments[thread.groupId] !== undefined,
  );
  const isCurrentThread = useIsCurrentThread(thread.id);
  const hasDraft = useThreadHasDraft(thread.id);
  const hasUnreadNotification = useNotificationStore((state) =>
    selectThreadHasUnreadNotification(state.items, thread.id),
  );
  const [contextMenuRequest, setContextMenuRequest] = useState<ContextMenuOpenRequest | null>(null);

  const { ref, handleRef } = useSortable({
    id: sortableId ?? `thread:${thread.id}`,
    index: props.threadIndex,
    type: "thread",
    accept:
      sortDisabled || isExperimentCandidate || dragDisabled ? [] : ["thread", "worktree-group"],
    group: props.group,
    // Automatic sort modes only disable reordering within the sidebar. Keep
    // ordinary threads draggable so they can still be dropped onto a pane.
    // A workspace shortcut is not a second copy, so it does not drag at all.
    disabled: isExperimentCandidate || dragDisabled,
    data: {
      type: "thread",
      threadId: thread.id,
      projectId: thread.projectId,
      ...(thread.worktreePath != null ? { worktreePath: thread.worktreePath } : {}),
      sortGroup: props.group,
      sortIndex: props.threadIndex,
    } satisfies DragSourceData,
  });

  const isDragging = useIsDraggingThread(thread.id);
  const { t } = useLingui();

  const hasBackgroundActivity = useThreadHasBackgroundActivity(thread.id);
  const statusTone = getStatusTone(thread, { hasBackgroundActivity });

  const stacked = projectTag != null;
  const isEditing = editingThreadId === editKey;
  const isPinned = pinState ? pinState.pinned : thread.starred;
  const titleNode = thread.done ? (
    <span className="opacity-50 line-through">{thread.title}</span>
  ) : (
    thread.title
  );
  const suffixProps = {
    thread,
    statusTone,
    isExperimentCandidate,
    hasUnreadNotification,
    hasDraft,
    ...(pinState ? { pinState } : {}),
    onMore: (event: React.MouseEvent<HTMLButtonElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      setContextMenuRequest({ x: rect.right, y: rect.bottom, nonce: Date.now() });
    },
  };
  const titleContent = isEditing ? (
    <InlineRenameInput
      initialValue={thread.title}
      onCommit={(newTitle) => {
        renameThread(thread.id, newTitle);
        props.setEditingThreadId(null);
      }}
      onCancel={() => props.setEditingThreadId(null)}
    />
  ) : (
    titleNode
  );
  const hoverDetails = (
    <div className="min-w-52 space-y-1.5">
      <div className="flex min-w-0 items-center justify-between gap-4">
        <span className="min-w-0 truncate font-medium text-neutral-100">{thread.title}</span>
        <RelativeTime iso={thread.updatedAt} className="shrink-0 text-[11px] text-neutral-400" />
      </div>
      <div className="flex min-w-0 items-center justify-between gap-3 text-[11px] text-neutral-400">
        <span className="min-w-0 truncate">📁 {project.name}</span>
        <span className="max-w-28 shrink-0 truncate">
          {thread.worktreeBranch ? `🌿 ${thread.worktreeBranch}` : thread.status}
        </span>
      </div>
    </div>
  );

  return (
    <div ref={ref} className="relative w-full pb-0.5">
      <ThreadContextMenu
        thread={thread}
        project={project}
        onRename={() => props.setEditingThreadId(editKey)}
        showProjectActions={stacked}
        openRequest={contextMenuRequest}
      >
        <SidebarButton
          ref={handleRef}
          size="xs"
          density={stacked ? "compact" : "default"}
          statusTone={statusTone}
          icon={
            <ThreadProviderIcon thread={thread} tone="inactive" className="size-3.5 shrink-0" />
          }
          label={
            stacked ? (
              <span className="flex min-w-0 items-center gap-1.5 pr-0.5">
                <span className="min-w-0 flex-1 truncate">{titleContent}</span>
                {isPinned && !isEditing ? (
                  <Pin className="size-3 shrink-0 fill-current text-muted" aria-label={t`Pinned`} />
                ) : null}
              </span>
            ) : isEditing ? (
              titleContent
            ) : (
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate">{titleNode}</span>
                {isPinned ? (
                  <Pin className="size-3 shrink-0 fill-current text-muted" aria-label={t`Pinned`} />
                ) : null}
              </span>
            )
          }
          tooltip={isEditing ? undefined : hoverDetails}
          tooltipAlways={!isEditing}
          tooltipDelay={0}
          tooltipClassName="pointer-events-none rounded-none border border-[var(--hairline)] bg-[var(--overlay)] p-2 text-xs shadow-xl backdrop-blur-md"
          isActive={isCurrentThread}
          className={`craftstation-sidebar-thread-row !mx-2 !my-0.5 !min-h-8 !rounded-none !border ${isCurrentThread ? "!border-white/[0.04]" : "!border-transparent"} !px-2.5 !py-1.5`}
          onPress={() => openThread(thread.id)}
          onDoubleClick={() => props.setEditingThreadId(editKey)}
          isDragging={isDragging}
          suffix={<ThreadItemSuffix {...suffixProps} />}
        />
      </ThreadContextMenu>
    </div>
  );
}
