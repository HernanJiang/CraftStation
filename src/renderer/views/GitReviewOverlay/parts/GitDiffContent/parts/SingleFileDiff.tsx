import { useEffect, useState, type RefObject } from "react";
import { DiffFile, DiffView } from "@git-diff-view/react";
import { Trans } from "@lingui/react/macro";
import type { Project } from "@/shared/contracts";
import {
  buildInWorker,
  diffFileFromBundle,
  extractDiffNames,
  getLang,
  useDiffTheme,
} from "../../diffBuildClient";
import { DiffAnnotationView } from "../../DiffAnnotationView";
import { loadGitDiffForDisplay } from "../../gitDiffLoader";
import { LARGE_DIFF_THRESHOLD } from "./diffHelpers";

export function SingleFileDiff(props: {
  project: Project;
  filePath: string;
  staged: boolean;
  changedLines?: number;
  diffMode: number;
  refreshKey: number;
  containerRef: RefObject<HTMLDivElement | null>;
  annotationTarget?: { projectId: string; worktreePath: string | undefined };
}) {
  const { project, filePath, staged, changedLines, diffMode, refreshKey } = props;
  const theme = useDiffTheme();
  const [diffFile, setDiffFile] = useState<DiffFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const tooLarge = changedLines !== undefined && changedLines > LARGE_DIFF_THRESHOLD;

  useEffect(() => {
    let cancelled = false;

    setLoading(!tooLarge);
    setLoadFailed(false);
    setDiffFile(null);

    if (tooLarge) return undefined;

    async function load() {
      try {
        const { result, oldContent, newContent } = await loadGitDiffForDisplay({
          projectLocation: project.location,
          filePath,
          staged,
        });
        if (cancelled) return;
        const { oldName, newName } = extractDiffNames(result.diff);
        const results = await buildInWorker([
          {
            key: `single:${filePath}`,
            diff: result.diff,
            oldName,
            newName,
            fileLang: getLang(newName || filePath),
            oldContent,
            newContent,
          },
        ]);
        if (cancelled) return;
        const r = results[0];
        if (r?.bundle) setDiffFile(diffFileFromBundle(r.data, r.bundle));
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
      if (!cancelled) setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [filePath, staged, project.id, project.location, refreshKey, tooLarge]);

  return (
    <div
      ref={props.containerRef}
      className="absolute inset-0 z-10 overflow-y-auto bg-[var(--content-background)] px-4"
    >
      {loading && (
        <div className="flex items-center justify-center py-8 text-sm text-muted">
          <Trans>Loading diff...</Trans>
        </div>
      )}
      {!loading && tooLarge && (
        <div className="flex flex-col items-center justify-center gap-1 py-8 text-sm text-muted">
          <Trans>File too large to display</Trans>
          <span className="text-xs text-muted/60">{changedLines} lines changed</span>
        </div>
      )}
      {!loading && loadFailed && (
        <div className="flex items-center justify-center py-8 text-sm text-muted">
          <Trans>Unable to load diff.</Trans>
        </div>
      )}
      {!loading && !tooLarge && !loadFailed && !diffFile && (
        <div className="flex items-center justify-center py-8 text-sm text-muted">
          <Trans>No changes to display</Trans>
        </div>
      )}
      {diffFile && (
        <div className="space-y-4">
          <div className="rounded border border-border">
            {props.annotationTarget ? (
              <DiffAnnotationView
                diffFile={diffFile}
                filePath={filePath}
                projectId={props.annotationTarget.projectId}
                staged={staged}
                worktreePath={props.annotationTarget.worktreePath}
                diffViewMode={diffMode}
                diffViewTheme={theme}
                diffViewFontSize={12}
                diffViewHighlight={true}
                diffViewWrap={false}
              />
            ) : (
              <DiffView
                diffFile={diffFile}
                diffViewMode={diffMode}
                diffViewTheme={theme}
                diffViewFontSize={12}
                diffViewHighlight={true}
                diffViewWrap={false}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
