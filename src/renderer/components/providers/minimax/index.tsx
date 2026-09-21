export * from "./MiniMaxIcon";

import { MiniMaxIcon } from "./MiniMaxIcon";
import providerManifest from "./manifest";
import { standardPlanApprovalControls } from "../composerControlBuilders";
import { registerProviderIcon } from "../ProviderIcon";
import { registerComposerControls } from "../providerComposer";
import { registerCommitGenDefaults } from "../commitGen";
import { registerConflictResolverDefaults } from "../conflictResolver";
import { registerTitleGenDefaults } from "../titleGen";

const defaults = { label: "MiniMax", hint: "M3", model: "MiniMax-M3", effort: "" };
registerProviderIcon(providerManifest.kind, MiniMaxIcon);
registerComposerControls(providerManifest.kind, standardPlanApprovalControls);
registerCommitGenDefaults(providerManifest.kind, defaults);
registerTitleGenDefaults(providerManifest.kind, defaults);
registerConflictResolverDefaults(providerManifest.kind, defaults);
