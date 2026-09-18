import type { RuntimeEvent } from "@/shared/contracts";
import { isAgentStatusSupervisorEvent, type SupervisorEvent } from "@/shared/ipc";
import { useAppStore } from "@/renderer/state/appStore";
import { useDevTerminalStore } from "@/renderer/state/devTerminalStore";
import { useThreadOutputStore } from "@/renderer/state/threadOutputStore";
import { recordRuntimeUsage } from "@/renderer/state/usageRecorder";
import { applySessionHandoffState } from "@/renderer/actions/sessionHandoffActions";
import { applyAgentStatusSupervisorEvent } from "@/renderer/state/agentStatusesStore";
import { useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import { setAccountsUnlessEmptyWipe } from "@/renderer/state/usageAccountsStore";
import { useTokenUsageStore } from "@/renderer/state/tokenUsageStore";
import { clearRuntimeItemStoreSelectorCacheForThread } from "@/renderer/components/thread/ChatPane/chatPaneSelectors";
import {
  handleThreadStateNotification,
  shouldInspectThreadStateForNotification,
  showInAppUserNotification,
} from "@/renderer/notifications";
import {
  mcpInjectionDropCopy,
  poolFailoverToastCopy,
  showTopStatusToast,
  turnRetryToastCopy,
} from "@/renderer/components/ui/topStatusToast";
import { providerLabel } from "@/renderer/views/MainView/parts/Sidebar/parts/providerBrands";
import type { WorkbenchContribution } from "../lifecycle";
import type { WorkbenchServices } from "../services";

export const runtimeEventsContribution: WorkbenchContribution<WorkbenchServices> = {
  id: "runtime.events",
  phase: "starting",
  activate({ services, scope, isReady }) {
    const BACKGROUND_RUNTIME_EVENT_BATCH_MS = 250;
    const pendingRuntimeEvents = new Map<string, RuntimeEvent[]>();
    let runtimeFlushHandle: number | null = null;
    let backgroundRuntimeFlushHandle: ReturnType<typeof setTimeout> | null = null;

    function isForegroundRuntimeThread(threadId: string): boolean {
      if (document.visibilityState === "hidden") return false;
      const view = useAppStore.getState().view;
      return view.kind === "thread" && view.panes.includes(threadId);
    }

    function flushPendingRuntimeEvents(shouldFlush: (threadId: string) => boolean): void {
      const store = useAppStore.getState();
      const threads = store.threads;
      const batches: { threadId: string; events: RuntimeEvent[] }[] = [];
      for (const [threadId, events] of pendingRuntimeEvents) {
        if (!shouldFlush(threadId)) continue;
        batches.push({ threadId, events });
        pendingRuntimeEvents.delete(threadId);
      }
      if (batches.length === 0) return;
      // One Zustand set for all concurrent streams 鈥?avoids N selector passes when
      // several chats are working in the background / being switched between.
      store.applyRuntimeEventBatches(batches);
      for (const { threadId, events } of batches) {
        // Durable usage capture at the canonical layer (all providers normalized).
        // Thread metadata is resolved lazily inside, so pure-delta frames are free.
        recordRuntimeUsage(threadId, events, threads);
      }
    }

    function schedulePendingRuntimeEvents(): void {
      let hasForeground = false;
      let hasBackground = false;
      const view = useAppStore.getState().view;
      const foregroundThreadIds: readonly string[] =
        document.visibilityState !== "hidden" && view.kind === "thread" ? view.panes : [];
      for (const threadId of pendingRuntimeEvents.keys()) {
        if (foregroundThreadIds.includes(threadId)) hasForeground = true;
        else hasBackground = true;
        if (hasForeground && hasBackground) break;
      }

      if (hasForeground && runtimeFlushHandle === null) {
        runtimeFlushHandle = requestAnimationFrame(() => {
          runtimeFlushHandle = null;
          flushPendingRuntimeEvents(isForegroundRuntimeThread);
          schedulePendingRuntimeEvents();
        });
      } else if (!hasForeground && runtimeFlushHandle !== null) {
        cancelAnimationFrame(runtimeFlushHandle);
        runtimeFlushHandle = null;
      }

      if (hasBackground && backgroundRuntimeFlushHandle === null) {
        backgroundRuntimeFlushHandle = setTimeout(() => {
          backgroundRuntimeFlushHandle = null;
          flushPendingRuntimeEvents((threadId) => !isForegroundRuntimeThread(threadId));
          schedulePendingRuntimeEvents();
        }, BACKGROUND_RUNTIME_EVENT_BATCH_MS);
      } else if (!hasBackground && backgroundRuntimeFlushHandle !== null) {
        clearTimeout(backgroundRuntimeFlushHandle);
        backgroundRuntimeFlushHandle = null;
      }
    }

    function appendRuntimeEvents(threadId: string, events: readonly RuntimeEvent[]): void {
      const existing = pendingRuntimeEvents.get(threadId);
      if (existing) {
        for (const evt of events) existing.push(evt);
      } else {
        pendingRuntimeEvents.set(threadId, [...events]);
      }
    }

    function flushPendingRuntimeEventsSync(threadId: string): void {
      flushPendingRuntimeEvents((pendingThreadId) => pendingThreadId === threadId);
      schedulePendingRuntimeEvents();
    }

    function installRuntimeEventScheduling(): () => void {
      const unsubscribe = useAppStore.subscribe(
        (state) => state.view,
        schedulePendingRuntimeEvents,
      );
      document.addEventListener("visibilitychange", schedulePendingRuntimeEvents);
      return () => {
        unsubscribe();
        document.removeEventListener("visibilitychange", schedulePendingRuntimeEvents);
      };
    }

    function handleSupervisorEvent(event: SupervisorEvent): void {
      if ("threadId" in event && event.threadId.startsWith("shell:")) {
        if (event.type === "thread-output") {
          useDevTerminalStore.getState().noteShellOutput(event.threadId);
        } else if (event.type === "thread-exited") {
          useDevTerminalStore.getState().markShellExited(event.threadId);
        }
        return;
      }

      // Feed every agent thread's PTY bytes into the renderer-side scrollback
      // accumulator. It runs regardless of which pane is mounted, so a hidden
      // thread keeps its history (the xterm buffer dies with the unmounted pane).
      // `thread-reset` (a fresh spawn) clears the thread's accumulated bytes.
      if (event.type === "thread-output") {
        useThreadOutputStore.getState().appendOutput(event.threadId, event.data);
      } else if (event.type === "thread-reset") {
        useThreadOutputStore.getState().clearOutput(event.threadId);
      }

      if (event.type === "session-switch-state") {
        void applySessionHandoffState(event.state).catch((error: unknown) =>
          services.reportError("session.handoff", error),
        );
        return;
      }

      if (event.type === "thread-runtime-event") {
        appendRuntimeEvents(event.threadId, [event.event]);
        schedulePendingRuntimeEvents();
        return;
      }
      if (event.type === "thread-runtime-events") {
        if (event.events.length > 0) {
          appendRuntimeEvents(event.threadId, event.events);
          schedulePendingRuntimeEvents();
        }
        return;
      }
      if (event.type === "thread-runtime-events-multi") {
        let hasEvents = false;
        for (const batch of event.batches) {
          if (batch.events.length === 0) continue;
          appendRuntimeEvents(batch.threadId, batch.events);
          hasEvents = true;
        }
        if (hasEvents) schedulePendingRuntimeEvents();
        return;
      }

      // Non-runtime event: drain pending runtime events first so the handler below
      // observes the same ordering callers expect from the IPC stream.
      if ("threadId" in event && pendingRuntimeEvents.has(event.threadId)) {
        flushPendingRuntimeEventsSync(event.threadId);
      }

      if (event.type === "thread-state") {
        const shouldCheckNotifications = isReady() && shouldInspectThreadStateForNotification();
        const appStore = useAppStore.getState();
        const oldThread = shouldCheckNotifications
          ? appStore.threads.find((t) => t.id === event.threadId)
          : undefined;
        appStore.updateThreadRuntime(event.threadId, event);
        if (shouldCheckNotifications) {
          const newThread = useAppStore.getState().threads.find((t) => t.id === event.threadId);
          handleThreadStateNotification(event, oldThread, newThread);
        }
        // Once the agent process is gone, any sub-agent that hadn't completed is
        // orphaned — its parent `item.completed` will never arrive. Reconcile so
        // the active dock stops showing it as running.
        if (event.status === "inactive" || event.status === "error") {
          useAppStore.getState().reconcileStaleSubAgents(event.threadId);
        }
      }
      if (event.type === "thread-pending-steer") {
        useAppStore.getState().setPendingSteer(event.threadId, event.pending);
      }
      if (event.type === "thread-user-notification") {
        showInAppUserNotification(event);
      }
      if (event.type === "thread-pool-failover") {
        // Pool failover succeeded: the dead-account error already lives in chat
        // history, so no error UI — one top toast tells who died and who took
        // over. The composer error dock clears itself once the follow-up answer
        // lands (recovered errors are not actionable).
        const notice = poolFailoverToastCopy(
          providerLabel(event.provider),
          event.fromAccount,
          event.toAccount,
        );
        showTopStatusToast(notice.title, { description: notice.description });
      }
      if (event.type === "thread-turn-retry") {
        // Craft-Harness auto-retry kicked in: one top toast announces the wait
        // and the attempt number; the original failure stays out of the error
        // dock unless every retry is exhausted.
        const notice = turnRetryToastCopy(
          event.attempt,
          event.maxAttempts,
          event.delaySeconds,
          event.reason,
        );
        showTopStatusToast(notice.title, {
          description: notice.description,
          timeout: Math.min(event.delaySeconds * 1000, 8000),
        });
      }
      if (event.type === "thread-mcp-injection-drop") {
        // Enabled-in-panel MCP servers the agent never received must surface —
        // toast + notification ledger, never a silent launch without them.
        showInAppUserNotification({
          threadId: event.threadId,
          ...mcpInjectionDropCopy(event.serverNames),
        });
      }
      if (event.type === "thread-reset") {
        pendingRuntimeEvents.delete(event.threadId);
        useAppStore.getState().clearThreadRuntimeEvents(event.threadId);
        useAppStore.getState().clearAllPendingSteer(event.threadId);
        clearRuntimeItemStoreSelectorCacheForThread(event.threadId);
      }
      if (event.type === "thread-exited") {
        useAppStore.getState().markThreadExited(event.threadId);
        useAppStore.getState().clearAllPendingSteer(event.threadId);
      }
      if (isAgentStatusSupervisorEvent(event)) {
        applyAgentStatusSupervisorEvent(event, { deferFirstLaunchBulk: true });
      }
      if (event.type === "provider-usage") {
        useProviderUsageStore.getState().mergeSnapshot(event.snapshot);
      }
      if (event.type === "provider-usage-all") {
        useProviderUsageStore.getState().setSnapshots(event.snapshots);
      }
      if (event.type === "usage-accounts") {
        // Same empty-guard as polls: a transient empty event must never blank
        // shown authorizations. Real deletions arrive via explicit remove actions
        // (store spliced first) and non-empty listings.
        setAccountsUnlessEmptyWipe(event.accounts);
      }
      if (event.type === "token-usage") {
        useTokenUsageStore.getState().setResponse(event.response);
      }
    }

    scope.add(() => {
      if (runtimeFlushHandle !== null) cancelAnimationFrame(runtimeFlushHandle);
      if (backgroundRuntimeFlushHandle !== null) clearTimeout(backgroundRuntimeFlushHandle);
      pendingRuntimeEvents.clear();
    });
    scope.add(installRuntimeEventScheduling());
    scope.add(services.bridge.onSupervisorEvent(handleSupervisorEvent));
  },
};
