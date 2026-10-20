import type { Thread, PromptSegment } from "@/shared/contracts";
import { LAST_SUBMITTED_CHAT_MODEL_STATE_KEY } from "@/shared/temporaryChat";
import { readBridge } from "@/renderer/bridge";
import { buildProjectDraftConfig } from "@/renderer/views/MainView/parts/AppContent/draftConfig";

/** Record a request at dispatch, so empty prewarms and completion order cannot change it. */
export function rememberSubmittedChatModel(
  thread: Thread,
  prompt: string,
  segments?: readonly PromptSegment[],
  accountId = thread.accountBinding?.accountId,
): void {
  if ((!prompt.trim() && !segments?.length) || !thread.config.model.trim()) return;
  const memory = {
    draftConfig: buildProjectDraftConfig({
      agentKind: thread.agentKind,
      config: thread.config,
      worktreeMode: false,
    }),
    ...(accountId ? { accountId } : {}),
    presentationMode: thread.presentationMode ?? "gui",
  };
  void readBridge()
    .dbSetState(LAST_SUBMITTED_CHAT_MODEL_STATE_KEY, JSON.stringify(memory))
    .catch((cause: unknown) => {
      console.error(
        "[chat-model-memory] phase=request operation=remember status=error code=model-memory-failed",
        { threadId: thread.id, agentKind: thread.agentKind },
        cause,
      );
    });
}
