import type { ReactNode } from "react";
import type { Project } from "@/shared/contracts";
import { DraftContextBar } from "./DraftContextBar";
import type { CraftMode } from "./CraftModeSwitch";
import { SessionMetricsBar } from "./SessionMetricsBar";

/**
 * The single outer shell for the Home and live-thread composer.
 *
 * The composer implementation remains responsible for editing, attachments,
 * permissions and submission. This component owns only the pieces that must
 * never disappear when a draft becomes a real conversation: the context strip
 * above it and the usage row below it. `placement` changes docking only.
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
}) {
  return (
    <div
      data-universal-docked-chat-input=""
      data-placement={props.placement}
      className={
        props.placement === "conversation"
          ? "sticky bottom-0 z-10 flex flex-col bg-[var(--content-background)] pb-4 pt-1"
          : "flex flex-col"
      }
    >
      {props.project ? (
        <DraftContextBar
          project={props.project}
          craftMode={props.craftMode}
          onCraftModeChange={props.onCraftModeChange}
          {...(props.paneId ? { paneId: props.paneId } : {})}
          {...(props.worktreePath ? { worktreePath: props.worktreePath } : {})}
          {...(props.onProjectChange ? { onProjectChange: props.onProjectChange } : {})}
        />
      ) : null}
      {props.children}
      <SessionMetricsBar />
    </div>
  );
}
