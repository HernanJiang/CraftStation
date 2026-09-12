import { useEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { GitBranch, Upload } from "lucide-react";
import { toast } from "@heroui/react";
import type { ProjectLocation } from "@/shared/contracts";
import { friendlyError } from "@/shared/messages";
import { buildWorktreeLocation } from "@/shared/worktree";
import { readBridge } from "@/renderer/bridge";
import { runGitSyncCommand } from "@/renderer/actions/gitCommandRunner";
import { refreshGitProject } from "@/renderer/state/gitRefresh";

/**
 * In-place commit panel for the top-right status capsule.
 * Thin UI over the git capabilities the app already owns (`gitCommit` IPC +
 * the shared push runner); no new git system. Empty messages are refused
 * honestly instead of inventing auto-generation this surface cannot do.
 */
export function CapsuleCommitView(props: {
  projectId: string;
  projectLocation: ProjectLocation;
  worktreePath?: string | undefined;
  branch: string;
  insertions: number;
  deletions: number;
  stagedCount: number;
  unstagedCount: number;
  hasRemote: boolean;
  ahead: number;
}) {
  const {
    projectId,
    projectLocation,
    worktreePath,
    branch,
    insertions,
    deletions,
    stagedCount,
    unstagedCount,
    hasRemote,
    ahead,
  } = props;
  const { t } = useLingui();
  const [message, setMessage] = useState("");
  const [addAll, setAddAll] = useState(true);
  const [busy, setBusy] = useState<"commit" | "push" | null>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  // Focus the message field when the view opens.
  useEffect(() => {
    const id = window.setTimeout(() => messageRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- focus once on view open

  const changedFiles = stagedCount + unstagedCount;
  const trimmed = message.trim();
  const canPush = hasRemote && ahead > 0 && busy === null;

  const effectiveLocation = worktreePath
    ? buildWorktreeLocation(projectLocation, worktreePath)
    : projectLocation;

  async function refreshAfterWrite() {
    await refreshGitProject({ id: projectId, location: projectLocation }, "manual", "full");
  }

  async function doCommit(pushAfter: boolean) {
    if (!trimmed || busy !== null) {
      if (!trimmed) toast.danger(t`请填写提交信息`);
      return;
    }
    setBusy("commit");
    try {
      await readBridge().gitCommit({
        projectLocation: effectiveLocation,
        message: trimmed,
        addAll,
      });
      setMessage("");
      await refreshAfterWrite().catch(() => undefined);
      if (pushAfter && hasRemote) {
        await runGitSyncCommand({
          command: "push",
          projectLocation: effectiveLocation,
          remote: "origin",
          setUpstream: true,
        }).catch(() => undefined);
        await refreshAfterWrite().catch(() => undefined);
      }
    } catch (error) {
      toast.danger(friendlyError(error));
    } finally {
      setBusy(null);
    }
  }

  async function doPush() {
    if (!canPush) return;
    setBusy("push");
    try {
      await runGitSyncCommand({
        command: "push",
        projectLocation: effectiveLocation,
        remote: "origin",
        setUpstream: true,
      }).catch(() => undefined);
      await refreshAfterWrite().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 px-1.5 py-1">
        <GitBranch className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
          {branch || "—"}
        </span>
        <span className="shrink-0 text-[11px] font-semibold [font-variant-numeric:tabular-nums]">
          <span className="text-emerald-400">+{insertions}</span>{" "}
          <span className="text-red-400">-{deletions}</span>
        </span>
      </div>
      <div className="px-1.5 pb-1">
        <textarea
          ref={messageRef}
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void doCommit(false);
          }}
          placeholder={t`提交信息`}
          aria-label={t`提交信息`}
          className="w-full resize-none rounded-md border border-[color:var(--border)] bg-[var(--composer-surface)] px-2 py-1.5 text-xs leading-5 text-foreground outline-none placeholder:text-muted focus:border-[color:var(--focus,var(--border))]"
        />
      </div>
      <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5 text-[11px] text-muted">
        <span className="flex min-w-0 items-center gap-1.5">
          <input
            type="checkbox"
            checked={addAll}
            onChange={(e) => setAddAll(e.target.checked)}
            aria-label={t`包含未暂存的更改`}
            className="size-3.5 shrink-0 accent-emerald-500"
          />
          <span className="truncate">
            <Trans>包含未暂存的更改</Trans>
          </span>
        </span>
        <span className="shrink-0 [font-variant-numeric:tabular-nums]">
          <Trans>{changedFiles} 个文件</Trans>
        </span>
      </div>
      <div className="space-y-1 px-1.5 pb-1">
        <button
          type="button"
          disabled={!trimmed || busy !== null}
          onClick={() => void doCommit(false)}
          title={!trimmed ? t`请填写提交信息` : t`提交 (Ctrl+Enter)`}
          className="flex h-7 w-full items-center justify-center gap-1.5 rounded-md bg-[var(--row-active)] px-2 text-xs font-medium text-foreground transition-colors hover:bg-[var(--row-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trans>提交</Trans>
          <kbd className="rounded border border-[var(--hairline)] px-1 font-sans text-[10px] text-muted">
            Ctrl+↵
          </kbd>
        </button>
        <button
          type="button"
          disabled={!trimmed || busy !== null || !hasRemote}
          onClick={() => void doCommit(true)}
          title={!trimmed ? t`请填写提交信息` : t`提交并推送`}
          className="flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-[var(--hairline)] px-2 text-xs font-medium text-foreground transition-colors hover:bg-[var(--row-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Upload className="size-3.5 text-muted" aria-hidden="true" />
          <Trans>提交并推送</Trans>
        </button>
        <button
          type="button"
          disabled={!canPush}
          onClick={() => void doPush()}
          title={
            canPush ? t`推送 ${ahead} 个提交` : busy !== null ? t`处理中…` : t`没有可推送的提交`
          }
          className="flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-[var(--hairline)] px-2 text-xs font-medium text-foreground transition-colors hover:bg-[var(--row-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Upload className="size-3.5 text-muted" aria-hidden="true" />
          {busy === "push" ? <Trans>推送中…</Trans> : <Trans>推送</Trans>}
        </button>
      </div>
    </div>
  );
}
