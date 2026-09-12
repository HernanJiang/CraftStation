import { randomUUID } from "node:crypto";
import type { AgentKind, ProjectLocation, Thread } from "@/shared/contracts";
import type {
  NativeThreadPeer,
} from "@/shared/nativeThreads";
import {
  formatNativeAddress,
  parseNativeAddress,
} from "@/shared/nativeThreads";
import type { ThreadDialogueRequest, ThreadExchange } from "@/shared/threadCollaboration";
import type { ThreadCollaborationService } from "../thread-collaboration/ThreadCollaborationService";
import type { ThreadControlAdapter } from "../thread-collaboration/ThreadControlAdapter";
import type {
  CreateAppThreadRequest,
  CreateAppThreadResult,
} from "../threads/appThreadLauncher";
import { dbDeleteThread, dbGetThreads, dbUpsertThread } from "../db/projectsThreads";
import { sortOrderForThread } from "../remote/server/snapshots";
import {
  assertKnownHarness,
  deleteNativeBinding,
  deleteNativeBindingsForThread,
  discoverCodexThreads,
  getNativeBinding,
  inferNativeHarnessFromModel,
  putNativeBinding,
  resolveWorkspace,
} from "./nativeThreadIndex";

/**
 * Thin inter-harness message bus over the existing durable thread-dialogue
 * ledger (ThreadCollaborationService + thread_exchanges outbox).
 *
 * This class owns NO agent loop, NO transport, and NO second truth:
 * - identity/addressing/workspace scope → NativeThreadIndex (+ bindings table)
 * - persistence/claims/correlation/recovery → ThreadCollaborationService
 * - resume + native send → Supervisor via ThreadControlAdapter
 *
 * agent-bus mapping: peer registry → listPeers + bindings; message store →
 * thread_exchanges; ask/reply → requestDialogue + waitForExchange +
 * captureReply; inbox → listExchanges; offline delivery → queued status +
 * service.recover(); wake-up → Supervisor resume (never terminal injection).
 */
export interface InterHarnessMessageBusDeps {
  collaboration: ThreadCollaborationService;
  control: ThreadControlAdapter;
  getProjectLocation(projectId: string): ProjectLocation | null;
  listProjectLocations(): Array<{ projectId: string; location: ProjectLocation }>;
  mirrorThreadToRenderer(thread: Thread): void;
  mirrorThreadDeletion(threadId: string): void;
  /** Create + launch a real first-class native thread (row, mirror, runtime). */
  createThread(request: CreateAppThreadRequest): Promise<CreateAppThreadResult>;
  extraCodexHomes?: readonly string[];
  now?: () => Date;
  newId?: () => string;
  /** Bound on waiting for a fresh native session id after spawn (ms). */
  spawnSessionTimeoutMs?: number;
}

export interface ClaimPeerResult {
  threadId: string;
  address: string;
  created: boolean;
}

const CLAIM_MODEL_PLACEHOLDER = "unknown";

export class InterHarnessMessageBus {
  constructor(private readonly deps: InterHarnessMessageBusDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private newId(): string {
    return this.deps.newId?.() ?? randomUUID();
  }

  /** Workspace peer scope: bound threads + discovered external natives. */
  listPeers(sourceThreadId: string, query?: string): NativeThreadPeer[] {
    const source = this.deps.control.require(sourceThreadId);
    const sourceWorkspace = this.workspaceOfThread(source);
    const needle = query?.trim().toLocaleLowerCase();
    const peers = new Map<string, NativeThreadPeer>();

    for (const thread of this.deps.control.list()) {
      if (thread.id === source.id || thread.projectId !== source.projectId) continue;
      const address = this.addressOfThread(thread);
      if (!address) continue;
      const snapshot = this.deps.control.snapshot(thread.id);
      const peerWorkspace = this.workspaceOfThread(thread) ?? sourceWorkspace ?? thread.projectId;
      peers.set(address.address, {
        address: address.address,
        harness: address.harness,
        nativeId: address.nativeId,
        workspace: peerWorkspace,
        title: thread.title,
        origin: "craftstation",
        boundThreadId: thread.id,
        status: snapshot.status === "working" ? "busy" : snapshot.live ? "online" : "offline",
      });
    }

    if (sourceWorkspace) {
      const discoveryOptions: { workspace: string; extraHomes?: readonly string[] } = {
        workspace: sourceWorkspace,
      };
      if (this.deps.extraCodexHomes) discoveryOptions.extraHomes = this.deps.extraCodexHomes;
      for (const discovered of discoverCodexThreads(discoveryOptions)) {
        if (peers.has(discovered.address)) continue;
        const binding = getNativeBinding(discovered.address);
        if (binding) continue;
        peers.set(discovered.address, {
          address: discovered.address,
          harness: discovered.harness,
          nativeId: discovered.nativeId,
          workspace: sourceWorkspace,
          title: discovered.title,
          origin: "external",
          status: "unknown",
          ...(discovered.updatedAt !== undefined ? { updatedAt: discovered.updatedAt } : {}),
        });
      }
    }

    const out = [...peers.values()];
    out.sort((a, b) => {
      if (a.status === b.status) return a.title.localeCompare(b.title);
      const rank = (status: NativeThreadPeer["status"]): number =>
        status === "online" ? 0 : status === "busy" ? 1 : status === "offline" ? 2 : 3;
      return rank(a.status) - rank(b.status);
    });
    if (!needle) return out;
    return out.filter((peer) =>
      [peer.title, peer.harness, peer.nativeId, peer.address, peer.status].some((value) =>
        value.toLocaleLowerCase().includes(needle),
      ),
    );
  }

  /**
   * Bind an external native thread to a CraftStation thread row WITHOUT
   * copying messages and WITHOUT creating a new native session. The row is
   * status-inactive with the real native sessionRef, so later delivery
   * resumes exactly that native thread (never a duplicate).
   */
  claimPeer(address: string, projectId: string): ClaimPeerResult {
    const { harness, nativeId } = parseNativeAddress(address);
    assertKnownHarness(harness);
    const existing = getNativeBinding(address);
    if (existing) return { threadId: existing.threadId, address, created: false };

    const projectLocation = this.deps.getProjectLocation(projectId);
    if (!projectLocation) {
      throw new Error(`Cannot claim ${address}: project ${projectId} no longer exists.`);
    }
    const threadId = `native-${harness}-${nativeId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
    if (this.threadRowExists(threadId)) {
      throw new Error(
        `Cannot claim ${address}: thread row ${threadId} already exists for another binding.`,
      );
    }
    const stamp = this.now().toISOString();
    const thread: Thread = {
      id: threadId,
      projectId,
      title: `${harness}:${nativeId}`,
      agentKind: harness,
      config: { model: CLAIM_MODEL_PLACEHOLDER },
      status: "inactive",
      attention: "none",
      canResumeWithConfig: false,
      sessionRef: { providerSessionId: nativeId, discoveredAt: stamp },
      archived: false,
      done: false,
      starred: false,
      presentationMode: "gui",
      createdAt: stamp,
      updatedAt: stamp,
    };
    dbUpsertThread(thread, 0);
    putNativeBinding({
      address,
      threadId,
      workspace: locationPath(projectLocation),
      origin: "external",
      boundAt: stamp,
    });
    this.deps.mirrorThreadToRenderer(thread);
    return { threadId, address, created: true };
  }

  /** Resolve an address to its bound thread, auto-claiming external peers. */
  resolveAddress(address: string, sourceProjectId: string): { threadId: string } {
    const bound = getNativeBinding(address);
    if (bound && this.threadRowExists(bound.threadId)) return { threadId: bound.threadId };
    if (bound) deleteNativeBinding(address);
    // Never duplicate a row for an already-known thread: match the
    // synthesized address first (Test E), recording the binding so the next
    // lookup is a fast path.
    for (const thread of this.deps.control.list()) {
      const candidate = this.addressOfThread(thread);
      if (candidate?.address !== address) continue;
      const workspace = this.workspaceOfThread(thread);
      if (workspace) {
        putNativeBinding({
          address,
          threadId: thread.id,
          workspace,
          origin: "craftstation",
          boundAt: this.now().toISOString(),
        });
      }
      return { threadId: thread.id };
    }
    const projectId = this.projectForAddress(address, sourceProjectId);
    return { threadId: this.claimPeer(address, projectId).threadId };
  }

  /**
   * Spawn a REAL long-lived native thread: full Thread row, renderer mirror
   * (sidebar-visible), and an official supervisor-launched native session —
   * then bind its discovered native session id as a peer address. Never
   * fabricates a session id: the address comes from the live runtime snapshot.
   */
  async spawnPeer(
    sourceThreadId: string,
    input: {
      harness?: string;
      model: string;
      title?: string;
      message: string;
      effort?: string;
      fast?: boolean;
    },
  ): Promise<{ address: string; threadId: string; title: string; nativeSessionId: string }> {
    const source = this.requireSource(sourceThreadId);
    const harness = (
      input.harness?.trim().toLowerCase() ||
      inferNativeHarnessFromModel(input.model) ||
      source.agentKind
    ).trim();
    assertKnownHarness(harness);
    const created = await this.deps.createThread({
      projectId: source.projectId,
      prompt: input.message,
      agentKind: harness as AgentKind,
      model: input.model,
      ...(input.effort ? { effort: input.effort } : {}),
      ...(input.fast !== undefined ? { fast: input.fast } : {}),
      ...(input.title?.trim() ? { title: input.title.trim() } : {}),
    });
    const nativeSessionId = await this.awaitNativeSessionId(created.threadId);
    const address = formatNativeAddress(harness, nativeSessionId);
    const workspace = this.workspaceOfThread(this.deps.control.require(created.threadId));
    if (workspace) {
      putNativeBinding({
        address,
        threadId: created.threadId,
        workspace,
        origin: "craftstation",
        boundAt: this.now().toISOString(),
      });
    }
    return {
      address,
      threadId: created.threadId,
      title: created.title,
      nativeSessionId,
    };
  }

  /**
   * Switch a peer thread's model. Same-harness updates the live session
   * config and persisted row. Cross-harness prepares a NEW native runtime
   * first, then commits agentKind + model + sessionRef together so the UI
   * cannot show Gemini while Grok is still executing. Failure leaves the
   * original runtime and row untouched.
   */
  async switchPeerModel(
    sourceThreadId: string,
    address: string,
    model: string,
  ): Promise<{
    threadId: string;
    address: string;
    previousModel: string;
    previousHarness: string;
    model: string;
    harness: string;
    nativeSessionId: string | null;
    switched: boolean;
  }> {
    const source = this.requireSource(sourceThreadId);
    const { threadId } = this.resolveAddress(address, source.projectId);
    const row = this.deps.control.require(threadId);
    if (row.projectId !== source.projectId) {
      throw new Error(`Peer ${address} is outside this workspace scope.`);
    }
    const previousModel = row.config.model;
    const previousHarness = row.agentKind;
    const inferredHarness = inferNativeHarnessFromModel(model);
    const harness = inferredHarness ?? row.agentKind;
    assertKnownHarness(harness);
    const nextConfig = { ...row.config, model };
    const stamp = this.now().toISOString();

    if (harness !== row.agentKind) {
      const switched = await this.deps.control.switchProvider(
        threadId,
        harness as AgentKind,
        nextConfig,
      );
      const nativeSessionId = switched.sessionRef?.providerSessionId ?? null;
      const { sessionRef: _previousNativeSession, ...stableRow } = row;
      const updated: Thread = {
        ...stableRow,
        agentKind: harness as AgentKind,
        config: nextConfig,
        updatedAt: stamp,
        canResumeWithConfig: switched.canResumeWithConfig,
        ...(switched.sessionRef ? { sessionRef: switched.sessionRef } : {}),
      };
      dbUpsertThread(updated, sortOrderForThread(dbGetThreads(), threadId));
      const workspace = this.workspaceOfThread(updated);
      deleteNativeBindingsForThread(threadId);
      if (workspace && nativeSessionId) {
        const nextAddress = formatNativeAddress(harness, nativeSessionId);
        putNativeBinding({
          address: nextAddress,
          threadId,
          workspace,
          origin: "craftstation",
          boundAt: stamp,
        });
      }
      this.deps.mirrorThreadToRenderer(updated);
      return {
        threadId,
        address: nativeSessionId ? formatNativeAddress(harness, nativeSessionId) : address,
        previousModel,
        previousHarness,
        model,
        harness,
        nativeSessionId,
        switched: true,
      };
    }

    try {
      await this.deps.control.switchProvider(threadId, row.agentKind, nextConfig);
    } catch {
      // No live session or crafted-only path: the persisted row is still the
      // source of truth for the next delivery/resume on this harness.
    }
    const nativeSessionId = row.sessionRef?.providerSessionId ?? null;
    const updated: Thread = { ...row, config: nextConfig, updatedAt: stamp };
    dbUpsertThread(updated, sortOrderForThread(dbGetThreads(), threadId));
    this.deps.mirrorThreadToRenderer(updated);
    return {
      threadId,
      address,
      previousModel,
      previousHarness,
      model,
      harness,
      nativeSessionId,
      switched: previousModel !== model,
    };
  }

  /**
   * Fully stop a peer: close its runtime session, drop the address binding,
   * and delete the thread row (destructive — for test threads and explicit
   * user cleanup, not for archiving conversations).
   */
  async stopPeer(
    sourceThreadId: string,
    address: string,
  ): Promise<{ address: string; threadId: string; closed: boolean; deleted: true }> {
    const source = this.requireSource(sourceThreadId);
    const threadId = this.resolveExistingAddress(address);
    if (threadId === sourceThreadId) {
      throw new Error("A thread cannot stop (delete) itself.");
    }
    const row = this.deps.control.require(threadId);
    if (row.projectId !== source.projectId) {
      throw new Error(`Peer ${address} is outside this workspace scope.`);
    }
    let closed = false;
    try {
      await this.deps.control.stop(threadId);
      closed = true;
    } catch {
      closed = false;
    }
    deleteNativeBindingsForThread(threadId);
    dbDeleteThread(threadId);
    this.deps.mirrorThreadDeletion(threadId);
    return { address, threadId, closed, deleted: true as const };
  }

  /**
   * Resolve an address to an already-known thread WITHOUT claiming anything:
   * unknown addresses fail closed instead of materializing rows.
   */
  private resolveExistingAddress(address: string): string {
    const bound = getNativeBinding(address);
    if (bound) {
      try {
        this.deps.control.require(bound.threadId);
        return bound.threadId;
      } catch {
        deleteNativeBinding(address);
      }
    }
    for (const thread of this.deps.control.list()) {
      if (this.addressOfThread(thread)?.address === address) return thread.id;
    }
    throw new Error(`Unknown peer (nothing to stop): ${address}.`);
  }

  /** Poll row + live snapshots until the fresh native session id appears. */
  private async awaitNativeSessionId(threadId: string): Promise<string> {
    const timeoutMs = this.deps.spawnSessionTimeoutMs ?? 120_000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const rowId = this.deps.control.require(threadId).sessionRef?.providerSessionId?.trim();
        if (rowId) return rowId;
      } catch {
        // The row may vanish under a concurrent delete; keep polling live state.
      }
      const liveId = await this.deps.control.liveSessionRef(threadId).catch(() => undefined);
      if (liveId) return liveId;
      if (Date.now() >= deadline) {
        throw new Error(
          `Peer thread ${threadId} launched but its native session id did not appear within ${Math.round(timeoutMs / 1000)}s.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }


  async send(
    sourceThreadId: string,
    targetAddress: string,
    message: string,
    deliveryMode: ThreadDialogueRequest["deliveryMode"] = "after-current-turn",
  ): Promise<ThreadExchange> {
    const source = this.deps.control.require(sourceThreadId);
    const { threadId } = this.resolveAddress(targetAddress, source.projectId);
    return this.deps.collaboration.requestDialogue({
      actorThreadId: sourceThreadId,
      request: {
        sourceThreadId,
        targetThreadId: threadId,
        request: message,
        deliveryMode,
        idempotencyKey: `bus-send-${this.newId()}`,
        hopDepth: 0,
      },
    });
  }

  async ask(
    sourceThreadId: string,
    targetAddress: string,
    message: string,
    options?: {
      deliveryMode?: ThreadDialogueRequest["deliveryMode"];
      timeoutMs?: number;
    },
  ): Promise<{ exchange: ThreadExchange; timedOut: boolean }> {
    const source = this.requireSource(sourceThreadId);
    const { threadId } = this.resolveAddress(targetAddress, source.projectId);
    const exchange = await this.askRaw(
      sourceThreadId,
      threadId,
      message,
      options?.deliveryMode,
    );
    if (options?.timeoutMs === undefined) return { exchange, timedOut: false };
    // A timeout only stops THIS wait: the message stays queued/delivered and
    // a late reply is still captured and readable afterwards.
    const waited = await this.waitForReply(
      sourceThreadId,
      exchange.id,
      exchange.updatedAt,
      options.timeoutMs,
    );
    return { exchange: waited.exchange, timedOut: waited.timedOut };
  }

  /** Ask by resolved thread ids (address resolution already done). */
  async askRaw(
    sourceThreadId: string,
    targetThreadId: string,
    message: string,
    deliveryMode: ThreadDialogueRequest["deliveryMode"] = "after-current-turn",
  ): Promise<ThreadExchange> {
    return this.deps.collaboration.requestDialogue({
      actorThreadId: sourceThreadId,
      request: {
        sourceThreadId,
        targetThreadId,
        request: message,
        deliveryMode,
        idempotencyKey: `bus-ask-${this.newId()}`,
        hopDepth: 0,
      },
    });
  }

  /** Bounded wait for one exchange; a timeout never deletes the message. */
  async waitForReply(
    actorThreadId: string,
    exchangeId: string,
    afterUpdatedAt: string | undefined,
    timeoutMs: number,
  ): Promise<{ timedOut: boolean; exchange: ThreadExchange }> {
    return this.deps.collaboration.waitForExchange(
      actorThreadId,
      exchangeId,
      afterUpdatedAt,
      timeoutMs,
    );
  }

  /** Single peer lookup by address within the caller's workspace scope. */
  getPeer(sourceThreadId: string, address: string): NativeThreadPeer {
    const peer = this.listPeers(sourceThreadId).find((entry) => entry.address === address);
    if (!peer) {
      throw new Error(`Peer not found in this workspace scope: ${address}.`);
    }
    return peer;
  }

  /**
   * Retry delivery of queued exchanges for one peer without interrupting it:
   * ordinary queued messages still wait for the target's current turn to
   * settle; this only re-drives what is already deliverable. Preempt a busy
   * peer with send(..., "interrupt-and-send") instead.
   */
  async wakePeer(
    sourceThreadId: string,
    address: string,
  ): Promise<{ threadId: string; retried: number; exchanges: ThreadExchange[] }> {
    const source = this.requireSource(sourceThreadId);
    const { threadId } = this.resolveAddress(address, source.projectId);
    const exchanges = await this.deps.collaboration.retryQueuedForTarget(threadId);
    return { threadId, retried: exchanges.length, exchanges };
  }

  requireSource(threadId: string): Thread {
    return this.deps.control.require(threadId);
  }

  /**
   * Explicit reply to an ask/message. Threading is preserved at the
   * conversation-link level (same participant pair shares one link, sequence
   * orders M1 → M2 → M3); the ask exchange itself still auto-settles to
   * `replied` with an excerpt when the replier completes its turn.
   */
  async reply(
    actorThreadId: string,
    exchangeId: string,
    response: string,
  ): Promise<ThreadExchange> {
    const parent = this.deps.collaboration.readExchange(actorThreadId, exchangeId);
    const other =
      parent.sourceThreadId === actorThreadId ? parent.targetThreadId : parent.sourceThreadId;
    return this.deps.collaboration.requestDialogue({
      actorThreadId,
      request: {
        sourceThreadId: actorThreadId,
        targetThreadId: other,
        request: response,
        deliveryMode: "after-current-turn",
        idempotencyKey: `bus-reply-${parent.id}-${this.newId()}`,
        hopDepth: 0,
      },
    });
  }

  inbox(threadId: string, limit = 30): ThreadExchange[] {
    return this.deps.collaboration.listExchanges(threadId, threadId, limit);
  }

  threadExchanges(threadId: string, limit = 30): ThreadExchange[] {
    return this.deps.collaboration.listExchanges(threadId, threadId, limit);
  }

  private addressOfThread(thread: Thread): { address: string; harness: string; nativeId: string } | null {
    const harness = thread.agentKind?.trim();
    if (!harness) return null;
    try {
      assertKnownHarness(harness);
    } catch {
      return null;
    }
    const nativeId = thread.sessionRef?.providerSessionId?.trim() || thread.id;
    try {
      return { address: formatNativeAddress(harness, nativeId), harness, nativeId };
    } catch {
      return null;
    }
  }

  private workspaceOfThread(thread: Thread): string | null {
    const location = this.deps.getProjectLocation(thread.projectId);
    return location ? resolveWorkspace(locationPath(location)) : null;
  }

  private projectForAddress(address: string, sourceProjectId: string): string {
    void address;
    // External peers are only listed inside the source's own workspace scope,
    // so the source project is the honest claim target.
    if (!this.deps.getProjectLocation(sourceProjectId)) {
      throw new Error(`Cannot resolve address: source project ${sourceProjectId} no longer exists.`);
    }
    return sourceProjectId;
  }

  private threadRowExists(threadId: string): boolean {
    try {
      this.deps.control.require(threadId);
      return true;
    } catch {
      return false;
    }
  }
}

function locationPath(location: ProjectLocation): string {
  if (location.kind === "wsl") return location.linuxPath;
  return location.path;
}
