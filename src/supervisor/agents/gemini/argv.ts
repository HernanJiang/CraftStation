import type { ThreadConfig } from "@/shared/contracts";

export function buildGeminiArgs(
  config: ThreadConfig,
  prompt: string,
  resumeSessionId?: string,
  assignedSessionId?: string,
): string[] {
  const args: string[] = [];

  // Gemini emits "Skipping project agents due to untrusted folder..." on
  // stdout when the workspace is not pre-trusted. In --acp mode that string
  // collides with JSON-RPC frames and breaks the stream parser. --skip-trust
  // suppresses the prompt for this session (replaces the older
  // GEMINI_CLI_TRUST_WORKSPACE=true env var, which only worked through env
  // inheritance and was easy to lose across spawn wrappers).
  args.push("--skip-trust");

  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  } else if (assignedSessionId) {
    args.push("--session-id", assignedSessionId);
  }
  if (config.model) {
    args.push("--model", config.model);
  }
  if (config.mode === "plan") {
    args.push("--approval-mode=plan");
  } else if (config.approvalPolicy === "never" || config.approvalPolicy === "yolo") {
    args.push("--approval-mode=yolo");
  } else if (config.approvalPolicy === "auto_edit") {
    args.push("--approval-mode=auto_edit");
  }
  if (prompt.trim().length > 0) {
    args.push("--prompt-interactive", prompt);
  }
  return args;
}
