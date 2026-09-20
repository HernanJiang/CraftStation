import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HostCacheStore, HostPort, Logger } from "@craftstation/agents-usage";
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

/**
 * File-backed {@link HostCacheStore}: a small JSON map in the cache dir holding
 * last-known-good upstream server-function ids. Reads are synchronous and
 * best-effort; writes go through tmp+rename so a crash never leaves a torn file.
 */
function createServerIdCache(cacheDir: string): HostCacheStore {
  const path = join(cacheDir, "usage-server-ids.json");
  const readAll = (): Record<string, string> => {
    try {
      if (!existsSync(path)) return {};
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, string>)
        : {};
    } catch {
      return {};
    }
  };
  return {
    read: (scope) => readAll()[scope],
    write: (scope, value) => {
      try {
        const data = { ...readAll(), [scope]: value };
        const tmp = `${path}.tmp`;
        writeFileSync(tmp, JSON.stringify(data), "utf8");
        renameSync(tmp, path);
      } catch {
        // best-effort cache; losing a write only costs one re-resolution
      }
    },
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
    ...(cacheDir ? { serverIdCache: createServerIdCache(cacheDir) } : {}),
    ...(devLog ? { log: devLog } : {}),
  };
}
