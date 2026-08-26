import { isRemoteSession, readBridge } from "@/renderer/bridge";
import type { GetGitDiffPayload, GitDiffResult } from "@/shared/contracts";

export const REMOTE_DIFF_LOAD_TIMEOUT_MS = 10_000;

type GitDiffDisplayData = {
  result: GitDiffResult;
  oldContent: string;
  newContent: string;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("Timed out loading Git diff")),
      timeoutMs,
    );
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export async function loadGitDiffForDisplay(
  payload: GetGitDiffPayload & { filePath: string },
  timeoutMs = REMOTE_DIFF_LOAD_TIMEOUT_MS,
): Promise<GitDiffDisplayData> {
  if (isRemoteSession()) {
    const result = await withTimeout(readBridge().getGitDiff(payload), timeoutMs);
    return { result, oldContent: "", newContent: "" };
  }

  // Local IPC can stall too (for example while Git walks a generated file).
  // Bound both calls so one selected file cannot leave Review spinning forever.
  const [result, content] = await withTimeout(
    Promise.all([readBridge().getGitDiff(payload), readBridge().getGitFileContent(payload)]),
    timeoutMs,
  );
  return { result, ...content };
}
