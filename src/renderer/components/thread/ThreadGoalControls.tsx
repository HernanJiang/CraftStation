import { useState } from "react";
import { Label, Modal, TextField, toast } from "@heroui/react";
import { Pause, Pencil, Play, X } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { GoalControlAction, ThreadGoalControl } from "@/shared/contracts";
import { isCodexNativeGoalAgent } from "@/shared/threadGoal";
import { friendlyError } from "@/shared/messages";
import { readBridge } from "@/renderer/bridge";
import {
  pauseThreadGoal,
  resumeThreadGoal,
  setThreadGoalPrompt,
  stopThreadGoal,
} from "@/renderer/actions/threadActions";
import { useAppStore } from "@/renderer/state/appStore";
import { Button, TextArea } from "@/renderer/components/common";
import { ThreadDockIconButton } from "./ThreadDockUI";
import type { ThreadGoalDockState } from "./threadGoalState";

interface ThreadGoalControlsProps {
  threadId: string;
  state: ThreadGoalDockState;
  onDismiss: () => void;
}

export function ThreadGoalControls({ threadId, state, onDismiss }: ThreadGoalControlsProps) {
  const { t } = useLingui();
  const [pendingAction, setPendingAction] = useState<ThreadGoalControl["action"] | null>(null);
  const [objectiveDraft, setObjectiveDraft] = useState<string | null>(null);
  // Explicit element type: without it this is a union of array/tuple types and
  // `.includes(...)` takes the INTERSECTION of their element types, which drops
  // "pause"/"resume" and fails the calls below.
  const availableActions: GoalControlAction[] =
    state.availableActions && state.availableActions.length > 0
      ? state.availableActions
      : state.status === "paused"
        ? ["edit", "resume", "clear"]
        : ["edit", "pause", "clear"];
  const normalizedObjective = objectiveDraft?.trim() ?? "";

  const applyDurable = async (control: ThreadGoalControl): Promise<void> => {
    if (control.action === "edit" && control.objective) {
      setThreadGoalPrompt(threadId, control.objective);
      return;
    }
    if (control.action === "pause") {
      pauseThreadGoal(threadId);
      return;
    }
    if (control.action === "resume") {
      resumeThreadGoal(threadId);
      return;
    }
    if (control.action === "clear") {
      await stopThreadGoal(threadId);
    }
  };

  const controlGoal = async (control: ThreadGoalControl): Promise<boolean> => {
    setPendingAction(control.action);
    const agentKind = useAppStore.getState().threads.find((thread) => thread.id === threadId)
      ?.agentKind;
    try {
      try {
        await readBridge().controlThreadGoal({ threadId, ...control });
      } catch (error) {
        if (agentKind && isCodexNativeGoalAgent(agentKind) && control.action !== "clear") {
          toast.danger(friendlyError(error));
          return false;
        }
      }
      await applyDurable(control);
      return true;
    } catch (error) {
      toast.danger(friendlyError(error));
      return false;
    } finally {
      setPendingAction(null);
    }
  };

  const openEditor = () => {
    setObjectiveDraft(state.objective);
  };

  const saveObjective = async () => {
    if (!normalizedObjective || normalizedObjective === state.objective) return;
    if (await controlGoal({ action: "edit", objective: normalizedObjective })) {
      setObjectiveDraft(null);
    }
  };

  return (
    <>
      {availableActions.includes("edit") ? (
        <ThreadDockIconButton
          label={t`Edit goal`}
          isPending={pendingAction === "edit"}
          isDisabled={pendingAction !== null}
          onPress={openEditor}
        >
          <Pencil className="size-3.5" />
        </ThreadDockIconButton>
      ) : null}
      {availableActions.includes("pause") ? (
        <ThreadDockIconButton
          label={t`Pause goal`}
          isPending={pendingAction === "pause"}
          isDisabled={pendingAction !== null}
          onPress={() => void controlGoal({ action: "pause" })}
        >
          <Pause className="size-3.5" />
        </ThreadDockIconButton>
      ) : null}
      {availableActions.includes("resume") ? (
        <ThreadDockIconButton
          label={t`Resume goal`}
          isPending={pendingAction === "resume"}
          isDisabled={pendingAction !== null}
          onPress={() => void controlGoal({ action: "resume" })}
        >
          <Play className="size-3.5" />
        </ThreadDockIconButton>
      ) : null}
      {availableActions.includes("clear") ? (
        <ThreadDockIconButton
          label={t`Clear goal`}
          isPending={pendingAction === "clear"}
          isDisabled={pendingAction !== null}
          danger
          onPress={() => void controlGoal({ action: "clear" })}
        >
          <X className="size-3.5" />
        </ThreadDockIconButton>
      ) : (
        <ThreadDockIconButton label={t`Close goal`} onPress={onDismiss}>
          <X className="size-3.5" />
        </ThreadDockIconButton>
      )}
      {objectiveDraft !== null ? (
        <Modal.Backdrop isOpen onOpenChange={(open) => !open && setObjectiveDraft(null)}>
          <Modal.Container placement="center" size="md">
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>
                  <Trans>Edit goal</Trans>
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="p-4">
                <TextField>
                  <Label>
                    <Trans>Goal objective</Trans>
                  </Label>
                  <TextArea
                    autoFocus // eslint-disable-line jsx-a11y/no-autofocus -- opened edit dialog, expected focus target
                    rows={5}
                    value={objectiveDraft}
                    onChange={(event) => setObjectiveDraft(event.target.value)}
                  />
                </TextField>
              </Modal.Body>
              <Modal.Footer>
                <Button slot="close" variant="ghost" size="sm" className="text-muted">
                  <Trans>Cancel</Trans>
                </Button>
                <Button
                  variant="tertiary"
                  size="sm"
                  className="text-white"
                  isDisabled={!normalizedObjective || normalizedObjective === state.objective}
                  isPending={pendingAction === "edit"}
                  onPress={() => void saveObjective()}
                >
                  <Trans>Save</Trans>
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      ) : null}
    </>
  );
}
