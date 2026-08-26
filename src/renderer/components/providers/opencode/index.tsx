export * from "./OpenCodeIcon";

import { OpenCodeIcon } from "./OpenCodeIcon";
import providerManifest from "./manifest";
import type { ComposerControl } from "@/renderer/components/thread/ThreadComposer";
import { fullAccessToggle, planWorkToggle } from "../composerControlBuilders";
import { registerProviderIcon } from "../ProviderIcon";
import { registerComposerControls } from "../providerComposer";
import { registerCommitGenDefaults } from "../commitGen";
import { registerConflictResolverDefaults } from "../conflictResolver";
import { registerTitleGenDefaults } from "../titleGen";

// `big-pickle` is OpenCode's free always-on house model — every other model
// in `opencode models` is gated behind a user-configured paid provider, so
// it's the only safe out-of-the-box default for commit / title / conflict
// auto-runs. Users can still override per-thread. Supervisor side has its
// own copy at `src/supervisor/agents/opencode/index.ts`; keep them in sync.
const OPENCODE_DEFAULT_MODEL = "opencode/big-pickle";

const PROVIDER_KIND = providerManifest.kind;

registerProviderIcon(PROVIDER_KIND, OpenCodeIcon);
registerCommitGenDefaults(PROVIDER_KIND, {
  label: "OpenCode",
  hint: "Big Pickle",
  model: OPENCODE_DEFAULT_MODEL,
  effort: "",
});
registerTitleGenDefaults(PROVIDER_KIND, {
  label: "OpenCode",
  hint: "Big Pickle",
  model: OPENCODE_DEFAULT_MODEL,
  effort: "",
});
registerConflictResolverDefaults(PROVIDER_KIND, {
  label: "OpenCode",
  hint: "Big Pickle",
  model: OPENCODE_DEFAULT_MODEL,
  effort: "",
});

registerComposerControls(PROVIDER_KIND, {
  // Plan toggle — wired on both surfaces. GUI threads forward it via
  // `agent: "plan"` on `prompt_async`; TUI threads pass `--agent plan` at
  // launch (see `buildOpenCodeArgs`).
  shared: ({ capabilities, config, isDisabled, onConfigChange }) => {
    const controls: ComposerControl[] = [];
    if (capabilities.modes.includes("plan")) {
      controls.push(
        planWorkToggle({
          isPlanMode: config.mode === "plan",
          isDisabled,
          onChange: (isSelected) => onConfigChange({ mode: isSelected ? "plan" : "agent" }),
        }),
      );
    }
    return controls;
  },
  // Full Access (yolo) is only honored on the GUI surface, where the SDK
  // runtime maps it to an allow-all permission override on `session.create`.
  // Supervised GUI threads omit the override so OpenCode uses its global +
  // project config permissions. The default TUI command (`opencode [project]`)
  // has no equivalent launch flag — the `--dangerously-skip-permissions` flag
  // exists only on `opencode run`. Hide the toggle on terminal threads so it
  // can't be set silently to no effect.
  gui: ({ config, isDisabled, onConfigChange }) => [
    fullAccessToggle({
      isFullAccess: config.approvalPolicy === "yolo",
      isDisabled,
      onChange: (isSelected) => onConfigChange({ approvalPolicy: isSelected ? "yolo" : "default" }),
    }),
  ],
});
