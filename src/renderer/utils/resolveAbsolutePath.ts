import type { ProjectLocation } from "@/shared/contracts";

/**
 * Resolve a repo-relative path to an absolute path on the project's filesystem.
 * Handles Windows, WSL (via UNC path), and POSIX project locations.
 */
export function resolveAbsolutePath(location: ProjectLocation, relativePath: string): string {
  if (location.kind === "wsl") {
    const joined = relativePath ? `${location.linuxPath}/${relativePath}` : location.linuxPath;
    return joined.replace(/\/+/g, "/");
  }
  if (location.kind === "windows") {
    const sep = location.path.endsWith("\\") || location.path.endsWith("/") ? "" : "\\";
    return relativePath
      ? `${location.path}${sep}${relativePath.replace(/\//g, "\\")}`
      : location.path;
  }
  const sep = location.path.endsWith("/") ? "" : "/";
  return relativePath ? `${location.path}${sep}${relativePath}` : location.path;
}
