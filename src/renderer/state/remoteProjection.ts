import type { Project, Thread } from "@/shared/contracts";
import type {
  RemoteShellSnapshot,
  RemoteThreadExchangeSummary,
  RemoteThreadSnapshot,
} from "@/shared/remote";
import type { ThreadRuntimeProvenance, ThreadTargetSummary } from "@/shared/threadCollaboration";

interface RemotelyProjectedEntity {
  readonly remoteServerId?: string | undefined;
  readonly remoteId?: string | undefined;
}

export interface RemoteOwner {
  readonly desktopId: string;
  readonly remoteId: string;
}

/** Resolve the host identity shared by projected projects and threads. */
export function remoteOwner(
  entity: RemotelyProjectedEntity | null | undefined,
): RemoteOwner | undefined {
  return entity?.remoteServerId && entity.remoteId
    ? { desktopId: entity.remoteServerId, remoteId: entity.remoteId }
    : undefined;
}

export function remoteProjectId(remoteServerId: string, remoteId: string): string {
  return `remote:${remoteServerId}:project:${remoteId}`;
}

export function remoteThreadId(remoteServerId: string, remoteId: string): string {
  return `remote:${remoteServerId}:thread:${remoteId}`;
}

export type RemoteScopedIdentityKind =
  | "exchange"
  | "link"
  | "recipe"
  | "craft-plan"
  | "entity"
  | "session"
  | "segment";

export function remoteScopedId(
  remoteServerId: string,
  kind: RemoteScopedIdentityKind,
  remoteId: string,
): string {
  return `remote:${remoteServerId}:${kind}:${remoteId}`;
}

export function unprojectRemoteScopedId(
  value: string,
  remoteServerId: string,
  kind: RemoteScopedIdentityKind,
): string | undefined {
  const prefix = `remote:${remoteServerId}:${kind}:`;
  return value.startsWith(prefix) && value.length > prefix.length
    ? value.slice(prefix.length)
    : undefined;
}

export function isProjectedRemoteEntityId(value: string, kind: "project" | "thread"): boolean {
  const marker = `:${kind}:`;
  const markerIndex = value.indexOf(marker, "remote:".length);
  return (
    value.startsWith("remote:") &&
    markerIndex > "remote:".length &&
    markerIndex + marker.length < value.length
  );
}

export function projectRemoteProject(remoteServerId: string, project: Project): Project {
  return {
    ...project,
    id: remoteProjectId(remoteServerId, project.id),
    remoteServerId,
    remoteId: project.id,
    location: { ...project.location, remoteServerId },
  };
}

export function projectRemoteThread(remoteServerId: string, thread: Thread): Thread {
  return {
    ...thread,
    id: remoteThreadId(remoteServerId, thread.id),
    remoteServerId,
    remoteId: thread.id,
    projectId: remoteProjectId(remoteServerId, thread.projectId),
    ...(thread.parentThreadId
      ? { parentThreadId: remoteThreadId(remoteServerId, thread.parentThreadId) }
      : {}),
  };
}

export function projectRemoteThreadProvenance(
  remoteServerId: string,
  provenance: ThreadRuntimeProvenance,
): ThreadRuntimeProvenance {
  return {
    ...provenance,
    threadId: remoteThreadId(remoteServerId, provenance.threadId),
    projectId: remoteProjectId(remoteServerId, provenance.projectId),
    ...(provenance.recipeId
      ? { recipeId: remoteScopedId(remoteServerId, "recipe", provenance.recipeId) }
      : {}),
    ...(provenance.craftPlanId
      ? { craftPlanId: remoteScopedId(remoteServerId, "craft-plan", provenance.craftPlanId) }
      : {}),
    ...(provenance.entityId
      ? { entityId: remoteScopedId(remoteServerId, "entity", provenance.entityId) }
      : {}),
    ...(provenance.nativeSessionId
      ? { nativeSessionId: remoteScopedId(remoteServerId, "session", provenance.nativeSessionId) }
      : {}),
    ...(provenance.segmentId
      ? { segmentId: remoteScopedId(remoteServerId, "segment", provenance.segmentId) }
      : {}),
  };
}

export function projectRemoteThreadTargetSummary(
  remoteServerId: string,
  target: ThreadTargetSummary,
): ThreadTargetSummary {
  return {
    ...target,
    threadId: remoteThreadId(remoteServerId, target.threadId),
    projectId: remoteProjectId(remoteServerId, target.projectId),
    provenance: projectRemoteThreadProvenance(remoteServerId, target.provenance),
  };
}

export function projectRemoteThreadExchange(
  remoteServerId: string,
  exchange: RemoteThreadExchangeSummary,
): RemoteThreadExchangeSummary {
  return {
    ...exchange,
    id: remoteScopedId(remoteServerId, "exchange", exchange.id),
    linkId: remoteScopedId(remoteServerId, "link", exchange.linkId),
    projectId: remoteProjectId(remoteServerId, exchange.projectId),
    sourceThreadId: remoteThreadId(remoteServerId, exchange.sourceThreadId),
    targetThreadId: remoteThreadId(remoteServerId, exchange.targetThreadId),
    sourceProvenance: projectRemoteThreadProvenance(remoteServerId, exchange.sourceProvenance),
    targetProvenance: projectRemoteThreadProvenance(remoteServerId, exchange.targetProvenance),
    ...(exchange.causalParentExchangeId
      ? {
          causalParentExchangeId: remoteScopedId(
            remoteServerId,
            "exchange",
            exchange.causalParentExchangeId,
          ),
        }
      : {}),
  };
}

export function projectRemoteCollaborationMap(
  remoteServerId: string,
  exchangesByThread: NonNullable<RemoteShellSnapshot["collaborationExchangesByThread"]>,
): NonNullable<RemoteShellSnapshot["collaborationExchangesByThread"]> {
  return Object.fromEntries(
    Object.entries(exchangesByThread).map(([threadId, exchanges]) => [
      remoteThreadId(remoteServerId, threadId),
      exchanges.map((exchange) => projectRemoteThreadExchange(remoteServerId, exchange)),
    ]),
  );
}

export function projectRemoteThreadSnapshot(
  remoteServerId: string,
  snapshot: RemoteThreadSnapshot,
): RemoteThreadSnapshot {
  return {
    ...snapshot,
    thread: projectRemoteThread(remoteServerId, snapshot.thread),
    ...(snapshot.collaborationExchanges
      ? {
          collaborationExchanges: snapshot.collaborationExchanges.map((exchange) =>
            projectRemoteThreadExchange(remoteServerId, exchange),
          ),
        }
      : {}),
  };
}

export function projectRemoteThreadEvent(remoteServerId: string, value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const event = value as Record<string, unknown>;
  if (event.type === "remote-thread-collaboration-changed" && Array.isArray(event.exchanges)) {
    return {
      ...event,
      exchanges: event.exchanges.map((exchange) =>
        projectRemoteThreadExchange(remoteServerId, exchange as RemoteThreadExchangeSummary),
      ),
    };
  }
  if (event.type === "thread-runtime-events-multi" && Array.isArray(event.batches)) {
    return {
      ...event,
      batches: event.batches.map((batch) => {
        if (!batch || typeof batch !== "object") return batch;
        const record = batch as Record<string, unknown>;
        return typeof record.threadId === "string"
          ? { ...record, threadId: remoteThreadId(remoteServerId, record.threadId) }
          : record;
      }),
    };
  }
  return typeof event.threadId === "string"
    ? { ...event, threadId: remoteThreadId(remoteServerId, event.threadId) }
    : event;
}
