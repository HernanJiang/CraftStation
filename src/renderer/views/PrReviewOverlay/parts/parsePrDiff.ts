import { extractDiffNames } from "../../GitReviewOverlay/parts/diffBuildClient";

/**
 * Splits a multi-file unified diff (output of `gh pr diff <n>`) into per-file
 * patch strings keyed by the new path (`+++ b/<path>`), falling back to the old
 * path for deletions. Each chunk preserves its full `diff --git ...` header so
 * the diff renderer can ingest it directly.
 */
export function splitUnifiedDiff(raw: string): Map<string, string> {
  const result = new Map<string, string>();
  if (!raw.trim()) return result;

  const lines = raw.split("\n");
  let current: string[] | null = null;

  function flush() {
    if (!current) return;
    const block = current.join("\n");
    const { newName, oldName } = extractDiffNames(block);
    const path = newName || oldName;
    if (path) result.set(path, block);
    current = null;
  }

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flush();
      current = [line];
      continue;
    }
    if (current) current.push(line);
  }
  flush();
  return result;
}
