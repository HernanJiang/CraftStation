import type { AuthState, ErrorItemPayload, MessageItemPayload } from "@/shared/contracts";
import type { AppStoreState } from "@/renderer/state/slices/shared";
import {
  getRuntimeItemPayload,
  type RuntimeChatItem,
} from "@/renderer/state/slices/runtimeEventSlice";
import { isRetryableCapacityError } from "@/shared/retryableCapacityError";
import { isForeignCatalogModelForHarness, isThirdPartyAccountId } from "@/shared/thirdPartyRouting";

export interface ThreadErrorDockState {
  sourceItemId: string;
  message: string;
}

const EMPTY_ERROR_DOCK_STATES: ThreadErrorDockState[] = [];

const errorDockStatesCache = new Map<
  string,
  {
    itemIds: readonly string[] | undefined;
    result: ThreadErrorDockState[];
  }
>();

const errorDockStateByItem = new WeakMap<RuntimeChatItem, ThreadErrorDockState>();

/** Errors since the latest user message, oldest → newest (composer order). */
export function selectThreadErrorDockStates(
  state: AppStoreState,
  threadId: string,
): ThreadErrorDockState[] {
  const itemIds = state.runtimeItemIdsByThread[threadId];
  const cached = errorDockStatesCache.get(threadId);
  if (cached && cached.itemIds === itemIds) {
    return cached.result;
  }

  if (!itemIds?.length) {
    errorDockStatesCache.set(threadId, { itemIds, result: EMPTY_ERROR_DOCK_STATES });
    return EMPTY_ERROR_DOCK_STATES;
  }

  const itemsById = state.runtimeItemsByIdByThread[threadId];
  const sinceLastUser: ThreadErrorDockState[] = [];
  // A turn that failed over to the next pool account answers AFTER its quota
  // error item. Once a completed, non-empty assistant message follows, the
  // older error is recovered history — not an actionable dock. (The walk
  // runs newest-first, so "follows" means "seen before the error".)
  let recovered = false;
  // Pool failover retries can paint the identical quota banner several turns
  // in a row (one error item per failed turn). Collapse consecutive duplicates
  // so the dock shouts once; distinct messages still all surface.
  let lastPushedMessage: string | null = null;
  for (let index = itemIds.length - 1; index >= 0; index -= 1) {
    const item = itemsById?.[itemIds[index]!];
    if (!item) continue;
    if (item.type === "user_message") break;
    if (item.type === "assistant_message" && !recovered) {
      recovered = hasAssistantAnswer(item);
      continue;
    }
    if (item.type !== "error") continue;
    if (recovered) continue;
    const dock = item.type === "error" ? getThreadErrorDockStateForItem(item) : null;
    if (!dock) continue;
    if (dock.message === lastPushedMessage) continue;
    lastPushedMessage = dock.message;
    sinceLastUser.push(dock);
  }
  const result = sinceLastUser.length === 0 ? EMPTY_ERROR_DOCK_STATES : sinceLastUser.reverse();
  errorDockStatesCache.set(threadId, { itemIds, result });
  return result;
}

export function getThreadErrorDockStateForItem(item: RuntimeChatItem): ThreadErrorDockState | null {
  if (item.type !== "error") return null;
  const payload = getRuntimeItemPayload<ErrorItemPayload>(item, "error");
  const message = payload?.message?.trim();
  if (!message) return null;
  if (isAbortOnlyErrorMessage(message)) return null;
  if (isRetryableCapacityError(message)) return null;
  const cached = errorDockStateByItem.get(item);
  if (cached && cached.message === message) return cached;
  const dock = { sourceItemId: item.id, message };
  errorDockStateByItem.set(item, dock);
  return dock;
}

function isAbortOnlyErrorMessage(message: string): boolean {
  return /^(?:error:\s*)?(?:aborterror:\s*)?aborted\.?$/i.test(message.trim());
}

const NON_WHITESPACE = /\S/;

/** A completed assistant row with visible text or image counts as an answer. */
function hasAssistantAnswer(item: RuntimeChatItem): boolean {
  if (item.type !== "assistant_message" || item.state !== "completed") return false;
  const streams = (item as { streams?: Record<string, string | undefined> }).streams;
  if (streams?.["assistant_text"] && NON_WHITESPACE.test(streams["assistant_text"])) return true;
  const payload = getRuntimeItemPayload<MessageItemPayload>(item, "assistant_message");
  return (
    payload?.content.some(
      (block) =>
        (block.kind === "text" && NON_WHITESPACE.test(block.text)) ||
        block.kind === "image" ||
        block.kind === "audio",
    ) ?? false
  );
}

/**
 * Heuristic for runtime errors that indicate the agent is unauthenticated.
 * Covers strings emitted by the Claude binary ("Failed to authenticate. API
 * Error: 401 …", "Please run /login", "Session expired …") and the
 * Anthropic-SDK error codes the agent SDK surfaces ("authentication_failed",
 * "oauth_org_not_allowed"). When this returns true, the composer should
 * render the auth-required dock (with its Login button) rather than the
 * generic error dock — `/login` itself isn't reachable through the SDK
 * transport, so the user needs the terminal-login affordance.
 */
export function isAuthErrorMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("failed to authenticate") ||
    m.includes("invalid authentication credentials") ||
    m.includes("api error: 401") ||
    m.includes("please run /login") ||
    m.includes("session expired") ||
    m.includes("authentication_failed") ||
    m.includes("oauth_org_not_allowed") ||
    /\bnot logged in\b/.test(m)
  );
}

/**
 * Whether the auth-required dock applies, shared by every surface that hosts it
 * (the desktop composer and the mobile PWA's action-dock card). A stale runtime
 * auth error — e.g. a 401 from before the user signed in — must not keep the
 * dock visible once detection confirms the agent is authenticated again;
 * `hasRuntimeAuthError` is returned separately because the error dock hides
 * itself for exactly those messages.
 */
export function resolveThreadAuthState(input: {
  readonly authState: AuthState | undefined;
  readonly errorDockStates: readonly ThreadErrorDockState[];
  /** Catalog/channel that supplied credentials (OpenCode Go → Muse, etc.). */
  readonly sourceProviderKind?: string | undefined;
  /** Sticky third-party openai-compatible account, if the launch uses one. */
  readonly accountId?: string | undefined;
  /** Spawn Harness kind, used to derive the catalog channel from the model id
   * when `sourceProviderKind` was never recorded. */
  readonly agentKind?: string | undefined;
  /** Catalog model id; a `channel/model` id on a different Harness proves a
   * foreign serving channel even without a recorded `sourceProviderKind`. */
  readonly model?: string | undefined;
}): { readonly authRequired: boolean; readonly hasRuntimeAuthError: boolean } {
  const hasRuntimeAuthError =
    input.authState !== "authenticated" &&
    input.errorDockStates.some((state) => isAuthErrorMessage(state.message));
  const foreignChannel =
    Boolean(input.sourceProviderKind?.trim()) ||
    isThirdPartyAccountId(input.accountId) ||
    isForeignCatalogModelForHarness(input.model, input.agentKind);
  return {
    authRequired:
      !foreignChannel && (input.authState === "missing" || hasRuntimeAuthError),
    hasRuntimeAuthError,
  };
}
