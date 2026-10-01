import { startTransition } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ToggleSwitch } from "@/renderer/components/common";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { SettingRow } from "./SettingsForm";

/**
 * 「自动更新 CLI」：版本检查发现更新时自动执行各 agent CLI 的更新管线
 * （与右上角手动更新同一通道）。默认开启；关闭只停后台自动路径，不影响
 * 标题栏 / Harness 面板里的手动更新按钮。
 */
export function AgentCliAutoUpdateSection() {
  const { t } = useLingui();
  const autoUpdateAgentClis = useSharedSettings((state) => state.autoUpdateAgentClis);
  const setAutoUpdateAgentClis = useSharedSettings((state) => state.setAutoUpdateAgentClis);

  return (
    <SettingRow
      anchorId="agentsGeneral.autoUpdateClis"
      title={t`Auto-update CLIs`}
      description={
        <Trans>
          When a version check finds a newer release, update each agent CLI automatically —
          including account-pool managed binaries. Manual update stays available either way.
        </Trans>
      }
    >
      <ToggleSwitch
        aria-label={t`Auto-update CLIs`}
        isSelected={autoUpdateAgentClis}
        onChange={(selected) => {
          startTransition(() => {
            setAutoUpdateAgentClis(selected);
          });
        }}
      />
    </SettingRow>
  );
}
