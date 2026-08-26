export * from "./CommandCodeIcon";

import { CommandCodeIcon } from "./CommandCodeIcon";
import providerManifest from "./manifest";
import { standardPlanApprovalControls } from "../composerControlBuilders";
import { registerProviderIcon } from "../ProviderIcon";
import { registerComposerControls } from "../providerComposer";
import { registerCommitGenDefaults } from "../commitGen";
import { registerConflictResolverDefaults } from "../conflictResolver";
import { registerTitleGenDefaults } from "../titleGen";

const PROVIDER_KIND = providerManifest.kind;

registerProviderIcon(PROVIDER_KIND, CommandCodeIcon);
// Command Code is usage-priced and gates Claude/GPT models behind paid plans:
// the previous defaults (gpt-5.4-mini, claude-sonnet-4-6, google/gemini-3.1-flash-
// lite) all return "403 MODEL_NOT_IN_PLAN" on the base plan, so Auto generation
// failed outright. Picks below are open-source models available on every plan.
// `deepseek-v4-flash` is Command Code's own default — the cheap, ungated baseline
// that a local benchmark confirmed is fast and types commits correctly; the
// "-Fast"/"-Highspeed" tiers (e.g. GLM-5.2-Fast) are quicker but cost more, so
// they're not worth it for frequent title/commit runs. `deepseek-v4-pro` adds
// reasoning for the rarer, heavier conflict resolver. Pro users can override.
registerCommitGenDefaults(PROVIDER_KIND, {
  label: "Command Code",
  hint: "DeepSeek V4 Flash",
  model: "deepseek/deepseek-v4-flash",
  effort: "",
});
registerTitleGenDefaults(PROVIDER_KIND, {
  label: "Command Code",
  hint: "DeepSeek V4 Flash",
  model: "deepseek/deepseek-v4-flash",
  effort: "",
});
registerConflictResolverDefaults(PROVIDER_KIND, {
  label: "Command Code",
  hint: "DeepSeek V4 Pro",
  model: "deepseek/deepseek-v4-pro",
  effort: "",
});

registerComposerControls(PROVIDER_KIND, (input) => standardPlanApprovalControls(input));
