import { usePanelStore } from "@/renderer/state/panelStore";

/**
 * Native Harness kinds that already have a first-class Agent Settings page.
 * Other kinds either install through the ACP registry or (API runtimes) through
 * the usage workspace account pool.
 */
const NATIVE_AGENT_SETTINGS_KINDS = new Set([
  "codex",
  "grok",
  "kimi",
  "antigravity",
  "opencode",
  "muse",
  "devin",
  "stepcode",
]);

export type HarnessConfigurationTarget =
  | { kind: "agent-settings"; section: `agents:${string}` }
  | { kind: "acp-registry" }
  | { kind: "usage-workspace" };

export function harnessConfigurationTarget(harnessKind: string): HarnessConfigurationTarget {
  if (NATIVE_AGENT_SETTINGS_KINDS.has(harnessKind)) {
    return { kind: "agent-settings", section: `agents:${harnessKind}` };
  }
  if (harnessKind === "deepseek-api") {
    return { kind: "usage-workspace" };
  }
  return { kind: "acp-registry" };
}

/**
 * Open the configuration surface for a not-ready Harness/CLI row.
 * Native CLI agents go to their settings page (login/install). DeepSeek API
 * Runtime is an OpenAI-compatible HTTP harness, so it opens the usage
 * workspace account pool. Everything else lands on the ACP registry.
 */
export function openHarnessConfiguration(harnessKind: string): void {
  const panel = usePanelStore.getState();
  const target = harnessConfigurationTarget(harnessKind);
  if (target.kind === "agent-settings") {
    panel.openSettingsSection(target.section);
    return;
  }
  if (target.kind === "usage-workspace") {
    panel.openModelUsageWorkspace({ tab: "usage" });
    return;
  }
  panel.openSettingsSection("acpRegistry");
}
