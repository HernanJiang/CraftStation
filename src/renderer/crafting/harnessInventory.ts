import type { NativeHarnessControlPlaneEntry } from "@/shared/crafting/nativeHarness";
import type { HarnessReference } from "@/shared/crafting/workbenchTypes";

/**
 * Harness kinds retired from the visible Workbench catalogue. The runtime
 * adapters stay registered so saved recipes and old threads keep resolving;
 * they just no longer show up as pickable materials. (`deepseek-api`: the
 * native DSH harness supersedes the OpenAI-compatible API runtime.)
 */
export const RETIRED_HARNESS_KINDS: readonly string[] = ["deepseek-api"];

export function isRetiredHarnessKind(harnessKind: string): boolean {
  return RETIRED_HARNESS_KINDS.includes(harnessKind);
}

/**
 * Agent kinds backing the supervisor's Native Harness control plane
 * (`NATIVE_HARNESS_DESCRIPTORS`), minus the retired `deepseek-api` HTTP
 * runtime which has no CLI agent kind. A control-plane refresh must run real
 * agent detection for exactly these kinds first — the projection itself only
 * reshapes already-detected AgentStatuses.
 */
export const NATIVE_HARNESS_AGENT_KINDS: readonly string[] = [
  "codex",
  "grok",
  "kimi",
  "antigravity",
  "deepseek",
  "muse",
  "opencode",
  "devin",
];

/**
 * Project the safe Native Harness control-plane into secret-free Workbench
 * Harness materials. A HarnessReference never carries a path, command or
 * credential — it references the descriptor/kind by stable id and reports a
 * safe status. Retired kinds are dropped from the pickable catalogue.
 */
export function buildHarnessInventory(
  entries: readonly NativeHarnessControlPlaneEntry[],
): HarnessReference[] {
  return entries
    .filter((entry) => !isRetiredHarnessKind(entry.descriptor.harnessKind))
    .map((entry) => {
      const descriptor = entry.descriptor;
      const ref: HarnessReference = {
        harnessItemId: `harness:${descriptor.harnessKind}`,
        harnessKind: descriptor.harnessKind,
        descriptorId: descriptor.id,
        displayName: descriptor.label,
        vendor: descriptor.vendor,
        official: descriptor.official,
        status: entry.status,
        transport: descriptor.transport,
      };
      return ref;
    });
}

/** A Harness is a selectable material only when it is installed, configured and ready. */
export function isHarnessSelectable(ref: HarnessReference): boolean {
  return ref.status === "ready";
}

export function findHarnessReference(
  refs: readonly HarnessReference[],
  harnessRef: string | undefined,
): HarnessReference | undefined {
  if (!harnessRef) return undefined;
  return refs.find((ref) => ref.harnessItemId === harnessRef || ref.harnessKind === harnessRef);
}

export function composeSystemNameFromRefs(harnessName: string, modelName: string): string {
  return `${harnessName} · ${modelName}`;
}
