import type { NativeHarnessControlPlaneEntry } from "@/shared/crafting/nativeHarness";
import type { HarnessReference } from "@/shared/crafting/workbenchTypes";

/**
 * Project the safe Native Harness control-plane into secret-free Workbench
 * Harness materials. A HarnessReference never carries a path, command or
 * credential — it references the descriptor/kind by stable id and reports a
 * safe status.
 */
export function buildHarnessInventory(
  entries: readonly NativeHarnessControlPlaneEntry[],
): HarnessReference[] {
  return entries.map((entry) => {
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
