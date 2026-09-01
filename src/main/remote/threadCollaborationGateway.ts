import { toRemoteThreadExchangeSummary } from "@/shared/remote";
import type { ThreadCollaborationService } from "../thread-collaboration";
import { RemoteHttpError } from "./auth";
import type { RemoteAccessServerOptions } from "./RemoteAccessServer";

export function createRemoteThreadCollaborationGateway(
  getService: () => ThreadCollaborationService | null,
): NonNullable<RemoteAccessServerOptions["threadCollaboration"]> {
  const requireService = (): ThreadCollaborationService => {
    const service = getService();
    if (!service) {
      throw new RemoteHttpError(
        "thread_collaboration_unavailable",
        "Thread collaboration is not available on this host.",
        503,
      );
    }
    return service;
  };

  return {
    listTargets: (sourceThreadId, query) => requireService().listTargets(sourceThreadId, query),
    request: (actorThreadId, request) =>
      requireService().requestDialogue({ actorThreadId, request }),
    list: (actorThreadId, threadId, limit) =>
      requireService().listExchanges(actorThreadId, threadId, limit),
    read: (actorThreadId, exchangeId) => requireService().readExchange(actorThreadId, exchangeId),
    wait: (actorThreadId, exchangeId, afterUpdatedAt, timeoutMs) =>
      requireService().waitForExchange(actorThreadId, exchangeId, afterUpdatedAt, timeoutMs),
    cancel: (actorThreadId, exchangeId) =>
      requireService().cancelExchange(actorThreadId, exchangeId),
    summarize: toRemoteThreadExchangeSummary,
  };
}
