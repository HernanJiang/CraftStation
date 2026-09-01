import type { Project, ProjectLocation } from "./contracts";

// Persisted in project/thread rows; keep the legacy ID so upgraded databases
// do not create a second Home project or orphan existing Home threads.
export const HOME_PROJECT_ID = "__craftstation_home__";
export const HOME_PROJECT_NAME = "Home";

export function isHomeProjectId(projectId: string | undefined): boolean {
  return projectId === HOME_PROJECT_ID;
}

export function isHomeProject(project: Pick<Project, "id"> | undefined): boolean {
  return isHomeProjectId(project?.id);
}

/**
 * True when the workspace *is* the user home directory (CraftStation's Home
 * scope). Home is a projectless OS-level session, so agents must not be
 * confined to that folder — every provider, not just ACP.
 */
export function isHomeScopeLocation(location: ProjectLocation): boolean {
  const raw = location.kind === "wsl" ? location.linuxPath : location.path;
  const normalized = raw.replace(/\\/gu, "/").replace(/\/+$/u, "");
  if (location.kind === "windows" || /^[A-Za-z]:\//.test(normalized)) {
    return /^[A-Za-z]:\/Users\/[^/]+$/i.test(normalized);
  }
  return /^\/(?:home\/[^/]+|Users\/[^/]+|root)$/.test(normalized);
}

const HOME_WORKSPACE_ROOT = ".craftstation/workspace-home";

/**
 * Working directory for a provider session bound to `location`.
 *
 * Real projects run in their own location. A projectless (Home) thread must
 * NOT run with the user home directory as cwd: CLI agents then scan the real
 * home and pick up unrelated projects and state there (observed with Codex
 * and OpenCode). Home-scope threads get a stable per-thread scratch directory
 * under the CraftStation home scope instead — the cwd stays identical across
 * turns and restarts so provider sessions can resume, while file churn lands
 * in a clearly CraftStation-owned folder.
 */
export function resolveThreadWorkspace(location: ProjectLocation, threadId: string): string {
  if (!isHomeScopeLocation(location)) {
    return location.kind === "wsl" ? location.linuxPath : location.path;
  }
  const segment = threadId.replace(/[^a-zA-Z0-9._-]/gu, "-") || "home";
  const base = (location.kind === "wsl" ? location.linuxPath : location.path).replace(
    /[\\/]+$/u,
    "",
  );
  return `${base}/${HOME_WORKSPACE_ROOT}/${segment}`;
}
