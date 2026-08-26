import { useRef } from "react";
import { FileDiff } from "lucide-react";
import { Trans } from "@lingui/react/macro";
import type { GitStatusResult, Project } from "@/shared/contracts";
import { GitFindBar } from "@/renderer/components/find/GitFindBar";
import { SingleFileDiff } from "./parts/SingleFileDiff";

export type DiffFilter = "changes" | "staged";

/**
 * The changed-file list is owned by GitReviewSidebar and virtualized there.
 * Render one selected diff at a time so opening Review never loads and builds
 * every changed file in the repository.
 */
export function GitDiffContent(props: {
  project: Project;
  gitStatus: GitStatusResult | undefined;
  selectedFile: string | null;
  selectedStaged: boolean;
  diffMode: number;
  diffFilter: DiffFilter;
  refreshKey: number;
  worktreePath: string | undefined;
}) {
  const {
    project,
    gitStatus,
    selectedFile,
    selectedStaged,
    diffMode,
    diffFilter,
    refreshKey,
    worktreePath,
  } = props;
  const singleFileScrollRef = useRef<HTMLDivElement>(null);

  if (!gitStatus?.isRepo) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        <Trans>Not a git repository</Trans>
      </div>
    );
  }

  const selectedChange = (selectedStaged ? gitStatus.staged : gitStatus.unstaged).find(
    (entry) => entry.path === selectedFile,
  );
  const filteredCount =
    diffFilter === "staged" ? gitStatus.staged.length : gitStatus.unstaged.length;

  return (
    <div
      data-poracode-find-scope="git"
      className="poracode-git-diff-content relative h-full min-h-0"
    >
      {selectedFile ? <GitFindBar containerRef={singleFileScrollRef} /> : null}

      {!selectedFile ? (
        <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 px-6 text-center text-xs text-muted/60">
          <FileDiff className="size-5 text-muted/40" />
          {filteredCount > 0 ? (
            <Trans>Select a changed file to review its diff.</Trans>
          ) : diffFilter === "staged" ? (
            <Trans>No staged changes</Trans>
          ) : (
            <Trans>No changes to display</Trans>
          )}
        </div>
      ) : (
        <SingleFileDiff
          project={project}
          filePath={selectedFile}
          staged={selectedStaged}
          {...(selectedChange
            ? { changedLines: selectedChange.insertions + selectedChange.deletions }
            : {})}
          diffMode={diffMode}
          refreshKey={refreshKey}
          containerRef={singleFileScrollRef}
          annotationTarget={{ projectId: project.id, worktreePath }}
        />
      )}
    </div>
  );
}
