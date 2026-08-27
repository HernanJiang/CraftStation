import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolvePoracodePaths } from "@/shared/poracodePaths";

/** Codex home that CraftStation owns; never the host ~/.codex Router overlay. */
export function nativePrivateCodexHome(): string {
  return join(resolvePoracodePaths(process.env.PORACODE_DATA_DIR).agentPluginsDir, "codex", "home");
}

export function hostCodexHome(): string {
  return join(homedir(), ".codex");
}

/**
 * True when `codexHome/config.toml` is a Codex-Router overlay (catalog, local
 * gateway, or the Codex-Router provider). CraftStation must not treat that
 * home as its ChatGPT login or session store.
 */
export function isCodexRouterOverlayHome(codexHome: string): boolean {
  const configPath = join(codexHome, "config.toml");
  if (!existsSync(configPath)) {
    return false;
  }
  let text: string;
  try {
    text = readFileSync(configPath, "utf8");
  } catch {
    return false;
  }
  const lower = text.toLowerCase();
  return (
    lower.includes("codex-router") ||
    lower.includes("model_catalog_json") ||
    /127\.0\.0\.1:28\d{3}/.test(text) ||
    /127\.0\.0\.1:1808\d/.test(text)
  );
}

/** Codex homes CraftStation may read. Host ~/.codex is skipped when Router owns it. */
export function isolatedCodexHomeCandidates(): string[] {
  const homes = [nativePrivateCodexHome(), hostCodexHome()];
  return homes.filter((home, index) => homes.indexOf(home) === index && !isCodexRouterOverlayHome(home));
}

/**
 * Auth.json CraftStation should probe. Never the Router overlay: that file is
 * Desktop/Router's ChatGPT token and logging into Router rewrites it.
 */
export function isolatedCodexAuthPath(): string {
  const privateAuth = join(nativePrivateCodexHome(), "auth.json");
  if (existsSync(privateAuth)) {
    return privateAuth;
  }
  const host = hostCodexHome();
  if (isCodexRouterOverlayHome(host)) {
    return privateAuth;
  }
  return join(host, "auth.json");
}
