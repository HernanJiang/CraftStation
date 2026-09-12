import type { ProjectLocation, Project, Thread } from "@/shared/contracts";
import * as schema from "../db.schema";
import { compositionProvenanceSchema } from "@/shared/crafting/types";
import { accountBindingSchema } from "@/shared/contracts/accountBinding";
import { threadGoalSchema } from "@/shared/contracts/thread";

// ── Converters ──────────────────────────────────────────────────────

export function locationToRow(loc: ProjectLocation) {
  return {
    locationKind: loc.kind,
    locationPath: loc.kind !== "wsl" ? loc.path : null,
    locationDistro: loc.kind === "wsl" ? loc.distro : null,
    locationLinuxPath: loc.kind === "wsl" ? loc.linuxPath : null,
    locationUncPath: loc.kind === "wsl" ? loc.uncPath : null,
  };
}

export function projectMutableRow(project: Project) {
  return {
    name: project.name,
    icon: project.icon ?? null,
    ...locationToRow(project.location),
    lastDraftConfig: project.lastDraftConfig ? JSON.stringify(project.lastDraftConfig) : null,
    scripts: project.scripts ? JSON.stringify(project.scripts) : null,
    searchSettings: project.searchSettings ? JSON.stringify(project.searchSettings) : null,
    worktreeLocation: project.worktreeLocation ? JSON.stringify(project.worktreeLocation) : null,
    mcpServers: project.mcpServers ? JSON.stringify(project.mcpServers) : null,
    ghAccount: project.ghAccount ? JSON.stringify(project.ghAccount) : null,
    workspaceId: project.workspaceId ?? null,
    disabled: !!project.disabled,
  };
}

function rowToLocation(row: {
  locationKind: string;
  locationPath: string | null;
  locationDistro: string | null;
  locationLinuxPath: string | null;
  locationUncPath: string | null;
}): ProjectLocation {
  if (row.locationKind === "wsl") {
    return {
      kind: "wsl",
      distro: row.locationDistro!,
      linuxPath: row.locationLinuxPath!,
      uncPath: row.locationUncPath!,
    };
  }
  if (row.locationKind === "posix") {
    return { kind: "posix", path: row.locationPath! };
  }
  return { kind: "windows", path: row.locationPath! };
}

export function rowToProject(row: typeof schema.projects.$inferSelect): Project {
  return {
    id: row.id,
    name: row.name,
    ...(row.icon ? { icon: row.icon } : {}),
    location: rowToLocation(row),
    ...(row.lastDraftConfig ? { lastDraftConfig: JSON.parse(row.lastDraftConfig) } : {}),
    ...(row.scripts ? { scripts: JSON.parse(row.scripts) } : {}),
    ...(row.searchSettings ? { searchSettings: JSON.parse(row.searchSettings) } : {}),
    ...(row.worktreeLocation ? { worktreeLocation: JSON.parse(row.worktreeLocation) } : {}),
    ...(row.mcpServers ? { mcpServers: JSON.parse(row.mcpServers) } : {}),
    ...(row.ghAccount ? { ghAccount: JSON.parse(row.ghAccount) } : {}),
    ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
    ...(row.disabled ? { disabled: true } : {}),
    createdAt: row.createdAt,
  };
}

export function rowToThread(row: typeof schema.threads.$inferSelect): Thread {
  const parsedCompositionProvenance = row.compositionProvenance
    ? compositionProvenanceSchema.safeParse(safeParse(row.compositionProvenance))
    : undefined;
  const parsedAccountBinding = row.accountBinding
    ? accountBindingSchema.safeParse(safeParse(row.accountBinding))
    : undefined;
  const parsedGoal = row.goal ? threadGoalSchema.safeParse(safeParse(row.goal)) : undefined;
  // One-time legacy migration (idempotent): pre-pinnedAt starred rows and
  // pre-archivedAt archived rows backfill from updatedAt so no user pin or
  // archive timestamp is lost. New writes stamp both fields directly.
  const migratedPinnedAt =
    row.pinnedAt != null ? row.pinnedAt : row.starred ? Date.parse(row.updatedAt) : null;
  const migratedArchivedAt = row.archivedAt ?? (row.archived ? row.updatedAt : undefined);
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    agentKind: row.agentKind as Thread["agentKind"],
    ...(row.agentInstanceId ? { agentInstanceId: row.agentInstanceId } : {}),
    config: JSON.parse(row.config),
    status: row.status as Thread["status"],
    attention: row.attention as Thread["attention"],
    ...(row.threadStatusSource
      ? { threadStatusSource: row.threadStatusSource as Thread["threadStatusSource"] }
      : {}),
    canResumeWithConfig: row.canResumeWithConfig,
    ...(row.sessionRef ? { sessionRef: JSON.parse(row.sessionRef) } : {}),
    ...(parsedCompositionProvenance?.success
      ? { compositionProvenance: parsedCompositionProvenance.data }
      : {}),
    ...(parsedAccountBinding?.success ? { accountBinding: parsedAccountBinding.data } : {}),
    ...(row.worktreePath ? { worktreePath: row.worktreePath } : {}),
    ...(row.worktreeBranch ? { worktreeBranch: row.worktreeBranch } : {}),
    ...(row.prNumber != null ? { prNumber: row.prNumber } : {}),
    ...(row.groupId ? { groupId: row.groupId } : {}),
    ...(row.groupName ? { groupName: row.groupName } : {}),
    ...(row.parentThreadId ? { parentThreadId: row.parentThreadId } : {}),
    ...(parsedGoal?.success ? { goal: parsedGoal.data } : {}),
    archived: row.archived,
    ...(migratedArchivedAt ? { archivedAt: migratedArchivedAt } : {}),
    done: row.done,
    ...(row.doneAt ? { doneAt: row.doneAt } : {}),
    starred: row.starred,
    ...(migratedPinnedAt != null && Number.isFinite(migratedPinnedAt)
      ? { pinnedAt: migratedPinnedAt }
      : {}),
    presentationMode: (row.presentationMode === "gui"
      ? "gui"
      : "terminal") as Thread["presentationMode"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.activeTurnStartedAt ? { activeTurnStartedAt: row.activeTurnStartedAt } : {}),
    ...(row.lastTurnStartedAt ? { lastTurnStartedAt: row.lastTurnStartedAt } : {}),
    ...(row.lastTurnEndedAt ? { lastTurnEndedAt: row.lastTurnEndedAt } : {}),
  };
}

export function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}
