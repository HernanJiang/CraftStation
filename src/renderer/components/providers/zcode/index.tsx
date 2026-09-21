export * from "./ZCodeIcon";

import { ZCodeIcon } from "./ZCodeIcon";
import providerManifest from "./manifest";
import { standardPlanApprovalControls } from "../composerControlBuilders";
import { registerProviderIcon } from "../ProviderIcon";
import { registerComposerControls } from "../providerComposer";
import { registerCommitGenDefaults } from "../commitGen";
import { registerConflictResolverDefaults } from "../conflictResolver";
import { registerTitleGenDefaults } from "../titleGen";

const defaults = { label: "ZCode", hint: "GLM-5.3", model: "GLM-5.3", effort: "" };
registerProviderIcon(providerManifest.kind, ZCodeIcon);
registerComposerControls(providerManifest.kind, standardPlanApprovalControls);
registerCommitGenDefaults(providerManifest.kind, defaults);
registerTitleGenDefaults(providerManifest.kind, defaults);
registerConflictResolverDefaults(providerManifest.kind, defaults);
