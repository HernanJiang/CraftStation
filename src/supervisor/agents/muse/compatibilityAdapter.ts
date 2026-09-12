import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface MuseIsolatedRuntimeInput {
  /**
   * CraftStation-owned runtime root (NOT the user home). The isolated tree is
   * created at `<runtimeDir>/muse/<sessionId>/`.
   */
  runtimeDir: string;
  /** Per-session id, namespaced so concurrent sessions never share config. */
  sessionId: string;
  /** Local CPA/Gateway BaseURL the isolated Muse CLI talks to. */
  gatewayBaseUrl: string;
  /**
   * Ephemeral local bearer Muse presents to the gateway. The gateway
   * (CraftStation/CPA) maps it to the real upstream credential — the real
   * provider key NEVER lands in these files.
   */
  localBearer: string;
  model: string;
  /** Models exposed through `/muse-code/models` compatibility. */
  modelCatalog?: readonly string[] | undefined;
  contextLimit?: number | undefined;
  outputLimit?: number | undefined;
  providerLabel?: string | undefined;
}

export interface MuseIsolatedRuntime {
  /** Isolated config home — export as XDG_CONFIG_HOME for the child. */
  configHome: string;
  /** Full path of the written gateway config file. */
  configPath: string;
  /** Spawn env additions for the isolated Muse child process. */
  env: Record<string, string>;
}

/**
 * MuseHarnessAdapter (compatibility leg only).
 *
 * Builds an isolated Muse Code runtime for NON-native providers: the child
 * gets `XDG_CONFIG_HOME=<runtime>/muse/<session>` pointing at a generated
 * config (gateway BaseURL + throwaway local bearer + model catalog), so the
 * user's real `~/.config/muse` is never read or modified. Chain:
 *
 *   muse CLI → local bearer → CraftStation/CPA gateway → real provider key → upstream
 */
export function buildMuseIsolatedRuntime(input: MuseIsolatedRuntimeInput): MuseIsolatedRuntime {
  const session = input.sessionId.trim();
  if (!session) throw new Error("muse isolated runtime requires a sessionId");
  if (!input.gatewayBaseUrl.trim())
    throw new Error("muse isolated runtime requires a gatewayBaseUrl");
  if (!input.localBearer) throw new Error("muse isolated runtime requires a localBearer");
  if (!input.model.trim()) throw new Error("muse isolated runtime requires a model");

  // Muse appends `/muse` to XDG homes itself, so the session home sits one
  // level above: <runtimeDir>/muse/<session>/ + `muse/config.json` inside.
  const sessionHome = join(input.runtimeDir, "muse", session);
  const museDir = join(sessionHome, "muse");
  mkdirSync(museDir, { recursive: true });
  const configPath = join(museDir, "config.json");
  const config = {
    version: 1,
    compatibility: "craftstation-cpa-gateway",
    gateway: {
      baseUrl: input.gatewayBaseUrl,
      auth: { scheme: "bearer", token: input.localBearer },
    },
    model: input.model,
    model_catalog: input.modelCatalog ?? [input.model],
    ...(input.contextLimit !== undefined ? { context_limit: input.contextLimit } : {}),
    ...(input.outputLimit !== undefined ? { output_limit: input.outputLimit } : {}),
    metadata: {
      provider: input.providerLabel ?? "craftstation-compatibility",
      managedBy: "craftstation",
      sessionId: session,
    },
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return {
    configHome: sessionHome,
    configPath,
    env: {
      XDG_CONFIG_HOME: sessionHome,
      // Keep data (sessions) next to config inside the isolated tree.
      XDG_DATA_HOME: sessionHome,
    },
  };
}
