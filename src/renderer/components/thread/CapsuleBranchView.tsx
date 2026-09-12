import { useEffect, useRef, useState } from "react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { GitBranch, Search } from "lucide-react";
import { toast } from "@heroui/react";
import type { GitBranchInfo, GitStatusResult } from "@/shared/contracts";
import { friendlyError } from "@/shared/messages";
import { readBridge } from "@/renderer/bridge";
import { useGitStore } from "@/renderer/state/gitStore";
import { buildBranchNamePrKey } from "@/renderer/state/gitSelectors";
import { usePanelStore } from "@/renderer/state/panelStore";
import { deleteWorktreeGroup } from "@/renderer/actions/worktreeActions";
import { useBranchList } from "@/renderer/components/common/BranchSelector/parts/useBranchList";
import {
  BranchListBox,
  type OpenPrReviewArgs,
} from "@/renderer/components/common/BranchSelector/parts/BranchListBox";
import { BranchFooterActions } from "@/renderer/components/common/BranchSelector/parts/BranchFooterActions";
import { ConfirmDialog } from "@/renderer/components/common/ConfirmDialog";
import { BranchSyncGraph } from "@/renderer/views/GitReviewOverlay/parts/GitReviewSidebar/parts/BranchSyncGraph";

interface PendingDelete {
  branch: GitBranchInfo;
  worktreePath?: string;
  threadIds: string[];
  threadCount: number;
}

/**
 * In-place branch management for the top-right status capsule.
 * Reuses the BranchSelector parts (search + list + create footer + delete
 * confirm) and the review sidebar's sync graph; only the switching callback
 * comes from the capsule so store patching stays in one place.
 * Worktree threads get a read-only view — switching the main checkout from
 * here would target the wrong tree.
 */
export function CapsuleBranchView(props: {
  projectId: string;
  branch: string;
  changedFiles: number;
  stagedCount: number;
  unstagedCount: number;
  gitStatus: GitStatusResult;
  isWorktree: boolean;
  onSwitchBranch: (branch: string, createNew: boolean) => void;
}) {
  const {
    projectId,
    branch,
    changedFiles,
    stagedCount,
    unstagedCount,
    gitStatus,
    isWorktree,
    onSwitchBranch,
  } = props;
  const { t } = useLingui();
  const [search, setSearch] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [deletingBranch, setDeletingBranch] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const createRef = useRef<HTMLInputElement>(null);

  // Focus the search like the BranchSelector popover does on open.
  useEffect(() => {
    const id = window.setTimeout(() => searchRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- focus once on view open

  const {
    items,
    hasLocal,
    hasRemote,
    worktreeBranches,
    branchWorktreePath,
    threadsByBranch,
    projectLocation,
  } = useBranchList({ projectId, search });

  function handleSelectBranch(next: string) {
    if (next === branch) return;
    onSwitchBranch(next, false);
  }

  function handleCreateBranch() {
    const name = newBranchName.trim();
    if (!name) return;
    onSwitchBranch(name, true);
    setIsCreating(false);
    setNewBranchName("");
  }

  function handleRequestDelete(target: GitBranchInfo) {
    const worktreePath = target.isRemote ? undefined : branchWorktreePath.get(target.name);
    const threads = threadsByBranch.get(target.name) ?? [];
    setPendingDelete({
      branch: target,
      ...(worktreePath ? { worktreePath } : {}),
      threadIds: threads.map((thread) => thread.id),
      threadCount: threads.length,
    });
  }

  function handleOpenPrReview(args: OpenPrReviewArgs) {
    usePanelStore.getState().setPrReviewContext({
      projectId,
      prNumber: args.prNumber,
      ...(args.worktreePath
        ? { worktreePath: args.worktreePath }
        : { prKey: buildBranchNamePrKey(projectId, args.branch) }),
    });
  }

  async function confirmDelete() {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target || !projectLocation) return;
    const { branch: doomed, worktreePath, threadIds } = target;
    // Worktree branches reuse the sidebar's removal path (closes linked threads,
    // runs the cleanup script, removes the worktree, then deletes the branch).
    if (worktreePath) {
      deleteWorktreeGroup(projectId, worktreePath, threadIds);
      return;
    }
    // Plain local or remote branch with no worktree — delete the ref directly.
    setDeletingBranch(doomed.name);
    try {
      await readBridge().gitDeleteBranch({
        projectLocation,
        branch: doomed.name,
        force: true,
        ...(doomed.remote ? { remote: doomed.remote } : {}),
      });
    } catch (error) {
      toast.danger(friendlyError(error));
    }
    try {
      const [branches, wts] = await Promise.all([
        readBridge().gitListBranches({ projectLocation, includeRemote: true }),
        readBridge().gitListWorktrees({ projectLocation }),
      ]);
      const store = useGitStore.getState();
      store.setBranches(projectId, branches);
      store.setWorktrees(projectId, wts.worktrees);
    } catch {
      // ignore refresh errors
    } finally {
      setDeletingBranch(null);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 px-1.5 py-1">
        <GitBranch className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
          {branch || "—"}
        </span>
      </div>
      <p className="truncate px-1.5 pb-1 text-[11px] leading-5 text-muted">
        {changedFiles > 0 ? (
          <Trans>
            未提交的更改：{changedFiles} 个文件（{stagedCount} staged · {unstagedCount} unstaged）
          </Trans>
        ) : (
          <Trans>工作区干净</Trans>
        )}
      </p>
      {isWorktree ? null : (
        <>
          <div className="flex items-center gap-1.5 border-y border-[var(--hairline)] px-1.5 py-1.5">
            <Search className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
            <input
              ref={searchRef}
              className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted"
              placeholder={t`搜索分支`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                  if (isCreating) {
                    setIsCreating(false);
                    setNewBranchName("");
                  } else {
                    setSearch("");
                  }
                }
              }}
            />
          </div>
          <div className="py-0.5">
            <BranchListBox
              projectId={projectId}
              items={items}
              hasLocal={hasLocal}
              hasRemote={hasRemote}
              currentBranch={branch}
              value={branch}
              baseBranch={undefined}
              isWorktree={false}
              worktreeMode={false}
              deletingBranch={deletingBranch}
              worktreeBranches={worktreeBranches}
              branchWorktreePath={branchWorktreePath}
              threadsByBranch={threadsByBranch}
              onSelect={handleSelectBranch}
              onDelete={(b) => handleRequestDelete(b as GitBranchInfo)}
              onOpenPrReview={handleOpenPrReview}
            />
          </div>
          <BranchFooterActions
            isCreating={isCreating}
            setIsCreating={setIsCreating}
            newBranchName={newBranchName}
            setNewBranchName={setNewBranchName}
            createRef={createRef}
            searchRef={searchRef}
            handleCreateBranch={handleCreateBranch}
            hideWorktreeToggle
            worktreeMode={false}
            onWorktreeModeChange={undefined}
            baseBranch={undefined}
            value={branch}
            isWorktree={false}
            branchWorktreePath={branchWorktreePath}
            onSelect={undefined}
            showMoveBranch={false}
            isMovingBranch={false}
            onMoveBranchToWorktree={() => undefined}
          />
        </>
      )}
      <BranchSyncGraph gitStatus={gitStatus} />
      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title={pendingDelete?.worktreePath ? t`Remove worktree?` : t`Delete branch?`}
        body={
          pendingDelete?.worktreePath ? (
            pendingDelete.threadCount > 0 ? (
              <Trans>
                This removes the worktree on "{pendingDelete.branch.name}" and closes{" "}
                <Plural
                  value={pendingDelete.threadCount}
                  one="# linked thread"
                  other="# linked threads"
                />
                , then deletes the branch.
              </Trans>
            ) : (
              <Trans>
                This removes the worktree on "{pendingDelete.branch.name}", then deletes the branch.
              </Trans>
            )
          ) : pendingDelete?.branch.isRemote ? (
            <Trans>
              This permanently deletes the branch "{pendingDelete.branch.name}" from its remote.
            </Trans>
          ) : (
            <Trans>This permanently deletes the branch "{pendingDelete?.branch.name ?? ""}".</Trans>
          )
        }
        confirmLabel={pendingDelete?.worktreePath ? t`Remove` : t`Delete`}
        onConfirm={() => void confirmDelete()}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
