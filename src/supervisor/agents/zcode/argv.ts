import type { ThreadConfig } from "@/shared/contracts";

export const ZCODE_DEFAULT_MODEL_ID = "GLM-5.3";

export function buildZCodeArgs(
  config: ThreadConfig,
  prompt: string,
  resumeSessionId?: string,
): string[] {
  const args: string[] = [];
  if (resumeSessionId) args.push("--resume", resumeSessionId);
  else if (resumeSessionId === "") args.push("--continue");
  if (config.mode) args.push("--mode", config.mode === "agent" ? "auto" : config.mode);
  if (prompt.trim()) args.push("--prompt", prompt.trim());
  return args;
}
