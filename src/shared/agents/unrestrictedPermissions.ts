import type { AgentCapability, ProjectLocation, ThreadConfig } from "@/shared/contracts";
import { isHomeScopeLocation } from "@/shared/homeScope";

/** The capability slice needed to resolve a provider's full-bypass posture. */
export type UnrestrictedPermissionCapabilities = Pick<
  AgentCapability,
  "approvalPolicies" | "sandboxModes" | "bypassPermissions"
>;

export interface UnrestrictedPermissionConfig {
  approvalPolicy?: string;
  sandboxMode?: string;
}

/**
 * Resolve a provider's most-permissive approval/sandbox choice. The provider's
 * declared bypass posture (`capabilities.bypassPermissions`) wins over the
 * conventional-id guesses: providers whose strongest policy is NOT the
 * conventional one name it explicitly (kimi ≥0.42: `yolo` is only
 * ask-when-needed, `auto` is the true never-ask; claude: `auto` is the app's
 * full-access id, not `bypassPermissions`). The preferred-id list remains the
 * fallback for providers that declare no bypass posture. Shared by the draft
 * default (设置 → 默认权限), the subagent lane, and scheduled/automation runs.
 */
export function resolveUnrestrictedPermissionConfig(
  capabilities: UnrestrictedPermissionCapabilities,
): UnrestrictedPermissionConfig {
  const approvalPolicy = resolveUnrestrictedOption(
    capabilities.approvalPolicies,
    capabilities.bypassPermissions?.approvalPolicy,
    ["bypassPermissions", "yolo", "never", "dontAsk"],
  );
  const sandboxMode = resolveUnrestrictedOption(
    capabilities.sandboxModes,
    capabilities.bypassPermissions?.sandboxMode,
    ["danger-full-access", "yolo"],
  );
  return {
    ...(approvalPolicy ? { approvalPolicy } : {}),
    ...(sandboxMode ? { sandboxMode } : {}),
  };
}

/**
 * Home is OS-level: every agent launches with that provider's strongest
 * advertised approval/sandbox posture so the native CLI is not confined to
 * the home folder. Repo workspaces are left unchanged.
 */
export function applyHomeScopePermissions(
  location: ProjectLocation,
  config: ThreadConfig,
  capabilities: UnrestrictedPermissionCapabilities,
): ThreadConfig {
  if (!isHomeScopeLocation(location)) return config;
  const unrestricted = resolveUnrestrictedPermissionConfig(capabilities);
  if (!unrestricted.approvalPolicy && !unrestricted.sandboxMode) return config;
  return { ...config, ...unrestricted };
}

function resolveUnrestrictedOption(
  options: readonly { id: string }[],
  declaredBypass: string | undefined,
  preferredIds: readonly string[],
): string | undefined {
  if (
    declaredBypass &&
    (options.length === 0 || options.some((option) => option.id === declaredBypass))
  ) {
    return declaredBypass;
  }
  for (const id of preferredIds) {
    const match = options.find((option) => option.id === id);
    if (match) return match.id;
  }
  return undefined;
}
