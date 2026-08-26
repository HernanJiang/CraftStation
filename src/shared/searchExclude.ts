/**
 * Patterns that are always excluded from the @file mention search. These
 * are not user-overridable — exposing them would be a large amount of
 * uninteresting plumbing or actively harmful content.
 */
export const LOCKED_SEARCH_EXCLUDE: readonly string[] = ["**/.git"];

/**
 * Default `search.exclude` patterns shipped with the app. Mirrors VS Code's
 * defaults plus the noisier dirs we already ignore in our file watcher.
 * Users can disable any of these. Patterns in `LOCKED_SEARCH_EXCLUDE`
 * are not listed here — they apply unconditionally.
 */
export const DEFAULT_SEARCH_EXCLUDE: Record<string, boolean> = {
  "**/node_modules": true,
  "**/dist": true,
  "**/build": true,
  "**/.next": true,
  "**/.turbo": true,
  "**/.venv": true,
  "**/__pycache__": true,
  "**/coverage": true,
  "**/.DS_Store": true,
};

export interface ResolvedSearchConfig {
  useIgnoreFiles: boolean;
  excludePatterns: string[];
}

interface MergeInputs {
  defaults?: Record<string, boolean>;
  global?: Record<string, boolean> | undefined;
  project?: Record<string, boolean> | undefined;
}

/**
 * Merge defaults + global + per-project exclude maps into the flat list of
 * enabled patterns, plus the unconditional `LOCKED_SEARCH_EXCLUDE` set.
 * Later layers override earlier ones; a value of `false` disables a
 * pattern that an earlier layer enabled (locked patterns are exempt).
 */
export function mergeExcludePatterns(inputs: MergeInputs): string[] {
  const merged: Record<string, boolean> = {
    ...(inputs.defaults ?? DEFAULT_SEARCH_EXCLUDE),
    ...(inputs.global ?? {}),
    ...(inputs.project ?? {}),
  };
  const out = new Set<string>(LOCKED_SEARCH_EXCLUDE);
  for (const [pattern, enabled] of Object.entries(merged)) {
    if (enabled) out.add(pattern);
  }
  return Array.from(out);
}

interface ResolveInputs {
  globalUseIgnoreFiles: boolean;
  globalExclude: Record<string, boolean>;
  projectUseIgnoreFiles?: boolean | undefined;
  projectExclude?: Record<string, boolean> | undefined;
}

/**
 * Resolve the effective search config for a project. The renderer passes
 * the result through to the supervisor IPC payload so the supervisor stays
 * stateless w.r.t. settings.
 */
export function resolveSearchConfig(inputs: ResolveInputs): ResolvedSearchConfig {
  return {
    useIgnoreFiles: inputs.projectUseIgnoreFiles ?? inputs.globalUseIgnoreFiles,
    excludePatterns: mergeExcludePatterns({
      defaults: DEFAULT_SEARCH_EXCLUDE,
      global: inputs.globalExclude,
      project: inputs.projectExclude,
    }),
  };
}
