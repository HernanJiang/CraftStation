import type { ProjectLocation } from "@/shared/contracts";

/** Normalize model / markdown paths to a project-relative POSIX path for the file editor. */
export function normalizeChatRelativePath(raw: string): string {
  return normalizeChatPath(raw, { preserveAbsolute: false });
}

function normalizeChatPath(
  raw: string,
  options: { preserveAbsolute: boolean; windowsDrivePaths?: boolean },
): string {
  let s = raw.trim();
  if (!s) return s;
  if (/^file:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      s = decodeURIComponent(u.pathname);
      if (u.hostname) s = `//${u.hostname}${s}`;
      if (s.startsWith("/") && /^\/[A-Za-z]:/.test(s)) s = s.slice(1);
      else if (!options.preserveAbsolute) s = s.replace(/^\//, "");
    } catch {
      /* keep */
    }
  }
  s = s.replace(/^\.\//, "").replace(/\\/g, "/");
  // Markdown 链接常把盘符写成 /D:/...（URI pathname）。仅 Windows 项目
  // 去掉这一个前导 slash；POSIX 的 /D:/ 目录及 UNC //server/share 不得误改。
  if (options.windowsDrivePaths) s = s.replace(/^\/(?=[A-Za-z]:\/)/, "");
  const collapsed = s.startsWith("//")
    ? `//${s.slice(2).replace(/\/+/g, "/")}`
    : s.replace(/\/+/g, "/");
  return options.preserveAbsolute ? collapsed : collapsed.replace(/^\/+/, "");
}

export function normalizeChatProjectPath(raw: string, projectLocation: ProjectLocation): string {
  const { normalized, relative } = relativizeAgainstProjectRoots(raw, projectLocation);
  return relative ?? normalized;
}

/**
 * Display helper for chat tool-call rows: render a path relative to the agent's
 * working directory (the project / worktree root) when it lives inside it, and
 * the original absolute path otherwise. Unlike {@link normalizeChatProjectPath},
 * out-of-root paths are returned untouched (original separators preserved) so an
 * external file still reads as a plain `C:\…` / `/…` absolute path.
 */
export function toProjectRelativeDisplayPath(
  raw: string,
  projectLocation: ProjectLocation,
): string {
  const { relative } = relativizeAgainstProjectRoots(raw, projectLocation);
  if (relative === null) return raw;
  // A path that *is* the root (e.g. an action targeting the working dir itself)
  // collapses to an empty remainder — show "." so the row never renders blank.
  return relative.length > 0 ? relative : ".";
}

function relativizeAgainstProjectRoots(
  raw: string,
  projectLocation: ProjectLocation,
): { normalized: string; relative: string | null } {
  const normalized = normalizeChatPath(raw, {
    preserveAbsolute: true,
    windowsDrivePaths: projectLocation.kind === "windows",
  });
  const projectRoots = getProjectRoots(projectLocation).map((root) =>
    normalizeChatPath(root, { preserveAbsolute: true }),
  );
  const root = projectRoots.find((candidate) => pathStartsWithRoot(normalized, candidate));
  if (!root) return { normalized, relative: null };
  return { normalized, relative: normalized.slice(root.length).replace(/^\/+/, "") };
}

function getProjectRoots(projectLocation: ProjectLocation): string[] {
  switch (projectLocation.kind) {
    case "windows":
      return [projectLocation.path];
    case "wsl":
      return [projectLocation.linuxPath, projectLocation.uncPath];
    case "posix":
      return [projectLocation.path];
  }
}

function pathStartsWithRoot(path: string, root: string): boolean {
  const normalizedRoot = root.replace(/\/+$/, "");
  if (!normalizedRoot) return false;
  const windowsRoot = /^[A-Za-z]:\//.test(normalizedRoot) || normalizedRoot.startsWith("//");
  const lcPath = windowsRoot ? path.toLowerCase() : path;
  const lcRoot = windowsRoot ? normalizedRoot.toLowerCase() : normalizedRoot;
  if (path.length === normalizedRoot.length) return lcPath === lcRoot;
  return lcPath.startsWith(`${lcRoot}/`) || path.startsWith(`${normalizedRoot}/`);
}
