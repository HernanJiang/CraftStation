export * from "./CopilotIcon";

import { CopilotIcon } from "./CopilotIcon";
import providerManifest from "./manifest";
import type { ComposerControl } from "@/renderer/components/thread/ThreadComposer";
import type { ThreadConfig } from "@/shared/contracts";
import { fullAccessToggle, planWorkToggle } from "../composerControlBuilders";
import { registerProviderIcon } from "../ProviderIcon";
import { registerComposerControls } from "../providerComposer";
import { registerCommitGenDefaults } from "../commitGen";
import { registerConflictResolverDefaults } from "../conflictResolver";
import { registerTitleGenDefaults } from "../titleGen";

const PROVIDER_KIND = providerManifest.kind;

registerProviderIcon(PROVIDER_KIND, CopilotIcon);
registerCommitGenDefaults(PROVIDER_KIND, {
  label: "Copilot",
  hint: "auto",
  model: "",
  effort: "",
});
registerTitleGenDefaults(PROVIDER_KIND, {
  label: "Copilot",
  hint: "auto",
  model: "",
  effort: "",
});
registerConflictResolverDefaults(PROVIDER_KIND, {
  label: "Copilot",
  hint: "auto",
  model: "",
  effort: "",
});

// Copilot calls the unrestricted state "Autopilot" in its CLI/docs, but the
// composer uses the shared permission wording across providers.
function copilotPermissionToggle({
  config,
  isDisabled,
  onConfigChange,
}: {
  config: ThreadConfig;
  isDisabled: boolean;
  onConfigChange: (patch: Partial<ThreadConfig>) => void;
}): ComposerControl {
  return fullAccessToggle({
    isFullAccess: (config.approvalPolicy ?? "never") === "never",
    isDisabled,
    onChange: (isSelected) => onConfigChange({ approvalPolicy: isSelected ? "never" : "default" }),
  });
}

registerComposerControls(PROVIDER_KIND, {
  // Plan toggle is shared: ACP exposes it as a session mode and the CLI maps
  // it to a `/plan` slash-command prefix. Both surfaces accept the same
  // `mode: "plan"` config value.
  shared: ({ capabilities, config, isDisabled, onConfigChange }) =>
    capabilities.modes.includes("plan")
      ? [
          planWorkToggle({
            isPlanMode: config.mode === "plan",
            isDisabled,
            onChange: (isSelected) => onConfigChange({ mode: isSelected ? "plan" : "agent" }),
          }),
        ]
      : [],
  // ACP exposes Plan/Agent/Autopilot as a single mutually-exclusive
  // session-mode field. Full access is now visible even while Plan is on
  // so users can pre-configure it; the runtime handles mapping this
  // to the correct implementation mode upon plan approval.
  gui: ({ config, isDisabled, onConfigChange }) => [
    copilotPermissionToggle({ config, isDisabled, onConfigChange }),
  ],
  // CLI: `/plan` and `--yolo` are independent flags, so full access is always
  // available regardless of Plan state.
  terminal: ({ config, isDisabled, onConfigChange }) => [
    copilotPermissionToggle({ config, isDisabled, onConfigChange }),
  ],
});
