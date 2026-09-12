import { describe, expect, it } from "vitest";
import {
  DEFAULT_ARCHIVE_RETENTION,
  formatArchiveAutoDelete,
  getArchiveDeleteAfter,
  isArchiveExpired,
  normalizeArchiveRetention,
} from "./archiveRetention";

describe("archiveRetention", () => {
  it("defaults fresh profiles to 7d", () => {
    expect(DEFAULT_ARCHIVE_RETENTION).toBe("7d");
    expect(normalizeArchiveRetention(undefined)).toBe("7d");
    expect(normalizeArchiveRetention("bogus")).toBe("7d");
  });

  it("computes deleteAfter strictly from archivedAt", () => {
    const archivedAt = Date.parse("2026-09-05T10:00:00.000Z");
    const deleteAfter = getArchiveDeleteAfter(archivedAt, "7d");
    expect(deleteAfter).toBe(archivedAt + 7 * 24 * 60 * 60 * 1000);
    expect(getArchiveDeleteAfter(archivedAt, "forever")).toBeNull();
    expect(getArchiveDeleteAfter(archivedAt, "immediate")).toBe(archivedAt);
  });

  it("expires 3/7/15/30d with a deterministic clock", () => {
    const archivedAt = 1_000;
    const day = 24 * 60 * 60 * 1000;
    expect(isArchiveExpired(archivedAt, "3d", archivedAt + 3 * day)).toBe(true);
    expect(isArchiveExpired(archivedAt, "3d", archivedAt + 3 * day - 1)).toBe(false);
    expect(isArchiveExpired(archivedAt, "7d", archivedAt + 7 * day)).toBe(true);
    expect(isArchiveExpired(archivedAt, "15d", archivedAt + 15 * day)).toBe(true);
    expect(isArchiveExpired(archivedAt, "30d", archivedAt + 30 * day - 1)).toBe(false);
  });

  it("immediate expires at once; forever never expires", () => {
    expect(isArchiveExpired(Date.now(), "immediate", Date.now())).toBe(true);
    expect(isArchiveExpired(0, "forever", Date.now())).toBe(false);
  });

  it("re-evaluates old archives when the policy changes (no clock restart)", () => {
    const archivedAt = 0;
    const day = 24 * 60 * 60 * 1000;
    // Archived 10 days ago under 30d: not expired…
    expect(isArchiveExpired(archivedAt, "30d", 10 * day)).toBe(false);
    // …but switching to 7d/3d expires it immediately from the same archivedAt.
    expect(isArchiveExpired(archivedAt, "7d", 10 * day)).toBe(true);
    expect(isArchiveExpired(archivedAt, "3d", 10 * day)).toBe(true);
  });

  it("labels auto-delete time for the archive list", () => {
    const archivedAt = Date.parse("2026-09-05T10:00:00.000Z");
    const label = formatArchiveAutoDelete(archivedAt, "7d", archivedAt + 2 * 24 * 60 * 60 * 1000);
    expect(label.text).toContain("5 天后自动删除");
    expect(formatArchiveAutoDelete(archivedAt, "forever", archivedAt).text).toBe("永不自动删除");
    expect(formatArchiveAutoDelete(archivedAt, "7d", archivedAt + 8 * 24 * 60 * 60 * 1000).expired).toBe(true);
  });
});
