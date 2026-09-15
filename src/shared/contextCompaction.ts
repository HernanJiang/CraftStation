/**
 * Names that mean a provider is compacting conversation context.
 * Compared case-insensitively after stripping `_`, `-`, and whitespace.
 *
 * Keep this matcher strict: a bare `compact` / `compaction` tool name is too
 * easy to collide with slash commands (Grok `/compact`) and unrelated tools.
 * Providers that actually compacted should emit `ContextCompaction` (or a
 * `contextCompact*` / `compactContext*` spelling) at the mapping boundary.
 */
export function isContextCompactionToolName(name: string | undefined | null): boolean {
  if (!name) return false;
  const normalized = name.toLowerCase().replace(/[\s_-]/g, "");
  if (!normalized) return false;
  return (
    normalized.includes("contextcompact") ||
    normalized.includes("compactcontext") ||
    normalized.includes("conversationcompact")
  );
}
