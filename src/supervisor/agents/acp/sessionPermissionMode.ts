/**
 * Mapping between CraftStation's approval-policy ids and the ACP session modes an
 * agent advertises, plus the synthetic-permission-request auto-approve helper
 * used when an agent has no native mode for the requested policy.
 */
import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import { isBypassApprovalPolicy } from "@/shared/agentSelection";
import { normalizeAcpModeId } from "./probe";

function acpModeKey(modeId: string): string {
  return normalizeAcpModeId(modeId).toLowerCase();
}

export function hasNativeAcpPermissionMode(policy: string, availableModeIds: string[]): boolean {
  const available = new Set(availableModeIds.map(acpModeKey));
  const normalizedPolicy = policy.toLowerCase();

  if (available.has(normalizedPolicy)) return true;
  // Full-access ids are per-harness vocabulary: any bypass pick counts as
  // native when the agent advertises any bypass mode (`bypass`, `dangerous`,
  // `auto-high`, `yolo`, `autopilot`, …).
  if (isBypassApprovalPolicy(normalizedPolicy)) {
    return [...available].some((modeId) => isBypassApprovalPolicy(modeId));
  }
  if (normalizedPolicy === "auto_edit") {
    return available.has("autoedit") || available.has("accept-edits");
  }
  return false;
}

export function selectAutoApprovedPermissionOption(
  request: RequestPermissionRequest,
): string | undefined {
  const readOptionId = (kind: string) => {
    const optionId = request.options.find((option) => option.kind === kind)?.optionId?.trim();
    return optionId && optionId.length > 0 ? optionId : undefined;
  };

  return readOptionId("allow_always") ?? readOptionId("allow_once");
}
