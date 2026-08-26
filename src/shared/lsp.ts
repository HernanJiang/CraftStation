import type { ProjectLocation } from "./contracts";

// ── LSP IPC payload types ───────────────────────────────────

export interface LspStartPayload {
  /** Unique session key, e.g. "projectId:typescript" */
  sessionId: string;
  projectLocation: ProjectLocation;
  /** Language identifier — maps to a server config in the registry */
  languageId: string;
}

export interface LspStopPayload {
  sessionId: string;
}

export interface LspMessagePayload {
  sessionId: string;
  /** Raw JSON-RPC message to forward to the language server */
  message: unknown;
}

export type LspSessionStatus = "starting" | "ready" | "error" | "stopped";

// ── File URI helpers ────────────────────────────────────────

function normalizeProjectRoot(location: ProjectLocation): string {
  const root = location.kind === "wsl" ? location.linuxPath : location.path;
  return root.replace(/\\/g, "/").replace(/\/+$/g, "");
}

function normalizeRelativeProjectPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/g, "");
}

function encodeFileUriPath(path: string): string {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part).replace(/%3A/gi, ":"))
    .join("/");
}

export function createLspFileUriFromAbsolutePath(path: string): string {
  const normalizedPath = path.replace(/\\/g, "/");
  const absolutePath = normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`;
  return `file://${encodeFileUriPath(absolutePath)}`;
}

export function createLspRootUri(location: ProjectLocation): string {
  return createLspFileUriFromAbsolutePath(normalizeProjectRoot(location));
}

export function createLspFileUri(location: ProjectLocation, path: string): string {
  const root = normalizeProjectRoot(location);
  const relativePath = normalizeRelativeProjectPath(path);
  return createLspFileUriFromAbsolutePath(relativePath ? `${root}/${relativePath}` : root);
}
