import { useState } from "react";
import type { Project, Thread } from "@/shared/contracts";
import { useExperimentStore } from "@/renderer/state/experimentStore";
import { useSortable } from "@dnd-kit/react/sortable";
import { useIsDraggingThread, type DragSourceData } from "@/renderer/dnd";
import { SidebarButton } from "@/renderer/components/common/SidebarButton";
import { getStatusTone } from "@/renderer/components/providers/statusTone";
import { ThreadProviderIcon } from "@/renderer/components/providers/ThreadProviderIcon";
import { ThreadContextMenu } from "@/renderer/views/MainView/parts/Sidebar/parts/ThreadContextMenu";
import { DraftIndicator } from "../DraftIndicator";
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

export function SortableThreadItem(props: {
  thread: Thread;
  threadIndex: number;
  project: Project;
  showWorktreeBadge: boolean;
  showWorktreeFilesButton?: boolean;
  editingThreadId: string | null;
  setEditingThreadId: (id: string | null) => void;
  group: string;
  sortDisabled?: boolean;
  /** Trailing project label for cross-project (flat) lists. */
  projectTag?: React.ReactNode;
}) {
  const { thread, project, editingThreadId, sortDisabled = false, projectTag } = props;
  const isExperimentCandidate = useExperimentStore(
    (state) => thread.groupId !== undefined && state.experiments[thread.groupId] !== undefined,
  );
  const isCurrentThread = useIsCurrentThread(thread.id);
  const hasDraft = useThreadHasDraft(thread.id);
  const [contextMenuRequest, setContextMenuRequest] = useState<ContextMenuOpenRequest | null>(null);

  const { ref, handleRef } = useSortable({
    id: `thread:${thread.id}`,
    index: props.threadIndex,
    type: "thread",
    accept: sortDisabled || isExperimentCandidate ? [] : ["thread", "worktree-group"],
    group: props.group,
    // Automatic sort modes only disable reordering within the sidebar. Keep
    // ordinary threads draggable so they can still be dropped onto a pane.
    disabled: isExperimentCandidate,
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

  const hasBackgroundActivity = useThreadHasBackgroundActivity(thread.id);
  const statusTone = getStatusTone(thread, { hasBackgroundActivity });

  const stacked = projectTag != null;
  const isEditing = editingThreadId === thread.id;
  const titleNode = thread.done ? (
    <span className="opacity-50 line-through">{thread.title}</span>
  ) : (
    thread.title
  );
  const suffixProps = {
    thread,
    statusTone,
    isExperimentCandidate,
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
        onRename={() => props.setEditingThreadId(thread.id)}
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
                {hasDraft && <DraftIndicator />}
              </span>
            ) : isEditing ? (
              titleContent
            ) : (
              <span className="flex items-center gap-1.5">
                <span className="min-w-0 truncate">{titleNode}</span>
                {hasDraft && <DraftIndicator />}
              </span>
            )
          }
          tooltip={isEditing ? undefined : hoverDetails}
          tooltipAlways={!isEditing}
          tooltipDelay={0}
          tooltipClassName="pointer-events-none rounded-lg border border-white/10 bg-[#222329]/95 p-2 text-xs shadow-xl backdrop-blur-md"
          isActive={isCurrentThread}
          className={`poracode-sidebar-thread-row !mx-2 !my-0.5 !min-h-8 !rounded-lg !border ${isCurrentThread ? "!border-white/[0.04]" : "!border-transparent"} !px-2.5 !py-1.5`}
          onPress={() => openThread(thread.id)}
          onDoubleClick={() => props.setEditingThreadId(thread.id)}
          isDragging={isDragging}
          suffix={<ThreadItemSuffix {...suffixProps} />}
        />
      </ThreadContextMenu>
    </div>
  );
}
