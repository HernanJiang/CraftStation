import type { Project, Thread } from "@/shared/contracts";

/**
 * The absolute working path a thread belongs to: its worktree directory when
 * it has one, otherwise its project's location. This is what "copy thread
 * path" copies — never the internal thread id.
 */
export function threadAbsolutePath(thread: Thread, project: Project): string {
  if (thread.worktreePath) return thread.worktreePath;
  const location = project.location;
  if (location.kind === "wsl") return location.uncPath || location.linuxPath;
  return location.path;
}
