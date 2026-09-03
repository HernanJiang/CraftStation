/**
 * Managed Kimi Code profile isolation.
 *
 * Based on subswap Kimi provider isolation:
 * MIT License, Copyright (c) 2026 subswap contributors
 *
 * Pins KIMI_CODE_HOME to the managed account credential root so each Kimi account
 * operates in an isolated filesystem and credential namespace.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

const KIMI_ROUTER_ENV_KEYS = [
  "KIMI_CODE_HOME",
  "KIMI_ROUTER_HOME",
  "KIMI_CODE_API_KEY",
  "KIMI_CODE_BASE_URL",
  "CLIPROXY_HOME",
  "CODEX_ROUTER_HOME",
] as const;

/**
 * Isolate a managed Kimi runtime from the host environment:
 * pin `KIMI_CODE_HOME` to the managed root and blank routing/proxy keys.
 */
export function managedKimiProcessEnvironment(
  managedKimiHome: string,
  baseEnv: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  const blankKeys = new Set<string>();
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    const upper = key.toUpperCase();
    if (
      KIMI_ROUTER_ENV_KEYS.includes(key as (typeof KIMI_ROUTER_ENV_KEYS)[number]) ||
      upper.includes("CLIPROXY") ||
      upper.includes("CODEX_ROUTER") ||
      upper.includes("MODEL_CATALOG")
    ) {
      blankKeys.add(key);
      continue;
    }
    env[key] = value;
  }
  for (const key of blankKeys) env[key] = "";
  env.KIMI_CODE_HOME = managedKimiHome;
  ensureManagedKimiHome(managedKimiHome);
  return env;
}

export function ensureManagedKimiHome(managedKimiHome: string): string {
  mkdirSync(managedKimiHome, { recursive: true });
  mkdirSync(join(managedKimiHome, "credentials"), { recursive: true });
  return managedKimiHome;
}

export interface KimiProfileServiceOptions {
  store: import("./accountStore").AccountStore;
}

export class KimiProfileService {
  private readonly provider = "kimi";

  constructor(private readonly options: KimiProfileServiceOptions) {
    this.options.store.cleanupOrphanedPendingAccounts(this.provider);
    this.options.store.dedupeProviderIdentities(this.provider);
  }

  managedKimiHome(accountId: string): string {
    return this.options.store.credentialRoot(accountId);
  }
}
