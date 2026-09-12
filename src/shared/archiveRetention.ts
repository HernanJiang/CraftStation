/**
 * Archived-thread retention policy.
 *
 * Source of truth is ALWAYS `archivedAt` (when the thread entered the
 * archive), never `createdAt` / `updatedAt` / `lastMessageAt`. Changing the
 * policy re-evaluates existing archives from their original `archivedAt` —
 * it never restarts the clock from the settings-change time.
 */

export const ARCHIVE_RETENTION_VALUES = [
  "immediate",
  "3d",
  "7d",
  "15d",
  "30d",
  "forever",
] as const;

export type ArchiveRetention = (typeof ARCHIVE_RETENTION_VALUES)[number];

/** Fresh-profile default per spec. */
export const DEFAULT_ARCHIVE_RETENTION: ArchiveRetention = "7d";

const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeArchiveRetention(value: unknown): ArchiveRetention {
  return (ARCHIVE_RETENTION_VALUES as readonly unknown[]).includes(value)
    ? (value as ArchiveRetention)
    : DEFAULT_ARCHIVE_RETENTION;
}

/**
 * Retention window in days. `0` = immediate, `null` = never auto-delete.
 * Documented: `null` means forever (scheduler skips, manual delete allowed).
 */
export function archiveRetentionToDays(retention: ArchiveRetention): number | null {
  switch (retention) {
    case "immediate":
      return 0;
    case "3d":
      return 3;
    case "7d":
      return 7;
    case "15d":
      return 15;
    case "30d":
      return 30;
    case "forever":
      return null;
  }
}

/** Absolute auto-delete time from `archivedAt`. Null = never auto-delete. */
export function getArchiveDeleteAfter(
  archivedAtMs: number,
  retention: ArchiveRetention,
): number | null {
  const days = archiveRetentionToDays(retention);
  if (days === null) return null;
  if (!Number.isFinite(archivedAtMs)) return null;
  return archivedAtMs + days * DAY_MS;
}

/** True when the archive entry is due for cleanup at `nowMs`. */
export function isArchiveExpired(
  archivedAtMs: number,
  retention: ArchiveRetention,
  nowMs: number = Date.now(),
): boolean {
  if (retention === "forever") return false;
  if (!Number.isFinite(archivedAtMs)) return false;
  if (retention === "immediate") return true;
  const deleteAfter = getArchiveDeleteAfter(archivedAtMs, retention);
  return deleteAfter !== null && nowMs >= deleteAfter;
}

/** Parse an `archivedAt` ISO string to epoch ms (NaN when missing/invalid). */
export function parseArchivedAtMs(archivedAt: string | null | undefined): number {
  if (!archivedAt) return NaN;
  return Date.parse(archivedAt);
}

export interface ArchiveAutoDeleteLabel {
  /** e.g. "5 天后自动删除" / "已到期，待清理" / "永不自动删除". */
  text: string;
  /** Absolute delete time, null when never. */
  deleteAfter: number | null;
  expired: boolean;
}

/** UI label for the archive list. Pure and locale-light (zh default). */
export function formatArchiveAutoDelete(
  archivedAtMs: number,
  retention: ArchiveRetention,
  nowMs: number = Date.now(),
): ArchiveAutoDeleteLabel {
  const deleteAfter = getArchiveDeleteAfter(archivedAtMs, retention);
  if (deleteAfter === null) {
    return { text: "永不自动删除", deleteAfter: null, expired: false };
  }
  if (nowMs >= deleteAfter) {
    return { text: "已到期，待清理", deleteAfter, expired: true };
  }
  const remainingMs = deleteAfter - nowMs;
  const remainingDays = Math.ceil(remainingMs / DAY_MS);
  const date = new Date(deleteAfter);
  const dateStr = `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  if (remainingDays <= 0) {
    const remainingHours = Math.max(1, Math.ceil(remainingMs / (60 * 60 * 1000)));
    return { text: `${remainingHours} 小时后自动删除`, deleteAfter, expired: false };
  }
  if (remainingDays === 1) {
    return { text: `1 天后自动删除（${dateStr}）`, deleteAfter, expired: false };
  }
  return { text: `${remainingDays} 天后自动删除（${dateStr}）`, deleteAfter, expired: false };
}
