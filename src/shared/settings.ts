import { z } from "zod";
import { allUsageProviderDescriptors } from "@craftstation/agents-usage/providers";
import {
  agentInstanceConfigMapSchema,
  installedAcpRegistryAgentSchema,
  builtInMcpDisabledToolsSchema,
  builtInMcpServerDisabledSchema,
  gitReviewModeSchema,
  prCreateModeSchema,
  commitDefaultActionSchema,
  newThreadModeSchema,
  notificationFilterSchema,
  prAutomationModeSchema,
  prMergeMethodSchema,
  providerDraftConfigSchema,
  terminalPositionSchema,
  themeModeSchema,
  threadPresentationModeSchema,
  threadRemoveActionSchema,
  worktreeStorageModeSchema,
  mcpServerListSchema,
  installedPluginsSchema,
  workspaceListSchema,
} from "./contracts";
import { DEFAULT_SEARCH_EXCLUDE } from "./searchExclude";
import { AI_LANGUAGE_VALUES, LOCALE_SETTING_VALUES } from "./locale";
import { QWEN_DEFAULT_MODEL_ID, QWEN_RETIRED_PREVIEW_MODEL_ID } from "./agents/qwenModels";

export const WINDOWS_SHELL_AUTO = "auto";
export const WINDOWS_SHELL_ARGUMENTS_MAX = 8_192;
/** Max characters for the user-defined global prompt (global AGENTS.md equivalent). */
export const CUSTOM_GLOBAL_PROMPT_MAX = 8_192;
export type WindowsShellKind = "pwsh" | "powershell" | "cmd";

export interface AvailableWindowsShell {
  path: string;
  kind: WindowsShellKind;
  /** Product/folder version when known, e.g. "7.2" or "7.6.1". */
  version?: string;
}

const modelPickerEntrySchema = z.object({
  agentKind: z.string().min(1),
  modelId: z.string().min(1),
  presentationMode: threadPresentationModeSchema.default("terminal"),
});

export const agentSelectionUsageEntrySchema = z.object({
  agentKind: z.string().min(1),
  modelId: z.string().min(1),
  effort: z.string().optional(),
  fast: z.boolean().default(false),
  count: z.number().int().positive(),
  lastUsedAt: z.number().int().nonnegative(),
});
export type AgentSelectionUsageEntry = z.infer<typeof agentSelectionUsageEntrySchema>;

export const providerModelPreferenceSchema = z.object({
  effort: z.string().optional(),
  fast: z.boolean().optional(),
});
export type ProviderModelPreference = z.infer<typeof providerModelPreferenceSchema>;

export const defaultPermissionModeSchema = z.enum(["ask", "full-access"]);
export type DefaultPermissionMode = z.infer<typeof defaultPermissionModeSchema>;

export const MAX_CROSSAGENT_ROUTING_OVERRIDES = 100;
export const MAX_CROSSAGENT_SELECTION_VALUE_LENGTH = 256;

/** Sentinel entry pinning the native-harness lane in the user route order. */
export const OWN_SUBAGENTS_NATIVE_ROUTE_ID = "native";

export const crossagentSelectionUsageEntrySchema = agentSelectionUsageEntrySchema.extend({
  /** Normalized task classifications supplied by the calling agent. */
  tags: z.array(z.string().min(1).max(32)).max(5).optional(),
  /**
   * Fields the caller actually supplied. Missing on legacy entries, which are
   * treated as fully explicit to preserve their existing ranking behavior.
   */
  explicitFields: z
    .object({
      provider: z.boolean(),
      model: z.boolean(),
      effort: z.boolean(),
      fast: z.boolean(),
    })
    .optional(),
});
export type CrossagentSelectionUsageEntry = z.infer<typeof crossagentSelectionUsageEntrySchema>;

export const crossagentSelectionUsageEntryKeySchema = crossagentSelectionUsageEntrySchema
  .pick({
    agentKind: true,
    modelId: true,
    effort: true,
    fast: true,
    tags: true,
    explicitFields: true,
  })
  .extend({
    agentKind: z.string().min(1).max(MAX_CROSSAGENT_SELECTION_VALUE_LENGTH),
    modelId: z.string().min(1).max(MAX_CROSSAGENT_SELECTION_VALUE_LENGTH),
    fast: z.boolean(),
  });
export type CrossagentSelectionUsageEntryKey = z.infer<
  typeof crossagentSelectionUsageEntryKeySchema
>;

export const crossagentRoutingOverrideSchema = z.object({
  tags: z.array(z.string().min(1).max(32)).min(1).max(5),
  agentKind: z.string().min(1).max(MAX_CROSSAGENT_SELECTION_VALUE_LENGTH),
  modelId: z.string().min(1).max(MAX_CROSSAGENT_SELECTION_VALUE_LENGTH).optional(),
  effort: z.string().min(1).max(MAX_CROSSAGENT_SELECTION_VALUE_LENGTH).optional(),
  fast: z.boolean().optional(),
  updatedAt: z.number().int().nonnegative(),
});
export type CrossagentRoutingOverride = z.infer<typeof crossagentRoutingOverrideSchema>;

/**
 * Cache entry recording whether a given agent supports the **CLI hook plugin**
 * path for status detection on this machine. Keyed by `AgentKind` (and for
 * WSL, by distro) in `agentHookSupport`. The cache is invalidated when ANY of
 * `agentBinaryVersion` / `pluginVersion` / `protocolVersion` change, or when
 * `process.platform` differs from the last recorded value (avoids carrying a
 * stale `supportsL1=true` verdict to a machine where the plugin isn't
 * installed). The JSON field name `supportsL1` is historical.
 */
export const agentHookSupportEntrySchema = z.object({
  agentBinaryVersion: z.string(),
  pluginVersion: z.string(),
  protocolVersion: z.number().int().min(1),
  platform: z.string(),
  verifiedAt: z.string(),
  supportsL1: z.boolean(),
});
export type AgentHookSupportEntry = z.infer<typeof agentHookSupportEntrySchema>;

export const browserLinkOpenTargetSchema = z.enum(["internal", "system"]);
export type BrowserLinkOpenTarget = z.infer<typeof browserLinkOpenTargetSchema>;

export const browserLinkPresentationModeSchema = z.enum(["panel", "overlay"]);
export type BrowserLinkPresentationMode = z.infer<typeof browserLinkPresentationModeSchema>;

const browserSettingsSchema = z.object({
  /**
   * Gate for the MCP `eval` tool. When false (default) the tool
   * returns a "disabled" error to the agent. Off-by-default because eval
   * gives the agent arbitrary script execution in the embedded page.
   */
  allowEval: z.boolean().default(false),
  /**
   * Gate for the MCP `cookies` / `storage` tools. When
   * false (default) those tools refuse to operate. Off-by-default because
   * cookies can include session tokens; storage can include auth state.
   */
  allowDataAccess: z.boolean().default(false),
  /** Where target=_blank / popup links from the embedded browser are opened. */
  linkOpenTarget: browserLinkOpenTargetSchema.default("internal"),
  /** Where to reveal the embedded browser when opening links internally. */
  linkPresentationMode: browserLinkPresentationModeSchema.default("panel"),
});

export const audioTranscriptionModelSchema = z.preprocess(
  (value) =>
    value === "small" || value === "moonshine-tiny" || value === "moonshine-base" ? "tiny" : value,
  z.enum(["tiny", "base"]),
);
export type AudioTranscriptionModel = z.infer<typeof audioTranscriptionModelSchema>;

const audioSettingsSchema = z.object({
  /** Show the composer microphone button. */
  showVoiceInputButton: z.boolean().default(true),
  /** Empty string means the OS/browser default microphone. */
  microphoneDeviceId: z.string().default(""),
  /** Speech-to-text language code, for example "en", "es", or "fr". */
  transcriptionLanguage: z.string().default("en"),
  /** Model used for local composer dictation. */
  transcriptionModel: audioTranscriptionModelSchema.default("tiny"),
  /** Prefer WebGPU acceleration for local speech-to-text when available. */
  useWebGpu: z.boolean().default(true),
});

const usageSettingsSchema = z.object({
  /** Auto-refresh provider usage on a background timer. */
  autoRefresh: z.boolean().default(true),
  /**
   * Default minutes between auto-refreshes, used for any provider without its
   * own `providerRefreshIntervals` override. Floored at 2 to respect provider
   * 429 limits.
   */
  refreshIntervalMinutes: z.number().int().min(2).max(120).default(5),
  /**
   * Per-provider auto-refresh cadence override (minutes), keyed by provider id.
   * A provider absent from this map uses the global `refreshIntervalMinutes`.
   * Values are floored at 2 (provider 429 limits) and capped at 120; the UI
   * removes a provider's entry to fall back to the default rather than storing 0.
   */
  providerRefreshIntervals: z.record(z.string(), z.number().int().min(2).max(120)).default({}),
  /**
   * Show estimated $ cost (reconstructed from local logs at public API rates).
   * Opt-in and panel-only — it is meaningless for subscription/OAuth users.
   */
  showEstimatedCost: z.boolean().default(false),
  /** Show the per-provider usage circles in the sidebar (master toggle). */
  showInSidebar: z.boolean().default(true),
  /**
   * Provider ids whose sidebar circle the user hid individually. The provider is
   * still tracked and still shown in the usage panel — only its sidebar ring is
   * omitted. Gated under the `showInSidebar` master toggle.
   */
  sidebarHiddenProviders: z.array(z.string()).default([]),
  /** Provider ids the user turned OFF for usage tracking. Fresh installs start with Claude/Codex on. */
  disabledProviders: z.array(z.string()).default([]),
  /**
   * User-defined display order for providers in the usage panel. Providers not
   * in this list fall back to the built-in default order at the tail.
   */
  providerOrder: z.array(z.string()).default([]),
  /** Provider ids the user collapsed to a compact row in the usage panel. */
  collapsedProviders: z.array(z.string()).default([]),
  /**
   * For providers whose circle can show one of several ring groups (e.g.
   * Antigravity's Gemini vs Claude+GPT quota groups), the group key the user
   * picked, keyed by provider id. Absent = the provider's default (first) group.
   * Right-clicking the sidebar circle swaps this.
   */
  selectedRingGroups: z.record(z.string(), z.string()).default({}),
});
export type UsageSettings = z.infer<typeof usageSettingsSchema>;

export const DEFAULT_USAGE_ENABLED_PROVIDER_IDS = ["claude", "codex"] as const;
const DEFAULT_USAGE_ENABLED_PROVIDER_ID_SET = new Set<string>(DEFAULT_USAGE_ENABLED_PROVIDER_IDS);
export const DEFAULT_USAGE_DISABLED_PROVIDER_IDS = allUsageProviderDescriptors()
  .map((provider) => provider.id)
  .filter((id) => !DEFAULT_USAGE_ENABLED_PROVIDER_ID_SET.has(id));

export const SIDEBAR_SHORTCUT_IDS = ["pullRequests", "githubActions", "schedules"] as const;
export type SidebarShortcutId = (typeof SIDEBAR_SHORTCUT_IDS)[number];

export function normalizeSidebarShortcutOrder(
  order: readonly SidebarShortcutId[],
): SidebarShortcutId[] {
  const normalized = [...new Set(order)];
  for (const id of SIDEBAR_SHORTCUT_IDS) {
    if (!normalized.includes(id)) normalized.push(id);
  }
  return normalized;
}

/**
 * Top titlebar shortcut pins. `settings.<section>` deep-links a Settings page
 * (see `SettingsSection`), `crafting` opens the Crafting Station workspace
 * tab, `modelUsage` opens the model & usage dialog, `settingsHome` opens the
 * Settings overlay itself. Free-form strings so future registry items need no
 * schema bump; unknown ids are ignored at resolve time. Unlike the sidebar
 * order, missing ids are never re-appended: removing a default pin must stick
 * across restarts.
 */
export const DEFAULT_TOP_SHORTCUT_ORDER: readonly string[] = [
  "crafting",
  "settings.mcpServers",
  "settingsHome",
];

export function normalizeTopShortcutOrder(order: readonly string[] | undefined): string[] {
  const base = order ?? DEFAULT_TOP_SHORTCUT_ORDER;
  return [...new Set(base.map((id) => id.trim()).filter((id) => id.length > 0))];
}

export const sharedSettingsSchema = z.object({
  themeMode: themeModeSchema,
  /**
   * Selected app theme preset id (see `renderer/theme/themePresets`). The
   * matching light/dark variant is chosen by `themeMode`. Free-form string so
   * the catalog can grow without a schema bump; unknown ids fall back to the
   * base "default" theme at apply time.
   */
  themePreset: z.string(),
  /**
   * UI language. `"system"` follows the OS/browser preferred language at
   * runtime (resolved by `resolveLocale`), mirroring `themeMode: "system"`.
   */
  locale: z.enum(LOCALE_SETTING_VALUES).default("system"),
  /**
   * Language for AI-generated git text (commit messages, PR title/description).
   * `"match-app"` follows the resolved UI `locale`; any other value pins a
   * specific language. Defaults to `"en"` so shared/team-facing artifacts stay
   * English regardless of the interface language. Thread titles and other
   * "conversation" text instead always follow the app language and are not
   * governed by this setting.
   */
  gitTextLanguage: z.enum(AI_LANGUAGE_VALUES).default("en"),
  /**
   * User-defined global prompt, visible to every conversation like a global
   * AGENTS.md. Empty (default) means no extra injection beyond the implicit
   * language directive. Trimmed at read time; blank stays disabled.
   */
  customGlobalPrompt: z.string().max(CUSTOM_GLOBAL_PROMPT_MAX).default(""),
  terminalPosition: terminalPositionSchema,
  /** Absolute detected executable path, or "auto" for preferred-shell detection. */
  windowsShellPath: z.string(),
  /** PowerShell host used for internal commands and agent launch wrappers. */
  windowsInternalShellPath: z.string(),
  /** Additional argv passed directly to each interactive Windows shell. */
  windowsShellArguments: z.string().max(WINDOWS_SHELL_ARGUMENTS_MAX),
  commitGenProvider: z.string(),
  commitGenModel: z.string(),
  commitGenEffort: z.string(),
  /** Run commit-message generation in fast mode (Opus-only; ignored otherwise). */
  commitGenFast: z.boolean(),
  titleGenProvider: z.string(),
  titleGenModel: z.string(),
  titleGenEffort: z.string(),
  /** Run title generation in fast mode (Opus-only; ignored otherwise). */
  titleGenFast: z.boolean(),
  conflictResolverProvider: z.string(),
  conflictResolverModel: z.string(),
  conflictResolverEffort: z.string(),
  /** Launch the conflict-resolver session in fast mode (Opus-only; ignored otherwise). */
  conflictResolverFast: z.boolean(),
  /** Last model configuration used to judge an experiment. */
  experimentJudgeProvider: z.string(),
  experimentJudgeModel: z.string(),
  experimentJudgeEffort: z.string(),
  experimentJudgeFast: z.boolean(),
  /**
   * Where "Fix in Agent" opens the conflict-resolver thread: structured chat
   * (`gui`) or terminal-native (`terminal`). Defaults to `gui`. If the resolved
   * provider doesn't support the chosen mode, the consumer falls back to the
   * provider's default presentation mode.
   */
  conflictResolverPresentationMode: threadPresentationModeSchema,
  wslCommitGenProvider: z.string(),
  wslCommitGenModel: z.string(),
  wslCommitGenEffort: z.string(),
  wslCommitGenFast: z.boolean(),
  wslTitleGenProvider: z.string(),
  wslTitleGenModel: z.string(),
  wslTitleGenEffort: z.string(),
  wslTitleGenFast: z.boolean(),
  wslConflictResolverProvider: z.string(),
  wslConflictResolverModel: z.string(),
  wslConflictResolverEffort: z.string(),
  wslConflictResolverFast: z.boolean(),
  wslConflictResolverPresentationMode: threadPresentationModeSchema,
  /** Per-agent settings keyed by agent kind, then setting key. */
  agentSettings: z.record(z.string(), z.record(z.string(), z.union([z.boolean(), z.string()]))),
  /** Permission posture applied to every provider/model when a draft is opened. */
  defaultPermissionMode: defaultPermissionModeSchema,
  /** Per-agent hidden model IDs keyed by agent kind. */
  hiddenModels: z.record(z.string(), z.array(z.string())),
  /**
   * Per-agent explicitly-shown model IDs keyed by agent kind. For channels
   * declaring `defaultHiddenModels` (curated-discovery, e.g. OpenCode) a model
   * is visible only when listed here — freshly discovered models stay out of
   * the picker until the user checks them in 管理模型.
   */
  shownModels: z.record(z.string(), z.array(z.string())),
  /**
   * 用户在「管理模型」页添加的自定义模型：按渠道（agent kind）追加到首页模型
   * 选择器，并带用户选择的上下文档位（""＝默认最高，其余如 "128K"/"1M"）。
   */
  customModels: z
    .array(
      z.object({
        id: z.string().min(1),
        provider: z.string().min(1),
        /** Optional usage-account binding for key/Base-URL backed model channels. */
        accountId: z.string().min(1).optional(),
        /** User-defined channel name (for example "Chiral-API"). */
        channelLabel: z.string().min(1).optional(),
        modelId: z.string().min(1),
        displayName: z.string().min(1),
        contextSize: z.string(),
        /** 最大输出 Token（""＝默认）。 */
        maxOutputTokens: z.string().optional(),
        /** 思考强度档位（空＝跟随渠道默认；各厂商档位见 VENDOR_EFFORT_PRESETS）。 */
        efforts: z.array(z.string().min(1)).optional(),
        /** 默认思考强度（需在档位内）。 */
        defaultEffort: z.string().min(1).optional(),
        /** 输入模态（默认 ["text"]；"text" 恒选不可取消）。 */
        inputModalities: z.array(z.string().min(1)).optional(),
        /** 输出模态（默认 ["text"]）。 */
        outputModalities: z.array(z.string().min(1)).optional(),
      }),
    )
    .default([]),
  /** Agent kinds that the user has disabled (hidden from the agent picker). */
  disabledAgents: z.array(z.string()),
  /**
   * Per-provider default model, written ONLY on explicit menu picks. Fresh
   * drafts open on the model list's first entry; a stored
   * providerConfigs/last-draft model may be an auto-persisted default and is
   * never treated as the default. Starts empty so one stale pin (e.g. an old
   * big-pickle default) can never resurrect itself.
   */
  defaultModels: z.record(z.string(), z.string()),
  /**
   * User-defined display order for providers in the model picker. Provider kinds not in this
   * list fall back to the built-in default order at the tail.
   */
  providerOrder: z.array(z.string()),
  /** User-installed registry agents keyed by ACP registry id. */
  acpRegistryInstalledAgents: z.record(z.string(), installedAcpRegistryAgentSchema),
  /** User-registered agent instances, currently used by generic ACP registry installs. */
  agentInstances: agentInstanceConfigMapSchema,
  /** When true, the composer in terminal-native threads starts collapsed. */
  collapseTerminalComposer: z.boolean(),
  /**
   * Where a browser element-picker selection is delivered for a terminal-native
   * (CLI) thread. "ask" shows a chooser on pick (but a collapsed composer always
   * routes straight to the terminal); "terminal" always types it into the PTY
   * input line; "composer" always stages it in the composer attachment bar.
   */
  cliPickerTarget: z.enum(["ask", "terminal", "composer"]),
  /** Idle minutes before a hidden resumable thread is unloaded. 0 disables auto-unload. */
  staleThreadUnloadMinutes: z.number().int().min(0),
  /**
   * Craft-Harness turn retry policy: how many times a turn that failed on a
   * network/transport interruption is automatically retried by the supervisor
   * (harness-agnostic, outer runtime layer). 0 disables automatic retries.
   */
  turnRetryMaxAttempts: z.number().int().min(0).max(10),
  /** Seconds to wait between automatic turn retry attempts. */
  turnRetryIntervalSeconds: z.number().int().min(1).max(300),
  /** Days a thread can stay marked done before it is auto-archived. 0 disables auto-archive. */
  autoArchiveDoneAfterDays: z.number().int().min(0),
  /**
   * Archived-thread auto-delete policy, evaluated strictly from `archivedAt`.
   * `immediate` permanent-deletes on archive; `forever` (null window) never
   * auto-deletes but still records `archivedAt`. Default `7d`.
   */
  archiveRetention: z.enum(["immediate", "3d", "7d", "15d", "30d", "forever"]).default("7d"),
  /** Terminal scrollback scroll speed multiplier. */
  scrollSpeed: z.number().int().min(1).max(10),
  /** Base font size for agent terminals. Auto-shrinks in narrow/short panes. */
  agentTerminalFontSize: z.number().int().min(8).max(20),
  /** Base font size for agent thread chat (GUI / ACP markdown surface), in px. */
  guiChatFontSize: z.number().int().min(8).max(20),
  /** Whole-app UI zoom factor (Ctrl +/-), applied to the entire renderer. */
  zoomFactor: z.number().min(0.5).max(2),
  /** Base font size for the dev terminal panel. Auto-shrinks in narrow/short panes. */
  terminalPanelFontSize: z.number().int().min(8).max(20),
  /**
   * When to prevent the OS from sleeping while CraftStation is running.
   * - "while-working": only while a thread is actively working
   * - "while-remote-access": while remote access is enabled or a thread is working
   * - "always": keep the machine awake whenever the app is running
   */
  preventSleep: z.enum(["while-working", "while-remote-access", "always"]),
  /** Register CraftStation to launch automatically when the user signs in to Windows. */
  launchAtStartup: z.boolean(),
  /** Keep the main window hidden when CraftStation is launched automatically at sign-in. */
  startMinimized: z.boolean(),
  /**
   * When true, closing the main window hides CraftStation to the system tray
   * instead of quitting. The tray icon's Quit action (or Quit from the app
   * menu) still exits the process.
   */
  closeToTray: z.boolean(),
  /** Enable the desktop's remote access server for paired mobile/browser clients. */
  remoteAccessEnabled: z.boolean(),
  /**
   * Advertise a Tailscale MagicDNS HTTPS URL for remote access. When enabled and
   * the local Tailscale daemon is healthy, the app runs `tailscale serve` to
   * reverse-proxy `https://<machine>.<tailnet>.ts.net` to the local remote-access
   * port and advertises that secure URL in pairing info. Desktop/server-lifecycle
   * only — deliberately excluded from the remote-editable settings subset.
   */
  remoteAccessTailscaleHttps: z.boolean(),
  /**
   * Custom advertised base URL (origin only, http/https) for remote access, e.g.
   * a Cloudflare named tunnel or reverse proxy. Empty means automatic. Desktop/
   * server-lifecycle only — never remotely writable.
   */
  remoteAccessAdvertisedUrl: z.string(),
  /** Default action for the thread remove button: archive or delete permanently. */
  threadRemoveAction: threadRemoveActionSchema,
  /**
   * Mark a worktree thread done as soon as its pull request is observed turning
   * merged. Only live transitions count — a PR already merged when the app
   * starts leaves the thread alone (the sidebar row offers a Done button).
   */
  autoMarkDoneOnPrMerge: z.boolean(),
  /** Default new-thread behaviour: full page or side-by-side panel. */
  newThreadMode: newThreadModeSchema,
  /** Show the projectless Home scope for OS-level agent sessions. */
  homeScopeEnabled: z.boolean(),
  /** Footer shortcuts hidden from both the expanded and collapsed sidebar. */
  sidebarHiddenShortcuts: z.array(z.enum(SIDEBAR_SHORTCUT_IDS)),
  /** Display order for shortcuts in the expanded and collapsed sidebar footer. */
  sidebarShortcutOrder: z.array(z.enum(SIDEBAR_SHORTCUT_IDS)),
  /**
   * Pinned shortcuts in the top titlebar, in display order. Absent = fresh
   * install, resolved to {@link DEFAULT_TOP_SHORTCUT_ORDER}; an explicitly
   * saved empty list stays empty (removed defaults never come back).
   */
  topShortcutOrder: z.array(z.string()).optional(),
  /**
   * Translucent ("liquid glass") sidebar. When on, the window uses a
   * native blur material where supported (macOS vibrancy, Windows 11 acrylic)
   * and an in-app translucent fallback elsewhere. Default on.
   */
  sidebarTranslucency: z.boolean(),
  /**
   * Per-appearance override for the translucent sidebar's frosting: the alpha
   * (0–100) of the `--sidebar-glass-tint` sidebar-background mix. Higher is more
   * frosted (holds the theme color); lower shows more of the blurred backdrop.
   * `null` keeps the built-in per-platform default (see styles.css). Applied
   * Windows-only — macOS vibrancy keeps its own tint.
   */
  sidebarGlassTint: z.object({
    light: z.number().int().min(0).max(100).nullable().default(null),
    dark: z.number().int().min(0).max(100).nullable().default(null),
  }),
  /** Automatically show the terminal panel when running commands or creating worktrees. */
  autoShowTerminalPanel: z.boolean(),
  /**
   * Where git worktrees are created: under a global root (`global`) or nested in
   * each project at `<project>/.craftstation/worktrees` (`project-relative`).
   */
  worktreeStorageMode: worktreeStorageModeSchema,
  /**
   * Custom global worktree root for native projects. Empty string = built-in
   * default (`~/.craftstation/worktrees`). Only used when `worktreeStorageMode` is
   * `global`.
   */
  worktreeBasePath: z.string(),
  /**
   * Custom global worktree root for WSL projects (a Linux path). Empty string =
   * WSL default (`~/.craftstation/worktrees` in the distro home). Only used when
   * `worktreeStorageMode` is `global`.
   */
  wslWorktreeBasePath: z.string(),
  /** Open git review as a right-side panel or a full page overlay. */
  gitReviewMode: gitReviewModeSchema,
  /**
   * Default "Create PR" action: open the dialog to edit details, or
   * auto-generate the summary and create the PR immediately. Doubles as the
   * sticky last-used choice for the Create PR split-button.
   */
  prCreateMode: prCreateModeSchema,
  /** Default automation applied to pull requests created from CraftStation. */
  prAutomationDefault: prAutomationModeSchema,
  /**
   * Sticky last-used merge method. The PR split-button and automatic PR
   * merging share this setting so automation matches the user's choice.
   */
  prMergeMethod: prMergeMethodSchema,
  /**
   * Sticky last-used primary commit action for the commit split-button,
   * remembered across sessions so it defaults to whatever the user picked last.
   */
  commitDefaultAction: commitDefaultActionSchema,
  /** Per-provider last-used draft config (model, effort, mode, etc.). App-wide. */
  providerConfigs: z.record(z.string(), providerDraftConfigSchema),
  /** Per-provider and model effort/Fast choices. App-wide. */
  providerModelPreferences: z.record(
    z.string(),
    z.record(z.string(), providerModelPreferenceSchema),
  ),
  /**
   * Per-provider last-picked thread presentation mode (terminal vs gui chat).
   * Read by ThreadDraftView so a provider that supports both modes remembers
   * the user's previous choice.
   */
  lastPresentationModeByAgent: z.record(z.string(), threadPresentationModeSchema),
  /**
   * Last-used parent directory for the create-project folder picker, keyed by
   * runtime (`"native"` or a WSL distro name). Preselected when browsing for a
   * new project; falls back to the runtime's home directory when absent.
   */
  lastUsedProjectDirs: z.record(z.string(), z.string()),
  /** Enable LSP language servers for the file editor (type checking, completions, etc.). */
  editorLspEnabled: z.boolean(),
  /** When true (VS Code default), the @file mention search honors `.gitignore`. */
  searchUseIgnoreFiles: z.boolean(),
  /**
   * Glob exclusions applied to the @file mention search. Keys are minimatch
   * globs. `true` keeps the pattern excluded; `false` is reserved for
   * per-project overrides that re-enable an inherited default.
   */
  searchExclude: z.record(z.string(), z.boolean()),
  notificationsEnabled: z.boolean(),
  notificationSound: z.boolean(),
  notificationFilter: notificationFilterSchema,
  notificationStatuses: z.object({
    done: z.boolean(),
    needsAttention: z.boolean(),
    error: z.boolean(),
  }),
  /**
   * When false, suppress notifications for terminal-presentation threads whose
   * status is derived from the OSC/heuristic fallback (L2) rather than the CLI
   * hook plugin (L1). L2 status is less precise, so users can opt out of its
   * noisier transitions.
   */
  notifyL2Cli: z.boolean(),
  /**
   * Send push notifications and iOS Live Activity updates to paired mobile
   * devices (via the hosted push gateway) on thread-state transitions. Distinct
   * from desktop OS notifications (`notificationsEnabled`).
   */
  remotePushEnabled: z.boolean(),
  /**
   * Redact thread titles and project names in remote push payloads (they
   * traverse the gateway and APNs), replacing them with generic text. The
   * WebSocket-connected foreground app still shows full detail.
   */
  remotePushRedactContent: z.boolean(),
  /**
   * User-defined project groupings ("Work", "Side Hustle", …), newest last.
   * Which one is *active* is not stored here but per-window (see the renderer's
   * `workspaceStore`), so switching in one window leaves the others alone.
   *
   * Not part of `remoteSettingsSchema`, so paired clients (mobile PWA) receive no
   * workspace list and therefore show every project — add it to that allowlist if
   * workspaces should scope remote sessions too.
   */
  workspaces: workspaceListSchema,
  /** User-starred (provider, presentation, model) entries surfaced at the top of the model picker. */
  favoriteModels: z.array(modelPickerEntrySchema),
  /**
   * Most-recent (provider, presentation, model) launches for the model picker. Newest first; the menu
   * caps to 5 entries that aren't already in `favoriteModels`.
   */
  recentModels: z.array(modelPickerEntrySchema),
  /** Popularity of user-launched provider/model configurations used as a Crossagents fallback. */
  agentSelectionUsage: z.array(agentSelectionUsageEntrySchema).default([]),
  /**
   * Popularity of explicit Own Subagents selections. Supervisor-managed so an
   * automatic choice can never reinforce itself and renderer writes cannot
   * overwrite a selection recorded by the MCP ingress.
   */
  ownSubagentSelectionUsage: z.array(crossagentSelectionUsageEntrySchema).default([]),
  /**
   * User-pinned task-tag routes managed by the Own Subagents MCP. The most
   * specific matching tag set wins before learned affinity.
   */
  ownSubagentRoutingOverrides: z
    .array(crossagentRoutingOverrideSchema)
    .max(MAX_CROSSAGENT_ROUTING_OVERRIDES)
    .default([]),
  /**
   * Agent kinds temporarily excluded from the Own Subagents routing rotation.
   * Unlike `disabledAgents` (which hides a provider everywhere), pausing only
   * affects Own Subagents delegation — e.g. park a provider until its quota
   * resets while keeping it in the normal composer picker.
   */
  ownSubagentPausedProviders: z.array(z.string()).default([]),
  /**
   * Extra hidden model ids keyed by agent kind, applied on top of the global
   * `hiddenModels` visibility filter but only for Own Subagents routing. The
   * Own Subagents settings model dropdown lists already-globally-visible models
   * and lets the user narrow them further here.
   */
  ownSubagentHiddenModels: z.record(z.string(), z.array(z.string())).default({}),
  /**
   * User-ordered Own Subagents route. Entries are provider kinds with the
   * special `"native"` entry for the current harness's own native subagent
   * lane. The native entry is system-owned and non-removable (re-inserted on
   * normalize when missing); an empty list means the default (native first,
   * then ranked providers). Survives restarts; drives AUTO selection after
   * explicit per-call values and persistent task routes.
   */
  ownSubagentsRouteOrder: z.array(z.string().min(1).max(64)).max(50).default([]),
  /**
   * Dev-only: force agents off the CLI hook plugin path (L1) so they fall back
   * to L2 terminal parsing. The UI toggle is only visible in the dev build;
   * the field is always present so the supervisor can read it unconditionally.
   */
  disableCliHookPlugin: z.boolean(),
  /** Draft composer hook-install proposals dismissed by provider/env key. */
  dismissedHookInstallProposals: z.record(z.string(), z.boolean()),
  /** Per-agent CLI hook plugin support cache. Keyed by AgentKind (and WSL distro when applicable). */
  agentHookSupport: z.record(z.string(), agentHookSupportEntrySchema),
  /**
   * Composer MCP servers the user has turned on persistently, keyed by composer
   * MCP id (`"browser"`, `"own-subagents"`, `"chrome"`, `"computer-use"`). `true` means the
   * server is on for every *new* thread whose provider/presentation supports it
   * (baked into `thread.config` at launch) and shows no composer chip — it is a
   * standing default rather than a per-thread opt-in. Absent/`false` leaves the
   * server off unless the draft explicitly `@`-mentions it, which stages a
   * removable chip for that one thread. Toggled by the composer "+" menu.
   */
  enabledMcpServers: z.record(z.string(), z.boolean()).default({ crossagents: true }),
  /** Custom MCP servers applied to every new thread unless overridden by its project. */
  mcpServers: mcpServerListSchema,
  /** Built-in MCP servers hard-disabled for all new launches. */
  disabledBuiltInMcpServers: builtInMcpServerDisabledSchema,
  /** Disabled tools for CraftStation-owned built-in MCP servers. */
  disabledBuiltInMcpTools: builtInMcpDisabledToolsSchema,
  /** First-party CraftStation plugins installed from the built-in marketplace. */
  installedPlugins: installedPluginsSchema,
  /**
   * In-app browser panel + agent MCP bridge settings. Whether the Browser MCP
   * attaches to a thread is decided per thread: a persistent default in
   * `enabledMcpServers.browser` or a one-off `@browser` mention, resolved to
   * `thread.config.browserMcp` at launch. These are the bridge/panel knobs.
   */
  browser: browserSettingsSchema,
  /** Local audio capture and speech-to-text settings. */
  audio: audioSettingsSchema,
  /** Provider usage tracking (auto-refresh cadence, per-provider opt-out, cost). */
  usage: usageSettingsSchema,
  /**
   * Free-text routing instructions appended to the Own Subagents MCP server
   * `instructions`, guiding how an agent picks which connected agent/model to
   * delegate to when spawning subagents (e.g. "Codex GPT-5.5 fast for quick
   * lookups, Claude Opus for anything subtle"). Empty string = no guidance.
   * Whether a thread gets the Own Subagents MCP lives on
   * `thread.config.crossagentMcp` (persistent default in
   * `enabledMcpServers.own_subagents` or an `@own_subagents` mention); this is
   * the global guidance text shared across every such thread.
   */
  ownSubagentRoutingGuide: z.string(),
});
export type SharedSettings = z.infer<typeof sharedSettingsSchema>;

/** When to prevent the OS from sleeping while CraftStation is running. */
export type PreventSleep = SharedSettings["preventSleep"];

/** Browser element-picker delivery target for terminal-native (CLI) threads. */
export type CliPickerTarget = SharedSettings["cliPickerTarget"];

/**
 * Settings as written by the renderer / IPC consumer. Excludes
 * supervisor-only fields (`agentHookSupport`) that the renderer never
 * manages and that the main process re-merges from disk on write.
 */
export type SharedSettingsInput = Omit<
  SharedSettings,
  "agentHookSupport" | "ownSubagentSelectionUsage" | "ownSubagentRoutingOverrides"
>;

export const defaultSharedSettings: SharedSettings = {
  themeMode: "dark",
  themePreset: "default",
  locale: "system",
  gitTextLanguage: "en",
  customGlobalPrompt: "",
  terminalPosition: "bottom",
  windowsShellPath: WINDOWS_SHELL_AUTO,
  windowsInternalShellPath: WINDOWS_SHELL_AUTO,
  windowsShellArguments: "",
  commitGenProvider: "auto",
  commitGenModel: "",
  commitGenEffort: "",
  commitGenFast: false,
  titleGenProvider: "auto",
  titleGenModel: "",
  titleGenEffort: "",
  titleGenFast: false,
  conflictResolverProvider: "auto",
  conflictResolverModel: "",
  conflictResolverEffort: "",
  conflictResolverFast: false,
  experimentJudgeProvider: "",
  experimentJudgeModel: "",
  experimentJudgeEffort: "",
  experimentJudgeFast: false,
  conflictResolverPresentationMode: "gui",
  wslCommitGenProvider: "auto",
  wslCommitGenModel: "",
  wslCommitGenEffort: "",
  wslCommitGenFast: false,
  wslTitleGenProvider: "auto",
  wslTitleGenModel: "",
  wslTitleGenEffort: "",
  wslTitleGenFast: false,
  wslConflictResolverProvider: "auto",
  wslConflictResolverModel: "",
  wslConflictResolverEffort: "",
  wslConflictResolverFast: false,
  wslConflictResolverPresentationMode: "gui",
  agentSettings: {},
  // New threads are unattended-friendly by default; Settings → General can
  // still downgrade this to "ask" for approval-gated launches.
  defaultPermissionMode: "full-access",
  hiddenModels: {},
  shownModels: {},
  customModels: [],
  disabledAgents: [],
  defaultModels: {},
  providerOrder: [],
  acpRegistryInstalledAgents: {},
  agentInstances: {},
  collapseTerminalComposer: false,
  cliPickerTarget: "ask",
  staleThreadUnloadMinutes: 60,
  turnRetryMaxAttempts: 2,
  turnRetryIntervalSeconds: 5,
  autoArchiveDoneAfterDays: 3,
  archiveRetention: "7d",
  scrollSpeed: 2,
  agentTerminalFontSize: 12,
  guiChatFontSize: 13,
  zoomFactor: 1,
  terminalPanelFontSize: 12,
  preventSleep: "while-remote-access",
  launchAtStartup: true,
  startMinimized: true,
  closeToTray: true,
  remoteAccessEnabled: false,
  remoteAccessTailscaleHttps: false,
  remoteAccessAdvertisedUrl: "",
  threadRemoveAction: "archive",
  autoMarkDoneOnPrMerge: true,
  newThreadMode: "page",
  homeScopeEnabled: true,
  sidebarHiddenShortcuts: ["githubActions"],
  sidebarShortcutOrder: [...SIDEBAR_SHORTCUT_IDS],
  sidebarTranslucency: true,
  sidebarGlassTint: { light: null, dark: null },
  autoShowTerminalPanel: true,
  worktreeStorageMode: "global",
  worktreeBasePath: "",
  wslWorktreeBasePath: "",
  gitReviewMode: "panel",
  prCreateMode: "dialog",
  prAutomationDefault: "off",
  prMergeMethod: "squash",
  commitDefaultAction: "commit-push",
  providerConfigs: {},
  providerModelPreferences: {},
  lastPresentationModeByAgent: {},
  lastUsedProjectDirs: {},
  editorLspEnabled: false,
  searchUseIgnoreFiles: true,
  searchExclude: { ...DEFAULT_SEARCH_EXCLUDE },
  notificationsEnabled: true,
  notificationSound: true,
  notificationFilter: "all",
  notificationStatuses: { done: true, needsAttention: true, error: true },
  notifyL2Cli: true,
  remotePushEnabled: true,
  remotePushRedactContent: false,
  workspaces: [],
  favoriteModels: [],
  recentModels: [],
  agentSelectionUsage: [],
  ownSubagentSelectionUsage: [],
  ownSubagentRoutingOverrides: [],
  ownSubagentPausedProviders: [],
  ownSubagentHiddenModels: {},
  ownSubagentsRouteOrder: [OWN_SUBAGENTS_NATIVE_ROUTE_ID],
  disableCliHookPlugin: false,
  dismissedHookInstallProposals: {},
  agentHookSupport: {},
  enabledMcpServers: { own_subagents: true, crossagents: true },
  mcpServers: [],
  disabledBuiltInMcpServers: {},
  disabledBuiltInMcpTools: {},
  installedPlugins: {},
  browser: {
    allowEval: false,
    allowDataAccess: false,
    linkOpenTarget: "internal",
    linkPresentationMode: "panel",
  },
  audio: {
    showVoiceInputButton: true,
    microphoneDeviceId: "",
    transcriptionLanguage: "en",
    transcriptionModel: "tiny",
    useWebGpu: true,
  },
  usage: {
    autoRefresh: true,
    refreshIntervalMinutes: 5,
    providerRefreshIntervals: {},
    showEstimatedCost: false,
    showInSidebar: true,
    sidebarHiddenProviders: [],
    disabledProviders: [...DEFAULT_USAGE_DISABLED_PROVIDER_IDS],
    providerOrder: [],
    collapsedProviders: [],
    selectedRingGroups: {},
  },
  ownSubagentRoutingGuide: "",
};

function parseSettingOrDefault<T>(schema: z.ZodType<T>, value: unknown, fallback: T): T {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

function normalizeObjectFromSchema<
  TShape extends z.ZodRawShape,
  TOutput extends z.infer<z.ZodObject<TShape>>,
>(shape: TShape, defaults: TOutput, value: unknown): TOutput {
  const parsed = z.record(z.string(), z.unknown()).safeParse(value);
  const data = parsed.success ? parsed.data : {};
  const normalized = {} as TOutput;

  for (const key of Object.keys(defaults) as (keyof TOutput)[]) {
    const schema = shape[key as string] as z.ZodType<TOutput[typeof key]>;
    normalized[key] = parseSettingOrDefault(schema, data[key as string], defaults[key]);
  }

  return normalized;
}

function migrateRetiredQwenPreviewModel(settings: SharedSettings): SharedSettings {
  const isRetiredQwenSelection = (agentKind: string, modelId: string) =>
    agentKind === "qwen" && modelId === QWEN_RETIRED_PREVIEW_MODEL_ID;
  const migrateUtilityModel = (provider: string, model: string) =>
    isRetiredQwenSelection(provider, model) ? QWEN_DEFAULT_MODEL_ID : model;
  const qwenProviderConfig = settings.providerConfigs.qwen;
  const providerConfigs =
    qwenProviderConfig?.model === QWEN_RETIRED_PREVIEW_MODEL_ID
      ? {
          ...settings.providerConfigs,
          qwen: { ...qwenProviderConfig, model: QWEN_DEFAULT_MODEL_ID },
        }
      : settings.providerConfigs;
  const qwenModelPreferences = settings.providerModelPreferences.qwen;
  const retiredQwenModelPreference = qwenModelPreferences?.[QWEN_RETIRED_PREVIEW_MODEL_ID];
  let providerModelPreferences = settings.providerModelPreferences;
  if (qwenModelPreferences && retiredQwenModelPreference) {
    const currentQwenModelPreferences = { ...qwenModelPreferences };
    delete currentQwenModelPreferences[QWEN_RETIRED_PREVIEW_MODEL_ID];
    providerModelPreferences = {
      ...settings.providerModelPreferences,
      qwen: {
        ...currentQwenModelPreferences,
        [QWEN_DEFAULT_MODEL_ID]:
          currentQwenModelPreferences[QWEN_DEFAULT_MODEL_ID] ?? retiredQwenModelPreference,
      },
    };
  }

  const seenFavorites = new Set<string>();
  const favoriteModels = settings.favoriteModels
    .map((entry) =>
      isRetiredQwenSelection(entry.agentKind, entry.modelId)
        ? { ...entry, modelId: QWEN_DEFAULT_MODEL_ID }
        : entry,
    )
    .filter((entry) => {
      const key = `${entry.agentKind}\0${entry.modelId}\0${entry.presentationMode}`;
      if (seenFavorites.has(key)) return false;
      seenFavorites.add(key);
      return true;
    });

  const hiddenModels = { ...settings.hiddenModels };
  if (hiddenModels.qwen?.includes(QWEN_RETIRED_PREVIEW_MODEL_ID)) {
    hiddenModels.qwen = [
      ...new Set(
        hiddenModels.qwen.map((modelId) =>
          modelId === QWEN_RETIRED_PREVIEW_MODEL_ID ? QWEN_DEFAULT_MODEL_ID : modelId,
        ),
      ),
    ];
  }

  return {
    ...settings,
    providerConfigs,
    providerModelPreferences,
    hiddenModels,
    commitGenModel: migrateUtilityModel(settings.commitGenProvider, settings.commitGenModel),
    titleGenModel: migrateUtilityModel(settings.titleGenProvider, settings.titleGenModel),
    conflictResolverModel: migrateUtilityModel(
      settings.conflictResolverProvider,
      settings.conflictResolverModel,
    ),
    experimentJudgeModel: migrateUtilityModel(
      settings.experimentJudgeProvider,
      settings.experimentJudgeModel,
    ),
    wslCommitGenModel: migrateUtilityModel(
      settings.wslCommitGenProvider,
      settings.wslCommitGenModel,
    ),
    wslTitleGenModel: migrateUtilityModel(settings.wslTitleGenProvider, settings.wslTitleGenModel),
    wslConflictResolverModel: migrateUtilityModel(
      settings.wslConflictResolverProvider,
      settings.wslConflictResolverModel,
    ),
    favoriteModels,
    // Recents and learned usage are derived; discard retired entries instead of
    // letting them continue to influence the picker or Crossagents routing.
    recentModels: settings.recentModels.filter(
      (entry) => !isRetiredQwenSelection(entry.agentKind, entry.modelId),
    ),
    agentSelectionUsage: settings.agentSelectionUsage.filter(
      (entry) => !isRetiredQwenSelection(entry.agentKind, entry.modelId),
    ),
    ownSubagentSelectionUsage: settings.ownSubagentSelectionUsage.filter(
      (entry) => !isRetiredQwenSelection(entry.agentKind, entry.modelId),
    ),
    ownSubagentRoutingOverrides: settings.ownSubagentRoutingOverrides.map((entry) =>
      entry.agentKind === "qwen" && entry.modelId === QWEN_RETIRED_PREVIEW_MODEL_ID
        ? { ...entry, modelId: QWEN_DEFAULT_MODEL_ID }
        : entry,
    ),
  };
}

/**
 * Normalize a persisted Own Subagents route order: dedupe, drop blanks, and
 * re-insert the non-removable native lane when missing. An explicitly ordered
 * non-empty list keeps its relative order (native appends at the end); only a
 * missing/empty order defaults to native-first.
 */
export function normalizeOwnSubagentsRouteOrder(value: unknown): string[] {
  const parsed = z.array(z.string()).safeParse(value);
  const entries = (parsed.success ? parsed.data : [])
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0 && entry.length <= 64);
  const deduped = [...new Set(entries)].slice(0, 50);
  if (deduped.length === 0) return [OWN_SUBAGENTS_NATIVE_ROUTE_ID];
  if (!deduped.includes(OWN_SUBAGENTS_NATIVE_ROUTE_ID)) {
    deduped.push(OWN_SUBAGENTS_NATIVE_ROUTE_ID);
  }
  return deduped;
}

/**
 * One-time migration: legacy `crossagent*` settings keys → `ownSubagent*`.
 * New keys win when both exist. The legacy `enabledMcpServers.crossagents`
 * flag splits: an explicit `false` turns BOTH new servers off (respecting the
 * user's explicit intent over the new peer server's default-ON); otherwise
 * both default on. Legacy keys are absent from the schema, so they drop out
 * of the normalized object (and the next settings write) automatically.
 */
export function migrateCrossagentsToOwnSubagents(
  normalized: SharedSettings,
  raw: Record<string, unknown>,
): SharedSettings {
  const pick = <T>(current: T, legacyKey: string, schema: z.ZodType<T>): T => {
    if (!isEmptyValue(current)) return current;
    const migrated = schema.safeParse(raw[legacyKey]);
    return migrated.success ? migrated.data : current;
  };
  const enabledRaw = z.record(z.string(), z.boolean()).safeParse(raw.enabledMcpServers);
  const enabledMcpServers: Record<string, boolean> = { ...normalized.enabledMcpServers };
  if (enabledRaw.success) {
    const legacyFlag = enabledRaw.data.crossagents;
    if (legacyFlag === false) {
      // Explicit user opt-out of the old server: keep BOTH new servers off.
      if (enabledRaw.data.own_subagents === undefined) enabledMcpServers.own_subagents = false;
      enabledMcpServers.crossagents = false;
    } else if (legacyFlag === true && enabledRaw.data.own_subagents === undefined) {
      enabledMcpServers.own_subagents = true;
    }
    if (enabledMcpServers.crossagents === undefined) enabledMcpServers.crossagents = true;
    if (enabledMcpServers.own_subagents === undefined) enabledMcpServers.own_subagents = true;
  }
  // Legacy hard-disables of the old `crossagents` id keep BOTH new servers
  // off (explicit opt-out wins); per-tool disables copy over so ephemeral
  // spawn tools stay gated exactly as before.
  const disabledServers = { ...normalized.disabledBuiltInMcpServers };
  if (disabledServers.crossagents === true && disabledServers["own-subagents"] === undefined) {
    disabledServers["own-subagents"] = true;
  }
  const disabledTools = { ...normalized.disabledBuiltInMcpTools };
  if (disabledTools.crossagents !== undefined && disabledTools["own-subagents"] === undefined) {
    disabledTools["own-subagents"] = disabledTools.crossagents;
  }
  const guide =
    normalized.ownSubagentRoutingGuide ||
    (typeof raw.crossagentRoutingGuide === "string" ? raw.crossagentRoutingGuide : "");
  return {
    ...normalized,
    ownSubagentSelectionUsage: pick(
      normalized.ownSubagentSelectionUsage,
      "crossagentSelectionUsage",
      z.array(crossagentSelectionUsageEntrySchema),
    ),
    ownSubagentRoutingOverrides: pick(
      normalized.ownSubagentRoutingOverrides,
      "crossagentRoutingOverrides",
      z.array(crossagentRoutingOverrideSchema).max(MAX_CROSSAGENT_ROUTING_OVERRIDES),
    ),
    ownSubagentPausedProviders: pick(
      normalized.ownSubagentPausedProviders,
      "crossagentPausedProviders",
      z.array(z.string()),
    ),
    ownSubagentHiddenModels: pick(
      normalized.ownSubagentHiddenModels,
      "crossagentHiddenModels",
      z.record(z.string(), z.array(z.string())),
    ),
    ownSubagentRoutingGuide: guide,
    ownSubagentsRouteOrder: normalizeOwnSubagentsRouteOrder(normalized.ownSubagentsRouteOrder),
    enabledMcpServers,
    disabledBuiltInMcpServers: disabledServers,
    disabledBuiltInMcpTools: disabledTools,
  };
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}

export function normalizeSharedSettings(value: unknown): SharedSettings {
  const normalized = normalizeObjectFromSchema(
    sharedSettingsSchema.shape,
    defaultSharedSettings,
    value,
  );
  const parsed = z.record(z.string(), z.unknown()).safeParse(value);
  if (!parsed.success) return normalized;

  const hasAutomationMode = prAutomationModeSchema.safeParse(
    parsed.data.prAutomationDefault,
  ).success;
  const legacyAutomationMode =
    parsed.data.prAutoMergeDefault === true
      ? "merge"
      : parsed.data.prWatchDefault === true
        ? "fix"
        : "off";
  // Unversioned settings file: migrate the two legacy sleep booleans into
  // the single `preventSleep` enum. An explicit valid value always wins.
  const hasPreventSleep = sharedSettingsSchema.shape.preventSleep.safeParse(
    parsed.data.preventSleep,
  ).success;
  const hasLegacyPreventSleepKeys =
    "preventSleepWhileWorking" in parsed.data || "remoteAccessPreventSleep" in parsed.data;
  const migratedPreventSleep =
    !hasPreventSleep && hasLegacyPreventSleepKeys
      ? parsed.data.remoteAccessPreventSleep === true
        ? ("while-remote-access" as const)
        : ("while-working" as const)
      : normalized.preventSleep;
  const usage = z.record(z.string(), z.unknown()).safeParse(parsed.data.usage);
  const disabledProviders = usage.success
    ? z.array(z.string()).safeParse(usage.data.disabledProviders)
    : undefined;
  return migrateRetiredQwenPreviewModel(
    migrateCrossagentsToOwnSubagents(
      {
        ...normalized,
        sidebarShortcutOrder: normalizeSidebarShortcutOrder(normalized.sidebarShortcutOrder),
        prAutomationDefault: hasAutomationMode
          ? normalized.prAutomationDefault
          : legacyAutomationMode,
        preventSleep: migratedPreventSleep,
        usage: {
          ...normalized.usage,
          disabledProviders: disabledProviders?.success ? disabledProviders.data : [],
        },
        enabledMcpServers: {
          ...defaultSharedSettings.enabledMcpServers,
          ...normalized.enabledMcpServers,
        },
      },
      parsed.data,
    ),
  );
}
