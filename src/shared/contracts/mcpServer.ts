import { z } from "zod";
import { agentKindSchema, projectLocationSchema, type ProjectLocation } from "./common";

export const DEFAULT_MCP_SERVER_TIMEOUT_MS = 30_000;

/** Standard MCP hints that help providers select and authorize tools safely. */
export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** Stable ids for the MCP servers provided by CraftStation itself. */
export const BUILT_IN_MCP_SERVER_IDS = [
  "browser",
  "crossagents",
  "chrome",
  "computer-use",
  "app-controls",
] as const;
export type BuiltInMcpServerId = (typeof BUILT_IN_MCP_SERVER_IDS)[number];

/** Provider-visible names used by the built-in servers. */
export const BUILT_IN_MCP_SERVER_NAMES: Record<BuiltInMcpServerId, string> = {
  browser: "browser",
  crossagents: "crossagents",
  chrome: "chrome",
  "computer-use": "computer_use",
  "app-controls": "craftstation",
};

/** Tool catalogs advertised by each CraftStation-owned MCP server. */
export const BUILT_IN_MCP_SERVER_TOOL_NAMES = {
  browser: [
    "api",
    "enable",
    "disable",
    "list_tabs",
    "new_tab",
    "open",
    "activate_tab",
    "close_tab",
    "navigate",
    "back",
    "forward",
    "reload",
    "get_url",
    "get_title",
    "screenshot",
    "query",
    "wait_for",
    "click",
    "dblclick",
    "focus",
    "type",
    "fill",
    "check",
    "uncheck",
    "select",
    "eval",
    "snapshot",
    "inspect",
    "get",
    "is",
    "find",
    "hover",
    "press",
    "wait",
    "scroll",
    "wait_for_url",
    "wait_for_text",
    "wait_for_js",
    "console",
    "requests",
    "cookies",
    "storage",
    "dialog",
    "frames",
    "addscript",
    "addstyle",
  ],
  crossagents: [
    "list_agents",
    "get_agent",
    "spawn_agent",
    "list_routing_preferences",
    "set_routing_preference",
    "remove_routing_preference",
    "wait_for_agent",
    "get_status",
    "list_runs",
    "cancel",
  ],
  chrome: [
    "chrome_status",
    "enable",
    "disable",
    "chrome_list_tabs",
    "chrome_open",
    "chrome_attach",
    "chrome_navigate",
    "chrome_reload",
    "chrome_get_url",
    "chrome_get_title",
    "chrome_snapshot",
    "chrome_find",
    "chrome_get",
    "chrome_is",
    "chrome_click",
    "chrome_fill",
    "chrome_type",
    "chrome_press",
    "chrome_wait",
    "chrome_screenshot",
    "chrome_eval",
    "chrome_cookies",
  ],
  "computer-use": [
    "api",
    "enable",
    "disable",
    "list_apps",
    "list_windows",
    "launch_app",
    "get_window",
    "get_window_state",
    "activate_window",
    "click",
    "press_key",
    "type_text",
    "scroll",
    "drag",
  ],
  "app-controls": [
    "list_schedules",
    "create_schedule",
    "update_schedule",
    "run_schedule",
    "delete_schedule",
    "get_current_thread",
    "list_threads",
    "get_thread",
    "read_thread",
    "create_thread",
    "send_to_thread",
    "ask_thread",
    "read_thread_exchange",
    "wait_for_thread_reply",
    "interrupt_thread",
    "stop_thread",
    "wait_for_thread",
    "update_thread",
    "open_thread",
    "list_terminals",
    "read_terminal",
    "steer_thread",
    "stage_thread_input",
    "rollback_thread",
    "list_projects",
    "get_project",
    "create_project",
    "update_project",
    "get_settings",
    "update_settings",
    "get_usage",
    "search",
    "get_app_info",
    "notify_user",
    "check_for_update",
    "list_project_files",
    "read_project_file",
    "find_files",
    "list_installed_agents",
    "git_status",
    "git_diff",
    "git_stage",
    "git_commit",
    "git_discard",
    "git_branch",
    "git_sync",
    "list_worktrees",
    "remove_worktree",
    "merge_worktree",
    "gh_list_prs",
    "gh_get_pr",
    "gh_create_pr",
    "gh_pr_comment",
    "gh_merge_pr",
    "gh_update_pr",
    "list_mcp_servers",
    "probe_mcp_server",
    "add_mcp_server",
    "update_mcp_server",
    "remove_mcp_server",
    "list_skills",
    "set_skill_enabled",
  ],
} as const satisfies Record<BuiltInMcpServerId, readonly string[]>;

export const BUILT_IN_MCP_SERVER_TOOL_COUNTS: Record<BuiltInMcpServerId, number> = {
  browser: BUILT_IN_MCP_SERVER_TOOL_NAMES.browser.length,
  crossagents: BUILT_IN_MCP_SERVER_TOOL_NAMES.crossagents.length,
  chrome: BUILT_IN_MCP_SERVER_TOOL_NAMES.chrome.length,
  "computer-use": BUILT_IN_MCP_SERVER_TOOL_NAMES["computer-use"].length,
  "app-controls": BUILT_IN_MCP_SERVER_TOOL_NAMES["app-controls"].length,
};

const RESERVED_MCP_SERVER_NAMES = new Set(
  Object.values(BUILT_IN_MCP_SERVER_NAMES).map((name) => name.toLowerCase()),
);

export function isReservedMcpServerName(name: string): boolean {
  return RESERVED_MCP_SERVER_NAMES.has(name.trim().toLowerCase());
}

export const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u;

export function isValidMcpServerName(name: string): boolean {
  return MCP_SERVER_NAME_PATTERN.test(name) && !isReservedMcpServerName(name);
}

export function isValidMcpServerUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export const mcpStdioTransportSchema = z.object({
  type: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  cwd: z.string().min(1).optional(),
});
export type McpStdioTransport = z.infer<typeof mcpStdioTransportSchema>;

export const mcpHttpTransportSchema = z.object({
  type: z.literal("http"),
  url: z.string().refine(isValidMcpServerUrl),
  headers: z.record(z.string(), z.string()).default({}),
});
export type McpHttpTransport = z.infer<typeof mcpHttpTransportSchema>;

export const mcpSseTransportSchema = z.object({
  type: z.literal("sse"),
  url: z.string().refine(isValidMcpServerUrl),
  headers: z.record(z.string(), z.string()).default({}),
});
export type McpSseTransport = z.infer<typeof mcpSseTransportSchema>;

export const mcpTransportSchema = z.discriminatedUnion("type", [
  mcpStdioTransportSchema,
  mcpHttpTransportSchema,
  mcpSseTransportSchema,
]);
export type McpTransport = z.infer<typeof mcpTransportSchema>;
export type McpTransportKind = McpTransport["type"];

export const mcpExternalSourceScopeSchema = z.enum(["user", "wsl-user", "workspace"]);
export type McpExternalSourceScope = z.infer<typeof mcpExternalSourceScopeSchema>;

export const discoverExternalMcpServersPayloadSchema = z.discriminatedUnion("sourceScope", [
  z.object({ sourceScope: z.literal("user") }).strict(),
  z
    .object({
      sourceScope: z.literal("wsl-user"),
      distro: z.string().min(1),
    })
    .strict(),
  z
    .object({
      sourceScope: z.literal("workspace"),
      projectLocation: projectLocationSchema,
    })
    .strict(),
]);
export type DiscoverExternalMcpServersPayload = z.infer<
  typeof discoverExternalMcpServersPayloadSchema
>;

export const mcpExternalUnsupportedReasonSchema = z.enum([
  "authentication",
  "tool-restrictions",
  "sensitive-values",
]);
export type McpExternalUnsupportedReason = z.infer<typeof mcpExternalUnsupportedReasonSchema>;

/** Canonical import candidate. Reserved built-in names remain visible for UI conflict handling. */
export const mcpExternalServerCandidateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).regex(MCP_SERVER_NAME_PATTERN),
  enabled: z.boolean(),
  timeoutMs: z.number().int().positive(),
  transport: mcpTransportSchema,
  unsupportedReason: mcpExternalUnsupportedReasonSchema.optional(),
});
export type McpExternalServerCandidate = z.infer<typeof mcpExternalServerCandidateSchema>;

export const mcpExternalServerGroupSchema = z.object({
  providerId: z.string().min(1),
  providerLabel: z.string().min(1),
  sourcePath: z.string().min(1),
  servers: z.array(mcpExternalServerCandidateSchema),
});
export type McpExternalServerGroup = z.infer<typeof mcpExternalServerGroupSchema>;

export const discoverExternalMcpServersResultSchema = z.object({
  groups: z.array(mcpExternalServerGroupSchema),
});
export type DiscoverExternalMcpServersResult = z.infer<
  typeof discoverExternalMcpServersResultSchema
>;

/** Canonical provider-agnostic custom MCP server managed by CraftStation. */
export const mcpServerSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).regex(MCP_SERVER_NAME_PATTERN),
    description: z.string().default(""),
    enabled: z.boolean().default(true),
    timeoutMs: z.number().int().positive().default(DEFAULT_MCP_SERVER_TIMEOUT_MS),
    disabledTools: z.array(z.string().min(1)).optional(),
    transport: mcpTransportSchema,
  })
  .refine((server) => !isReservedMcpServerName(server.name), {
    path: ["name"],
    message: "MCP server name is reserved by a built-in server",
  });
export type McpServer = z.infer<typeof mcpServerSchema>;

/**
 * Provider-neutral MCP descriptor after launch-time resolution. Built-in
 * owners and user configuration both project into this shape before an agent
 * adapter sees them.
 */
export type ResolvedMcpServer = Omit<McpServer, "description" | "enabled"> & {
  approvalMode?: "approve";
};

export interface McpRuntimeSupport {
  supportedMcpTransports?: readonly McpTransportKind[] | undefined;
  supportsMcpHttpHeaders?: boolean | undefined;
  requiresSecretFreeMcpConfig?: boolean | undefined;
  supportsMcpInWsl?: boolean | undefined;
}

const MCP_SECRET_KEY_NAME = /token|cookie|secret|password|authorization|api[_-]?key|credential/iu;
const MCP_SECRET_ARGUMENT =
  /(?:bearer\s+|(?:api[_-]?key|token|secret|password|authorization|cookie)\s*[:=])/iu;

export function hasCredentialLikeMcpLaunchFields(server: Pick<McpServer, "transport">): boolean {
  const transport = server.transport;
  if (transport.type === "stdio") {
    return [transport.command, ...transport.args].some((value) => MCP_SECRET_ARGUMENT.test(value));
  }
  let url: URL;
  try {
    url = new URL(transport.url);
  } catch {
    return true;
  }
  return Boolean(
    Object.keys(transport.headers).length > 0 ||
    url.username ||
    url.password ||
    [...url.searchParams.keys()].some((key) => MCP_SECRET_KEY_NAME.test(key)),
  );
}

/**
 * Provider-neutral launch compatibility check shared by renderer affordances
 * and the supervisor's final resolved-server filter. This intentionally checks
 * only declared transport/header support; provider-specific validation remains
 * at the adapter boundary.
 */
export function isMcpServerSupportedByRuntime(
  server: Pick<McpServer, "transport">,
  support: McpRuntimeSupport,
): boolean {
  const transport = server.transport;
  if (support.supportedMcpTransports && !support.supportedMcpTransports.includes(transport.type)) {
    return false;
  }
  if (
    support.supportsMcpHttpHeaders === false &&
    transport.type !== "stdio" &&
    Object.keys(transport.headers).length > 0
  ) {
    return false;
  }
  if (support.requiresSecretFreeMcpConfig && hasCredentialLikeMcpLaunchFields(server)) {
    return false;
  }
  return true;
}

export function supportsMcpAtProjectLocation(
  support: McpRuntimeSupport,
  location: ProjectLocation | undefined,
): boolean {
  return location?.kind !== "wsl" || support.supportsMcpInWsl !== false;
}

/** Whether a runtime can receive CraftStation-owned bearer-auth HTTP MCPs. */
export function supportsHeaderBearingHttpMcp(support: McpRuntimeSupport): boolean {
  return (
    (!support.supportedMcpTransports || support.supportedMcpTransports.includes("http")) &&
    support.supportsMcpHttpHeaders !== false
  );
}

export const mcpServerListSchema = z.array(mcpServerSchema).default([]);

/**
 * OAuth 2.1 flow for user-configured HTTP/SSE MCP servers. The supervisor owns
 * the loopback redirect listener and the sealed token store; the renderer only
 * ever sees the authorization URL and status flags — never tokens.
 */
const mcpOauthOwnerSchema = z.object({ projectLocation: projectLocationSchema.optional() });

export const mcpOauthBeginPayloadSchema = mcpOauthOwnerSchema.extend({ server: mcpServerSchema });
export type McpOauthBeginPayload = z.infer<typeof mcpOauthBeginPayloadSchema>;

export const mcpOauthBeginResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("authorized") }),
  z.object({
    status: z.literal("redirect"),
    flowId: z.string().min(1),
    authorizationUrl: z.string().min(1),
  }),
  z.object({ status: z.literal("error"), message: z.string().min(1) }),
]);
export type McpOauthBeginResult = z.infer<typeof mcpOauthBeginResultSchema>;

export const mcpOauthWaitPayloadSchema = mcpOauthOwnerSchema.extend({ flowId: z.string().min(1) });
export type McpOauthWaitPayload = z.infer<typeof mcpOauthWaitPayloadSchema>;

export const mcpOauthWaitResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("authorized") }),
  z.object({ status: z.literal("error"), message: z.string().min(1) }),
]);
export type McpOauthWaitResult = z.infer<typeof mcpOauthWaitResultSchema>;

export const mcpOauthClearPayloadSchema = mcpOauthOwnerSchema.extend({ url: z.string().min(1) });
export type McpOauthClearPayload = z.infer<typeof mcpOauthClearPayloadSchema>;

export const mcpOauthStatusPayloadSchema = mcpOauthOwnerSchema;
export type McpOauthStatusPayload = z.infer<typeof mcpOauthStatusPayloadSchema>;

export const mcpOauthStatusResultSchema = z.object({
  authenticatedUrls: z.array(z.string()),
});
export type McpOauthStatusResult = z.infer<typeof mcpOauthStatusResultSchema>;

/**
 * Re-resolve and apply the MCP set of a provider's live sessions after its
 * provider-level MCP settings changed (`mcpConfigSource: "agentSettings"`).
 * Sessions without a live update hook pick the new set up on next launch.
 */
export const reloadAgentMcpServersPayloadSchema = z.object({
  agentKind: agentKindSchema,
});
export type ReloadAgentMcpServersPayload = z.infer<typeof reloadAgentMcpServersPayloadSchema>;

export const mcpProbePayloadSchema = z.object({
  server: mcpServerSchema,
  /**
   * Present for a workspace-scoped probe. WSL locations are executed inside
   * the named distro so the result matches the provider's runtime.
   */
  projectLocation: projectLocationSchema.optional(),
});
export type McpProbePayload = z.infer<typeof mcpProbePayloadSchema>;

export const mcpProbeEnvironmentSchema = z.object({
  runtime: z.enum(["host", "wsl"]),
  projectScoped: z.boolean(),
});
export type McpProbeEnvironment = z.infer<typeof mcpProbeEnvironmentSchema>;

export const mcpProbeErrorCodeSchema = z.enum([
  "auth-required",
  "timeout",
  "command-not-found",
  "connection-failed",
  "protocol-error",
  "invalid-config",
  "probe-unavailable",
]);
export type McpProbeErrorCode = z.infer<typeof mcpProbeErrorCodeSchema>;

export const mcpProbeErrorSchema = z.object({
  code: mcpProbeErrorCodeSchema,
  /** Safe summary only; transport errors, command lines, headers, and env are never returned. */
  message: z.string().min(1),
  authScheme: z.enum(["oauth", "bearer", "other", "unknown"]).optional(),
});
export type McpProbeError = z.infer<typeof mcpProbeErrorSchema>;

const mcpProbeResultBaseSchema = z.object({
  latencyMs: z.number().int().nonnegative(),
  environment: mcpProbeEnvironmentSchema,
});

export const mcpProbeResultSchema = z.discriminatedUnion("status", [
  mcpProbeResultBaseSchema.extend({
    status: z.literal("available"),
    toolCount: z.number().int().nonnegative(),
    tools: z.array(z.string().min(1)).optional(),
    serverInfo: z
      .object({
        name: z.string().min(1).optional(),
        version: z.string().min(1).optional(),
      })
      .optional(),
  }),
  mcpProbeResultBaseSchema.extend({
    status: z.literal("auth-required"),
    toolCount: z.literal(0),
    error: mcpProbeErrorSchema.extend({ code: z.literal("auth-required") }),
  }),
  mcpProbeResultBaseSchema.extend({
    status: z.literal("unavailable"),
    toolCount: z.literal(0),
    error: mcpProbeErrorSchema,
  }),
]);
export type McpProbeResult = z.infer<typeof mcpProbeResultSchema>;

/**
 * Merge global and project servers by provider-visible name. Project entries
 * override global entries case-insensitively, including disabled entries.
 */
export function mergeMcpServers(
  globalServers: readonly McpServer[],
  projectServers: readonly McpServer[],
): McpServer[] {
  const merged = new Map<string, McpServer>();
  for (const server of globalServers) merged.set(server.name.toLowerCase(), server);
  for (const server of projectServers) merged.set(server.name.toLowerCase(), server);
  return [...merged.values()];
}

/** Filter to custom servers that should be projected into a new launch. */
export function resolveEnabledMcpServers(servers: readonly McpServer[]): McpServer[] {
  return servers.filter((server) => server.enabled && !isReservedMcpServerName(server.name));
}

export const builtInMcpServerDisabledSchema = z
  .partialRecord(z.enum(BUILT_IN_MCP_SERVER_IDS), z.boolean())
  .default({});
export type BuiltInMcpServerDisabled = z.infer<typeof builtInMcpServerDisabledSchema>;

export const builtInMcpDisabledToolsSchema = z
  .partialRecord(z.enum(BUILT_IN_MCP_SERVER_IDS), z.array(z.string().min(1)))
  .default({});
export type BuiltInMcpDisabledTools = z.infer<typeof builtInMcpDisabledToolsSchema>;

export function disabledBuiltInMcpServerIds(
  disabled: BuiltInMcpServerDisabled,
): BuiltInMcpServerId[] {
  return BUILT_IN_MCP_SERVER_IDS.filter((id) => disabled[id] === true);
}

/** Custom servers plus built-in disables resolved for a thread launch. */
export interface McpLaunchSnapshot {
  mcpServers: McpServer[];
  disabledBuiltInMcpServerIds: BuiltInMcpServerId[];
  disabledBuiltInMcpTools?: BuiltInMcpDisabledTools;
  /** Built-in MCPs contributed by enabled Agent Plugins for this launch. */
  pluginBuiltInMcpServerIds?: BuiltInMcpServerId[];
}

export function emptyMcpLaunchSnapshot(): McpLaunchSnapshot {
  return { mcpServers: [], disabledBuiltInMcpServerIds: [], disabledBuiltInMcpTools: {} };
}

/**
 * Authoritative merge of global settings and project overrides into the
 * launch-time MCP snapshot attached to `StartThreadPayload`.
 */
export function resolveMcpLaunchSnapshot(
  settings: {
    mcpServers: readonly McpServer[];
    disabledBuiltInMcpServers: BuiltInMcpServerDisabled;
    disabledBuiltInMcpTools: BuiltInMcpDisabledTools;
  },
  projectMcpServers: readonly McpServer[] = [],
): McpLaunchSnapshot {
  return {
    mcpServers: resolveEnabledMcpServers(mergeMcpServers(settings.mcpServers, projectMcpServers)),
    disabledBuiltInMcpServerIds: disabledBuiltInMcpServerIds(settings.disabledBuiltInMcpServers),
    disabledBuiltInMcpTools: settings.disabledBuiltInMcpTools,
  };
}
