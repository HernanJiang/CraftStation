export * from "./StepCodeIcon";

import { StepCodeIcon } from "./StepCodeIcon";
import providerManifest from "./manifest";
import { registerProviderIcon } from "../ProviderIcon";
import { registerCommitGenDefaults } from "../commitGen";
import { registerConflictResolverDefaults } from "../conflictResolver";
import { registerComposerControls } from "../providerComposer";
import { registerTitleGenDefaults } from "../titleGen";

// Step Code intentionally has no composer-owned plan mode or permission
// policy. Model and thinking controls come from the dynamically detected
// capabilities; optional extension commands are published by the live session.
registerProviderIcon(providerManifest.kind, StepCodeIcon);
// Step Code's built-in default model is the StepFun flagship, so utility
// tasks can always run even before `--list-models` has been probed.
const utilityDefaults = { label: "Step Code", model: "step/step-5-preview", effort: "" };
registerCommitGenDefaults(providerManifest.kind, utilityDefaults);
registerTitleGenDefaults(providerManifest.kind, utilityDefaults);
registerConflictResolverDefaults(providerManifest.kind, utilityDefaults);
registerComposerControls(providerManifest.kind, () => []);
