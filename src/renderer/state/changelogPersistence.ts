export const CHANGELOG_STORAGE_KEYS = {
  seenVersion: "craftstation-changelog-seen-version",
  acknowledgedVersion: "craftstation-changelog-ack-version",
  hidden: "craftstation-whatsnew-hidden",
  cache: "craftstation-changelog-cache",
} as const;

const LEGACY_CHANGELOG_STORAGE_KEYS = {
  seenVersion: "craftstation-changelog-seen-version",
  acknowledgedVersion: "craftstation-changelog-ack-version",
  hidden: "craftstation-whatsnew-hidden",
  cache: "craftstation-changelog-cache",
} as const;

/**
 * Preserve the user's changelog position across the CraftStation -> CraftStation
 * rename. Copy only missing values so a CraftStation launch always wins over stale
 * legacy state, and keep the originals for downgrade safety.
 */
export function migrateLegacyChangelogStorage(storage: Pick<Storage, "getItem" | "setItem">): void {
  try {
    for (const key of Object.keys(CHANGELOG_STORAGE_KEYS) as Array<
      keyof typeof CHANGELOG_STORAGE_KEYS
    >) {
      const currentKey = CHANGELOG_STORAGE_KEYS[key];
      if (storage.getItem(currentKey) !== null) continue;
      const legacyValue = storage.getItem(LEGACY_CHANGELOG_STORAGE_KEYS[key]);
      if (legacyValue !== null) storage.setItem(currentKey, legacyValue);
    }
  } catch {
    // Storage can be unavailable under strict browser/privacy policies. The
    // changelog store already degrades to in-memory defaults in that case.
  }
}
