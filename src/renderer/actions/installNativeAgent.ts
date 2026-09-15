import { toast } from "@heroui/react";
import { readBridge } from "@/renderer/bridge";
import { runAgentInstallCommand } from "@/renderer/actions/agentLoginActions";
import { currentWslDistros } from "@/renderer/utils/acpRegistryAuth";
import { NATIVE_AGENT_REGISTRY_ENTRIES } from "@/renderer/views/SettingsOverlay/parts/agentRegistryNative";

/**
 * One-click install for a Native Agent CLI, shared by the agent settings page
 * (per-environment install rows) and the synthesis-bench Harness/CLI panel.
 * The install command always comes from the Native Agent Registry entry — this
 * module never hardcodes a vendor installer — and a clean exit triggers a
 * scoped agent-status refresh so the caller re-reads fresh detection without
 * an app restart.
 */
export function runNativeAgentInstall(input: {
  agentKind: string;
  label: string;
  project?: Parameters<typeof runAgentInstallCommand>[0]["project"];
  /** `true` when the installer exited cleanly and detection refreshed. */
  onComplete?: (ok: boolean) => void;
}): boolean {
  const entry = NATIVE_AGENT_REGISTRY_ENTRIES.find((candidate) => candidate.id === input.agentKind);
  if (!entry) {
    toast.danger(
      `${input.label} 不支持在应用内直接安装，请在设置的 Agents 或 ACP 注册表中手动安装。`,
    );
    input.onComplete?.(false);
    return false;
  }
  const opened = runAgentInstallCommand({
    label: input.label,
    command: entry.installCommand,
    ...(input.project ? { project: input.project } : {}),
    purpose: "install",
    onCommandComplete: (exitCode) => {
      if (exitCode !== 0) {
        toast.danger(
          `${input.label} 安装命令以退出码 ${exitCode} 结束，请查看安装终端中的真实输出。`,
        );
        input.onComplete?.(false);
        return;
      }
      void readBridge()
        .refreshAgentStatuses(currentWslDistros(), { agentKinds: [input.agentKind] })
        .then(() => input.onComplete?.(true))
        .catch((error) => {
          toast.danger(
            error instanceof Error ? error.message : `${input.label} 安装后状态刷新失败。`,
          );
          input.onComplete?.(false);
        });
    },
  });
  return opened;
}
