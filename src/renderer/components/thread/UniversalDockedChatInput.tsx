import type { ReactNode } from "react";
import type { Project } from "@/shared/contracts";
import { DraftContextBar } from "./DraftContextBar";
import { DraftGitLaunchSlotProvider } from "./DraftGitLaunchSlot";
import type { CraftMode } from "./CraftModeSwitch";

/**
 * The single outer shell for the Home and live-thread composer.
 *
 * The composer implementation remains responsible for editing, attachments,
 * permissions and submission. This component owns only the pieces that must
 * never disappear when a draft becomes a real conversation: the context strip
 * above it. `placement` changes
 * docking only. The context/quota ring lives in the toolbar (next to the model
 * picker), not here.
 */
export function UniversalDockedChatInput(props: {
  project?: Project;
  placement: "home" | "conversation";
  children: ReactNode;
  craftMode: CraftMode;
  onCraftModeChange: (mode: CraftMode) => void;
  paneId?: string;
  worktreePath?: string;
  onProjectChange?: (projectId: string) => void;
  /** 会话 id：有会话且存在计划时，上方标签栏左侧显示计划进度胶囊。 */
  threadId?: string;
  /** GUI threads embed the goal dock in the context bar. Terminal/mobile keep it out. */
  showGoalStrip?: boolean;
}) {
  return (
    <DraftGitLaunchSlotProvider>
      <div
        data-universal-docked-chat-input=""
        data-placement={props.placement}
        className={
          props.placement === "conversation"
            ? "sticky bottom-0 z-10 flex flex-col bg-[var(--content-background)] pb-2 pt-1"
            : "flex flex-col"
        }
      >
        {props.project ? (
          <DraftContextBar
            project={props.project}
            craftMode={props.craftMode}
            onCraftModeChange={props.onCraftModeChange}
            {...(props.threadId ? { threadId: props.threadId } : {})}
            {...(props.paneId ? { paneId: props.paneId } : {})}
            {...(props.worktreePath ? { worktreePath: props.worktreePath } : {})}
            {...(props.onProjectChange ? { onProjectChange: props.onProjectChange } : {})}
            {...(props.showGoalStrip === false ? { showGoalStrip: false } : {})}
          />
        ) : null}
        {props.children}
      </div>
    </DraftGitLaunchSlotProvider>
  );
}
