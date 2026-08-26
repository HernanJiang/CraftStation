const DRAFT_PREFIX = "draft:";
const DRAFT_SUFFIX_SEPARATOR = "#";

export function isDraftPaneId(id: string): boolean {
  return id.startsWith(DRAFT_PREFIX);
}

export function makeDraftPaneId(projectId: string): string {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${DRAFT_PREFIX}${projectId}${DRAFT_SUFFIX_SEPARATOR}${suffix}`;
}

export function parseDraftProjectId(id: string): string | undefined {
  if (!id.startsWith(DRAFT_PREFIX)) return undefined;
  const rest = id.slice(DRAFT_PREFIX.length);
  const sepIdx = rest.indexOf(DRAFT_SUFFIX_SEPARATOR);
  return sepIdx === -1 ? rest : rest.slice(0, sepIdx);
}
