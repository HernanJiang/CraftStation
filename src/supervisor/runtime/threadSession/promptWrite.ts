import { setTimeout as sleep } from "node:timers/promises";
import type { IPty } from "node-pty";
import type { ProjectLocation } from "@/shared/contracts";

export async function writeSubmittedPrompt(
  pty: Pick<IPty, "write">,
  chunks: readonly string[],
  _projectLocation: ProjectLocation,
): Promise<void> {
  for (const chunk of chunks) {
    const waitMatch = chunk.match(/^@wait:(\d+)$/);
    if (waitMatch) {
      await sleep(Number(waitMatch[1]));
      continue;
    }
    pty.write(chunk);
    await sleep(8);
  }
}
