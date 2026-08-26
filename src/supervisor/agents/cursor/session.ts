import { spawnSync } from "node:child_process";
import type { ProjectLocation } from "@/shared/contracts";
import { buildAgentCommand } from "../base";
import { resolveAgentBinaryPath } from "../binaryResolver";

export function createCursorChatSync(location: ProjectLocation): string | undefined {
  const spec = buildAgentCommand(
    location,
    "cursor-agent",
    ["create-chat"],
    resolveAgentBinaryPath(location, "cursor-agent"),
  );
  try {
    const result = spawnSync(spec.command, spec.args, {
      encoding: "utf8",
      ...(spec.cwd ? { cwd: spec.cwd } : {}),
      windowsHide: true,
      timeout: 15_000,
    });
    const chatId = (result.stdout ?? "").trim();
    if (result.status === 0 && chatId.length > 0) {
      return chatId;
    }
  } catch {
    // Fall through — launch without a pre-assigned session
  }
  return undefined;
}
