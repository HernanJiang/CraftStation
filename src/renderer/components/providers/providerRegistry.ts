import { baseAgentKind } from "@/shared/contracts";

/** Registry lookup that falls back to the base kind for instance-scoped kinds. */
export function lookupProviderRegistration<T>(
  registry: ReadonlyMap<string, T>,
  kind: string,
): T | undefined {
  const exact = registry.get(kind);
  if (exact !== undefined) return exact;
  const baseKind = baseAgentKind(kind);
  return baseKind !== kind ? registry.get(baseKind) : undefined;
}
