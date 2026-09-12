/**
 * Global sidebar ordering: Pinned > Projects > Home.
 *
 * Pure, UI-framework-free ordering helpers shared by the desktop sidebar and
 * any future surface. Pin only changes presentation priority — it never
 * rewrites `projectId` / workspace identity.
 *
 * Legacy: threads historically used boolean `starred` (section-local pin) and
 * projects used `pinnedProjectIds: string[]` in localStorage. Both migrate to
 * timestamp pins (`pinnedAt`) so multiple pins order stably by pin time.
 */

export interface PinnableThreadLike {
  id: string;
  projectId: string;
  /** New stable pin time (epoch ms). Null/undefined = not pinned. */
  pinnedAt?: number | null | undefined;
  /** Legacy boolean pin. Honoured only when `pinnedAt` is absent. */
  starred?: boolean | undefined;
  updatedAt?: string | undefined;
}

export interface PinnableProjectLike {
  id: string;
  pinnedAt?: number | null | undefined;
}

/** Effective pin timestamp, or null when not pinned. */
export function threadPinTime(thread: PinnableThreadLike): number | null {
  if (typeof thread.pinnedAt === "number" && Number.isFinite(thread.pinnedAt)) {
    return thread.pinnedAt;
  }
  // Legacy `starred` without a timestamp still counts as pinned (migration on
  // load backfills a real `pinnedAt`; 0 keeps it visible meanwhile).
  if (thread.starred === true) return 0;
  return null;
}

export function projectPinTime(
  project: PinnableProjectLike,
  pinnedProjectIds?: readonly string[] | undefined,
  pinnedProjectAt?: Readonly<Record<string, number>> | undefined,
): number | null {
  const stamped = pinnedProjectAt?.[project.id];
  if (typeof stamped === "number" && Number.isFinite(stamped)) return stamped;
  if (typeof project.pinnedAt === "number" && Number.isFinite(project.pinnedAt)) {
    return project.pinnedAt;
  }
  if (pinnedProjectIds?.includes(project.id)) return 0;
  return null;
}

export function isThreadGloballyPinned(thread: PinnableThreadLike): boolean {
  return threadPinTime(thread) !== null;
}

export interface GlobalPinPartition<TThread extends PinnableThreadLike, TProject extends PinnableProjectLike> {
  pinnedThreads: TThread[];
  pinnedProjects: TProject[];
  unpinnedThreads: TThread[];
  unpinnedProjects: TProject[];
}

/**
 * Split threads/projects into the global-pin section vs their natural
 * sections. Pinned lists sort by pin time ascending (oldest pin first, stable
 * by id). Unpinned lists keep their input order.
 */
export function partitionGlobalPins<TThread extends PinnableThreadLike, TProject extends PinnableProjectLike>(
  threads: readonly TThread[],
  projects: readonly TProject[],
  options?: {
    pinnedProjectIds?: readonly string[] | undefined;
    pinnedProjectAt?: Readonly<Record<string, number>> | undefined;
  },
): GlobalPinPartition<TThread, TProject> {
  const pinnedThreads: TThread[] = [];
  const unpinnedThreads: TThread[] = [];
  for (const thread of threads) {
    if (isThreadGloballyPinned(thread)) pinnedThreads.push(thread);
    else unpinnedThreads.push(thread);
  }
  const pinnedProjects: TProject[] = [];
  const unpinnedProjects: TProject[] = [];
  for (const project of projects) {
    if (projectPinTime(project, options?.pinnedProjectIds, options?.pinnedProjectAt) !== null) {
      pinnedProjects.push(project);
    } else {
      unpinnedProjects.push(project);
    }
  }
  const byPinTime = (aTime: number | null, bTime: number | null, aId: string, bId: string): number => {
    const diff = (aTime ?? 0) - (bTime ?? 0);
    if (diff !== 0) return diff;
    return aId.localeCompare(bId);
  };
  pinnedThreads.sort((a, b) => byPinTime(threadPinTime(a), threadPinTime(b), a.id, b.id));
  pinnedProjects.sort((a, b) =>
    byPinTime(
      projectPinTime(a, options?.pinnedProjectIds, options?.pinnedProjectAt),
      projectPinTime(b, options?.pinnedProjectIds, options?.pinnedProjectAt),
      a.id,
      b.id,
    ),
  );
  return { pinnedThreads, pinnedProjects, unpinnedThreads, unpinnedProjects };
}

/**
 * Migrate a legacy boolean pin to a timestamp pin without losing the user's
 * existing pins. Returns the pin time to persist, or null when unpinned.
 */
export function migrateThreadPinToTimestamp(input: {
  starred?: boolean | undefined;
  pinnedAt?: number | null | undefined;
  updatedAt?: string | undefined;
  now?: number | undefined;
}): number | null {
  if (typeof input.pinnedAt === "number" && Number.isFinite(input.pinnedAt)) return input.pinnedAt;
  if (input.starred === true) {
    if (input.updatedAt) {
      const parsed = Date.parse(input.updatedAt);
      if (Number.isFinite(parsed)) return parsed;
    }
    return input.now ?? Date.now();
  }
  return null;
}

/** Migrate legacy `pinnedProjectIds` to a timestamp map (pin order = array order). */
export function migrateProjectPinsToTimestamps(
  pinnedProjectIds: readonly string[],
  existing?: Readonly<Record<string, number>> | undefined,
  now?: number | undefined,
): Record<string, number> {
  const next: Record<string, number> = { ...(existing ?? {}) };
  const base = now ?? Date.now();
  pinnedProjectIds.forEach((id, index) => {
    if (typeof next[id] !== "number") next[id] = base + index;
  });
  // Drop entries for unpinned projects.
  for (const id of Object.keys(next)) {
    if (!pinnedProjectIds.includes(id)) delete next[id];
  }
  return next;
}

/**
 * Order project ids for the sidebar: pinned projects first (by pin time),
 * then the rest in store order (stable). Home is never pinned by construction
 * (its section has no pin menu) but callers may pass it through safely.
 */
export function orderProjectIdsPinnedFirst(
  projectIds: readonly string[],
  pinnedProjectIds?: readonly string[] | undefined,
  pinnedProjectAt?: Readonly<Record<string, number>> | undefined,
): string[] {
  return [...projectIds].sort((a, b) => {
    const aPin = projectPinTime({ id: a }, pinnedProjectIds, pinnedProjectAt);
    const bPin = projectPinTime({ id: b }, pinnedProjectIds, pinnedProjectAt);
    if (aPin === null && bPin === null) return 0;
    if (aPin === null) return 1;
    if (bPin === null) return -1;
    return aPin - bPin;
  });
}
