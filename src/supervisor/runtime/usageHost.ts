import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HostPort, Logger } from "@craftstation/agents-usage";
import { getUsageSecret, reportUndecryptableSecret } from "@/shared/usageSecretStore";
import { createNativeCredentialStore } from "./usageCredentials";
import { createNodeHttpClient } from "./usageHttpClient";

/**
 * Node implementation of the usage-collection HostPort. Supplies real HTTP
 * (global fetch), native credential resolution, and a wall clock. This is the
 * only place the otherwise-pure `@craftstation/agents-usage` package touches the
 * outside world.
 */

/** Dev-only file logger: dumps collector debug payloads to `<cacheDir>/usage-debug.json`. */
function createDevFileLogger(cacheDir: string): Logger {
  const path = join(cacheDir, "usage-debug.json");
  return {
    debug: (message, meta) => {
      try {
        writeFileSync(path, JSON.stringify({ message, meta, at: Date.now() }, null, 2));
      } catch {
        // best-effort diagnostics; never throw
      }
    },
    warn: () => {},
  };
}

export function createNodeUsageHost(cacheDir?: string, settingsPath?: string): HostPort {
  const devLog =
    process.env.CRAFTSTATION_IS_DEV === "1" && cacheDir ? createDevFileLogger(cacheDir) : undefined;
  // Sealed secrets that no longer decrypt (no known app key opens them) would
  // otherwise read as silent auth-missing. Log once per provider/key so the
  // user learns the saved credential needs re-entry.
  const watchUndecryptable = cacheDir ? reportUndecryptableSecret : undefined;
  return {
    http: createNodeHttpClient(),
    credentials: {
      ...createNativeCredentialStore(cacheDir, settingsPath),
      // Wrap only getSecret with the undecryptable watch; the native store's
      // getOAuthToken path is key-file based, not sealed-secret based.
      getSecret: async (providerId, key) =>
        cacheDir ? getUsageSecret(cacheDir, providerId, key, watchUndecryptable) : undefined,
    },
    now: () => Date.now(),
    ...(devLog ? { log: devLog } : {}),
  };
}
