import type { ThreadConfig } from "@/shared/contracts";

export const MINIMAX_DEFAULT_MODEL_ID = "MiniMax-M3";

export function buildMiniMaxArgs(config: ThreadConfig, prompt: string, resume = false): string[] {
  const args: string[] = [];
  if (resume) args.push("--continue");
  if (prompt.trim()) args.push(prompt.trim());
  void config;
  return args;
}
