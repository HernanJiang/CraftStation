import type { UsageProviderDescriptor } from "./types";

export const BUILT_IN_USAGE_PROVIDER_DESCRIPTORS = {
  claude: {
    id: "claude",
    label: "Claude",
    mechanism: "oauth-endpoint",
    needsLogin: false,
    windowIds: ["session-5h", "weekly", "weekly-opus", "weekly-sonnet", "weekly-fable", "monthly"],
  },
  codex: {
    id: "codex",
    label: "Codex",
    mechanism: "oauth-endpoint",
    needsLogin: false,
    windowIds: ["session-5h", "weekly"],
  },
  copilot: {
    id: "copilot",
    label: "GitHub Copilot",
    mechanism: "oauth-endpoint",
    needsLogin: false,
    windowIds: ["monthly"],
  },
  cursor: {
    id: "cursor",
    label: "Cursor",
    mechanism: "oauth-endpoint",
    needsLogin: false,
    windowIds: ["monthly", "cursor-auto", "cursor-api"],
  },
  grok: {
    id: "grok",
    label: "Grok",
    mechanism: "oauth-endpoint",
    needsLogin: false,
    windowIds: ["monthly"],
  },
  commandcode: {
    id: "commandcode",
    label: "Command Code",
    // Web session (commandcode.ai better-auth cookie) is the primary login; the
    // CLI API key stays as the paste-in fallback (collector tries CLI first).
    mechanism: "cookie",
    needsLogin: true,
    apiKeyFallback: true,
    // Monthly credit pool plus rolling 5h / weekly USD caps from windowLimits.
    windowIds: ["session-5h", "weekly", "monthly"],
  },
  factory: {
    id: "factory",
    label: "Droid",
    mechanism: "cookie",
    needsLogin: true,
    // Standard token-rate-limit pool; optional pools use dynamic ids.
    windowIds: ["session-5h", "weekly", "monthly"],
  },
  zai: {
    id: "zai",
    label: "z.ai",
    mechanism: "api-key",
    needsLogin: true,
    windowIds: ["session-5h", "weekly", "monthly"],
  },
  kimi: {
    id: "kimi",
    label: "Kimi Code",
    mechanism: "api-key",
    needsLogin: true,
    windowIds: ["session-5h", "weekly"],
  },
  // Devin CLI stores a PAT in credentials.toml (`devin auth login`) or
  // DEVIN_API_KEY. A pasted `cog_…` key can call api.devin.ai/v3; the CLI's
  // session token (windsurf_api_key) is 404'd there and goes to the Windsurf
  // self-serve GetUserStatus surface (plan + daily/weekly resets; usage
  // percentages only for some account shapes). A live token still marks the
  // channel configured so 管理模型 can list models.
  devin: {
    id: "devin",
    label: "Devin",
    mechanism: "api-key",
    needsLogin: true,
    apiKeyFallback: true,
    windowIds: ["daily", "weekly", "monthly"],
  },
  qwen: {
    id: "qwen",
    label: "Alibaba Token Plan",
    mechanism: "cookie",
    needsLogin: true,
    apiKeyFallback: true,
    windowIds: ["session-5h", "weekly", "monthly"],
  },
  volcengine: {
    id: "volcengine",
    label: "Volcengine Ark Token Plan",
    mechanism: "api-key",
    needsLogin: true,
    windowIds: ["session-5h", "daily", "weekly", "monthly"],
  },
  "openai-compatible": {
    id: "openai-compatible",
    label: "OpenAI 兼容 API",
    mechanism: "api-key",
    needsLogin: true,
    windowIds: [],
  },
} satisfies Record<string, UsageProviderDescriptor>;

/** Descriptors for the built-in HTTP collectors, in registration order. */
export function builtInUsageProviderDescriptors(): UsageProviderDescriptor[] {
  return Object.values(BUILT_IN_USAGE_PROVIDER_DESCRIPTORS);
}

/**
 * The canonical catalog of every usage provider CraftStation supports, the single
 * source of truth for the renderer's provider list and the supervisor's default
 * collection set so the two never drift.
 *
 * Most providers are HTTP collectors registered in `registry.ts`. A couple are
 * collected supervisor-side because they need process / SQLite access the pure
 * HTTP registry can't do — they have a descriptor here but no package collector:
 * `antigravity` probes its local language server (cli-jsonrpc), and `opencode`
 * needs the supervisor for the opencode.ai cookie session plus a local
 * `auth.json` probe (Go plan badge). Go quota meters are web-only — never
 * derived from local `opencode.db` spend.
 */
export const LOCAL_USAGE_PROVIDER_DESCRIPTORS: readonly UsageProviderDescriptor[] = [
  {
    id: "antigravity",
    label: "Antigravity",
    mechanism: "cli-jsonrpc",
    needsLogin: true,
    windowIds: [],
  },
  {
    id: "opencode",
    label: "OpenCode",
    // Cookie login for live Go/Zen meters; local auth.json only gates the plan badge.
    mechanism: "cookie",
    needsLogin: true,
    needsBrowserSessionForUsage: true,
    windowIds: ["session-5h", "weekly", "monthly"],
  },
];

/** Every usage provider, registry HTTP collectors first then the local ones. */
export function allUsageProviderDescriptors(): UsageProviderDescriptor[] {
  return [...builtInUsageProviderDescriptors(), ...LOCAL_USAGE_PROVIDER_DESCRIPTORS];
}
