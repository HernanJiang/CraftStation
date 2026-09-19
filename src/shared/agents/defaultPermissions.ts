import type { AgentCapability, ThreadConfig } from "@/shared/contracts";
import type { DefaultPermissionMode } from "@/shared/settings";
import { resolveUnrestrictedPermissionConfig } from "./unrestrictedPermissions";

function firstAdvertisedPermission(
  ids: readonly string[],
  options: readonly { id: string }[],
): string | undefined {
  return ids.find((id) => options.some((option) => option.id === id));
}

/** Apply the app-wide draft default using the target provider's own policy ids. */
export function applyPermissionMode(
  capabilities: AgentCapability,
  config: ThreadConfig,
  mode: DefaultPermissionMode,
): ThreadConfig {
  const unrestricted = resolveUnrestrictedPermissionConfig(capabilities);
  const {
    approvalPolicy: _approval,
    approvalsReviewer: _reviewer,
    sandboxMode: _sandbox,
    ...rest
  } = config;

  if (mode === "full-access") {
    return { ...rest, ...unrestricted };
  }

  const approvalOptions = capabilities.approvalPolicies;
  const approvalPolicy =
    firstAdvertisedPermission(
      ["on-request", "default", "normal", "untrusted", "on-demand", "always"],
      approvalOptions,
    ) ??
    approvalOptions.find((option) => option.id !== unrestricted.approvalPolicy)?.id ??
    (approvalOptions.length === 0 ? "default" : undefined);
  const sandboxOptions = capabilities.sandboxModes;
  const declaredSandbox = capabilities.defaultSandboxMode;
  const sandboxMode =
    (declaredSandbox &&
    declaredSandbox !== unrestricted.sandboxMode &&
    sandboxOptions.some((option) => option.id === declaredSandbox)
      ? declaredSandbox
      : undefined) ??
    firstAdvertisedPermission(["workspace-write", "read-only"], sandboxOptions) ??
    sandboxOptions.find((option) => option.id !== unrestricted.sandboxMode)?.id;

  return {
    ...rest,
    ...(approvalPolicy ? { approvalPolicy } : {}),
    ...(capabilities.defaultApprovalsReviewer
      ? { approvalsReviewer: capabilities.defaultApprovalsReviewer }
      : {}),
    ...(sandboxMode ? { sandboxMode } : {}),
  };
}
