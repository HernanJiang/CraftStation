import { useEffect, useRef, useState } from "react";
import type { FileEntry, ProjectLocation } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { resolveSearchConfig } from "@/shared/searchExclude";

export function useDebouncedFileSearch(
  projectLocation: ProjectLocation | undefined,
  query: string,
  isActive: boolean,
  projectId?: string,
): FileEntry[] {
  const [results, setResults] = useState<FileEntry[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const abortRef = useRef(0);

  const globalUseIgnoreFiles = useSharedSettings((s) => s.searchUseIgnoreFiles);
  const globalExclude = useSharedSettings((s) => s.searchExclude);
  const projectSearchSettings = useAppStore((s) =>
    projectId ? s.projects.find((p) => p.id === projectId)?.searchSettings : undefined,
  );

  useEffect(() => {
    if (!isActive || !projectLocation) {
      setResults([]);
      return;
    }

    if (timerRef.current !== undefined) clearTimeout(timerRef.current);

    const requestId = ++abortRef.current;

    // For empty query, fetch immediately (show top files)
    const delay = query.length === 0 ? 0 : 150;

    const searchConfig = resolveSearchConfig({
      globalUseIgnoreFiles,
      globalExclude,
      projectUseIgnoreFiles: projectSearchSettings?.useIgnoreFiles,
      projectExclude: projectSearchSettings?.exclude,
    });

    timerRef.current = setTimeout(() => {
      void (async () => {
        try {
          const result = await readBridge().searchProjectFiles({
            projectLocation,
            query,
            limit: 20,
            searchConfig,
          });
          // Only apply if this is still the latest request
          if (abortRef.current === requestId) {
            setResults(result.entries);
          }
        } catch {
          if (abortRef.current === requestId) {
            setResults([]);
          }
        }
      })();
    }, delay);

    return () => {
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    };
  }, [
    projectLocation,
    query,
    isActive,
    globalUseIgnoreFiles,
    globalExclude,
    projectSearchSettings,
  ]);

  return results;
}
