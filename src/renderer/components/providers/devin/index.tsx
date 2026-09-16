export * from "./DevinIcon";

import { DevinIcon } from "./DevinIcon";
import providerManifest from "./manifest";
import { standardPlanApprovalControls } from "../composerControlBuilders";
import { registerProviderIcon } from "../ProviderIcon";
import { registerComposerControls } from "../providerComposer";
import { registerCommitGenDefaults } from "../commitGen";
import { registerConflictResolverDefaults } from "../conflictResolver";
import { registerTitleGenDefaults } from "../titleGen";

const PROVIDER_KIND = providerManifest.kind;

registerProviderIcon(PROVIDER_KIND, DevinIcon);

const DEVIN_UTILITY_DEFAULTS = {
  label: "Devin",
  hint: "SWE-1.6",
  model: "swe",
  effort: "",
};

registerCommitGenDefaults(PROVIDER_KIND, DEVIN_UTILITY_DEFAULTS);
registerTitleGenDefaults(PROVIDER_KIND, DEVIN_UTILITY_DEFAULTS);
registerConflictResolverDefaults(PROVIDER_KIND, DEVIN_UTILITY_DEFAULTS);

registerComposerControls(PROVIDER_KIND, (input) => standardPlanApprovalControls(input));
