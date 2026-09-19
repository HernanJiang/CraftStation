import type { StoredRecipe } from "./workbenchTypes";

/** Strip `harness:` / `native-harness:` so a stored ref launches as `opencode`. */
export function normalizeRecipeHarnessKind(raw: string | undefined): string {
  return (raw ?? "").replace(/^harness:/u, "").replace(/^native-harness:/u, "");
}

/** Harness kind a saved recipe should launch on (`opencode`, not `harness:opencode`). */
export function recipeLaunchHarnessKind(recipe: StoredRecipe): string {
  return normalizeRecipeHarnessKind(recipe.lastKnownHarness?.harnessKind || recipe.harnessRef);
}

/** Provider/agent kind encoded in an `agent:` / `custom:` material ref. */
export function providerKindFromRecipeRef(ref: string): string | undefined {
  if (ref.startsWith("agent:") || ref.startsWith("custom:")) {
    const head = ref
      .slice(ref.indexOf(":") + 1)
      .split(":")[0]
      ?.trim();
    return head || undefined;
  }
  return undefined;
}

/**
 * Model id encoded in an `agent:<surface>:<modelId>` material ref. Custom-model
 * refs (`custom:…`) are catalog ids, not launch ids — those stay undefined.
 */
export function modelIdFromRecipeRef(ref: string): string | undefined {
  if (!ref.startsWith("agent:")) return undefined;
  const withoutPrefix = ref.slice("agent:".length);
  const lastColon = withoutPrefix.lastIndexOf(":");
  if (lastColon <= 0) return undefined;
  const modelId = withoutPrefix.slice(lastColon + 1).trim();
  return modelId || undefined;
}

/** Concrete model id a saved recipe should launch, even if lastKnown stored an entry ref. */
export function recipeLaunchModelId(recipe: StoredRecipe): string | undefined {
  const stored = recipe.lastKnownModel?.modelId?.trim();
  if (stored && !stored.startsWith("agent:") && !stored.startsWith("custom:")) return stored;
  return modelIdFromRecipeRef(recipe.modelEntryRef) ?? stored;
}
