import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

/**
 * Step Code config/auth file locations, shared by the supervisor (agent
 * detection, usage scanner) and the main process (usage login state). Pure
 * filesystem reads only — no process spawning, so both sides can import this.
 */

/**
 * Step Code config root holding `auth.json`/`models.json` — one level above
 * the agent dir (`<root>/agent`). `STEPCODE_CONFIG_DIR` renames the default
 * `~/.stepcode` root; `STEP_CODING_AGENT_DIR` relocates `<root>/agent`.
 */
export function stepCodeConfigRoot(): string {
  const agentDir = process.env.STEP_CODING_AGENT_DIR?.trim();
  if (agentDir) return dirname(agentDir);
  const configDir = process.env.STEPCODE_CONFIG_DIR?.trim();
  if (configDir) return isAbsolute(configDir) ? configDir : join(homedir(), configDir);
  return join(homedir(), ".stepcode");
}

/** Step Code agent home (`<root>/agent`) — sessions and settings live inside. */
export function stepCodeAgentHomePath(): string {
  return process.env.STEP_CODING_AGENT_DIR?.trim() || join(stepCodeConfigRoot(), "agent");
}

export function nativeStepCodeAuthPath(): string {
  return process.env.STEPCODE_AUTH_PATH?.trim() || join(stepCodeConfigRoot(), "auth.json");
}

export function nativeStepCodeAuthCandidates(): string[] {
  return [
    nativeStepCodeAuthPath(),
    // Pre-rename locations Step Code still imports credentials from.
    join(homedir(), ".stepcode", "legacy-auth.json"),
    join(homedir(), ".step-harness", "auth.json"),
    join(homedir(), ".step-harness", "agent", "auth.json"),
  ];
}

/**
 * True when a native Step Code credential file holds at least one provider
 * entry — the durable sign-in signal independent of any in-memory flag. Never
 * throws; missing/corrupt files read as signed out.
 */
export function hasNativeStepCodeCredentials(
  candidates: readonly string[] = nativeStepCodeAuthCandidates(),
): boolean {
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) return true;
    } catch {
      // Unreadable/partial file — try the next candidate.
    }
  }
  return false;
}
