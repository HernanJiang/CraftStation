import type { ProjectLocation } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "./appStore";

export async function captureFileCheckpoint(input: {
  threadId: string;
  checkpointItemId: string;
  projectLocation: ProjectLocation;
}): Promise<void> {
  try {
    const result = await readBridge().createFileCheckpoint(input);
    useAppStore.getState().upsertThreadFileCheckpoint(input.threadId, result.checkpoint);
  } catch (error) {
    console.warn("[checkpoint] failed to capture file checkpoint", error);
  }
}

export async function hydrateFileCheckpoints(input: {
  threadId: string;
  projectLocation: ProjectLocation;
}): Promise<void> {
  try {
    const result = await readBridge().listFileCheckpoints(input);
    useAppStore
      .getState()
      .hydrateThreadFileCheckpoints(input.threadId, result.checkpoints, result.turns);
  } catch (error) {
    console.warn("[checkpoint] failed to hydrate file checkpoints", error);
  }
}

export async function finalizeFileCheckpoint(input: {
  threadId: string;
  checkpointItemId: string;
  baseCheckpointItemId: string;
  projectLocation: ProjectLocation;
}): Promise<void> {
  try {
    const result = await readBridge().finalizeFileCheckpoint(input);
    useAppStore.getState().upsertThreadFileCheckpointTurn(input.threadId, result.checkpoint);
  } catch (error) {
    console.warn("[checkpoint] failed to finalize file checkpoint", error);
  }
}
