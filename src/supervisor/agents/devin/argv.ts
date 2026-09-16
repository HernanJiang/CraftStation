import type { ThreadConfig } from "@/shared/contracts";

/**
 * Flag references — verified against https://docs.devin.ai/cli/reference/commands:
 *   • `--model <MODEL>` selects the session model (family slugs: opus/sonnet/swe/gpt/gemini).
 *   • `--permission-mode <MODE>` is `normal` (alias `auto`), `accept-edits`,
 *     `smart`, or `dangerous` (aliases `yolo` / `bypass`). Plan is an agent
 *     profile (`/plan`), not a permission-mode value.
 *   • `--resume <id>` / `--continue` resume a session.
 *   • `--print` is the non-interactive one-shot path; pair with
 *     `--respect-workspace-trust false` so CI/PTY never blocks on trust.
 *   • An initial prompt is passed after `--` so it is never parsed as a subcommand.
 */
export const DEVIN_ACP_ARGS = ["acp"] as const;

export function permissionModeForConfig(config: ThreadConfig): string | undefined {
  if (config.mode === "plan") return undefined;
  switch (config.approvalPolicy) {
    case "yolo":
    case "never":
    case "bypassPermissions":
    case "dangerous":
      return "yolo";
    case "auto_edit":
    case "accept-edits":
      return "accept-edits";
    case "smart":
      return "smart";
    default:
      return undefined;
  }
}

function pushSharedFlags(args: string[], config: ThreadConfig): void {
  if (config.model) args.push("--model", config.model);
  const permissionMode = permissionModeForConfig(config);
  if (permissionMode) args.push("--permission-mode", permissionMode);
}

function pushPrompt(args: string[], prompt: string): void {
  const trimmed = prompt.trim();
  if (!trimmed) return;
  args.push("--", trimmed);
}

/** Argv for the interactive `devin` TUI / PTY. */
export function buildDevinArgs(
  config: ThreadConfig,
  prompt: string,
  resumeSessionId?: string,
): string[] {
  const args: string[] = [];
  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  } else if (resumeSessionId === "") {
    args.push("--continue");
  }
  pushSharedFlags(args, config);
  pushPrompt(args, prompt);
  return args;
}

/** Argv for `devin acp` (ACP / GUI tab). */
export function buildDevinAcpArgs(config: ThreadConfig): string[] {
  const args: string[] = [...DEVIN_ACP_ARGS];
  if (config.model) args.push("--model", config.model);
  return args;
}

/** Argv for `devin --print` one-shots (commit/title generation, scripts). */
export function buildDevinPrintArgs(config: ThreadConfig, prompt: string): string[] {
  const args = ["--print", "--respect-workspace-trust", "false"];
  pushSharedFlags(args, config);
  pushPrompt(args, prompt);
  return args;
}
