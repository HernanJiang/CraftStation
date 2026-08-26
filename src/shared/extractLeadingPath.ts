const TITLE_DELIMITERS = [": ", " => ", " -> "];

export function extractLeadingPath(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const candidates = [trimmed];
  for (const delimiter of TITLE_DELIMITERS) {
    const index = trimmed.indexOf(delimiter);
    if (index > 0) candidates.push(trimmed.slice(0, index).trim());
  }
  for (const candidate of candidates) {
    if (isLikelyPath(candidate)) return candidate;
  }
  return undefined;
}

function isLikelyPath(candidate: string): boolean {
  if (!candidate) return false;
  if (/\s/.test(candidate)) return false;
  if (/[*?<>|]/.test(candidate)) return false;
  if (candidate.endsWith("/") || candidate.endsWith("\\")) return false;
  if (/^[A-Za-z]:[\\/]/.test(candidate)) return true;
  if (candidate.includes("/") || candidate.includes("\\")) return true;
  return /^[^\\/\s:*?"<>|]+\.[^\\/\s:*?"<>|]+$/.test(candidate);
}
