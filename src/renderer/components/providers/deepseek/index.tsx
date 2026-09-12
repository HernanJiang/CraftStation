export * from "./DeepSeekIcon";

import { DeepSeekIcon } from "./DeepSeekIcon";
import providerManifest from "./manifest";
import { standardPlanApprovalControls } from "../composerControlBuilders";
import { registerProviderIcon } from "../ProviderIcon";
import { registerComposerControls } from "../providerComposer";
import { registerCommitGenDefaults } from "../commitGen";
import { registerConflictResolverDefaults } from "../conflictResolver";
import { registerTitleGenDefaults } from "../titleGen";

const PROVIDER_KIND = providerManifest.kind;

registerProviderIcon(PROVIDER_KIND, DeepSeekIcon);

const DEEPSEEK_UTILITY_DEFAULTS = {
  label: "DeepSeek Harness",
  hint: "V4 Flash",
  model: "deepseek-v4-flash",
  effort: "high",
};

registerCommitGenDefaults(PROVIDER_KIND, DEEPSEEK_UTILITY_DEFAULTS);
registerTitleGenDefaults(PROVIDER_KIND, DEEPSEEK_UTILITY_DEFAULTS);
registerConflictResolverDefaults(PROVIDER_KIND, {
  ...DEEPSEEK_UTILITY_DEFAULTS,
  hint: "V4 Pro",
  model: "deepseek-v4-pro",
});

registerComposerControls(PROVIDER_KIND, (input) => standardPlanApprovalControls(input));
