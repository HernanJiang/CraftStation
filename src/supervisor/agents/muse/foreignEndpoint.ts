import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { stripModelProviderPrefix } from "@/shared/harnessCompatibility";

export const OPENCODE_GO_PROVIDER = "opencode-go";
export const OPENCODE_GO_RESPONSES_BASE_URL = "https://opencode.ai/zen/go/v1";
export const MUSE_FOREIGN_BASE_URL_ENV = "CRAFTSTATION_MUSE_BASE_URL";

/**
 * Muse Code appends `/responses` itself. Catalog/user URLs often include it.
 * Keep the API root so `--base-url` does not become `/v1/responses/responses`.
 */
export function normalizeMuseResponsesBaseUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    url.search = "";
    url.username = "";
    url.password = "";
    url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
    url.pathname = url.pathname.replace(/\/responses$/iu, "") || "/";
    return url.toString().replace(/\/$/u, "");
  } catch {
    return undefined;
  }
}

export function museForeignProviderFromModel(modelId: string): string | undefined {
  const slash = modelId.trim().indexOf("/");
  if (slash <= 0) return undefined;
  const prefix = modelId.trim().slice(0, slash).toLowerCase();
  return prefix === OPENCODE_GO_PROVIDER ? OPENCODE_GO_PROVIDER : undefined;
}

function openCodeDataDirs(): string[] {
  const home = homedir();
  const candidates: string[] = [];
  const xdgData = process.env.XDG_DATA_HOME?.trim();
  if (xdgData) candidates.push(join(xdgData, "opencode"));
  candidates.push(join(home, ".local", "share", "opencode"));
  if (process.platform === "darwin") {
    candidates.push(join(home, "Library", "Application Support", "opencode"));
  }
  if (process.platform === "win32") {
    for (const envVar of ["APPDATA", "LOCALAPPDATA"] as const) {
      const base = process.env[envVar]?.trim();
      if (base) candidates.push(join(base, "opencode"));
    }
  }
  return [...new Set(candidates)];
}

/**
 * Read the OpenCode Go API key from the official CLI auth.json. Never log the
 * value. Missing/malformed files degrade to undefined.
 */
export function readOpenCodeGoApiKey(): string | undefined {
  for (const dir of openCodeDataDirs()) {
    const authPath = join(dir, "auth.json");
    let parsed: unknown;
    try {
      if (!existsSync(authPath)) continue;
      parsed = JSON.parse(readFileSync(authPath, "utf8"));
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const entry = (parsed as Record<string, unknown>)[OPENCODE_GO_PROVIDER];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const key = (entry as { key?: unknown }).key;
    if (typeof key === "string" && key.trim().length > 0) return key.trim();
  }
  return undefined;
}

export function buildMuseForeignChildEnv(input: {
  apiKey: string;
  baseUrl: string;
  isolationDir: string;
  /** Host-side mkdir. Skip for WSL Linux paths the Windows process cannot create. */
  createIsolationDir?: boolean;
}): Record<string, string> {
  const baseUrl = normalizeMuseResponsesBaseUrl(input.baseUrl);
  if (!baseUrl) throw new Error("muse foreign launch requires a valid base URL");
  if (!input.apiKey.trim()) throw new Error("muse foreign launch requires an API key");
  if (input.createIsolationDir !== false) {
    mkdirSync(input.isolationDir, { recursive: true });
  }
  return {
    META_API_KEY: input.apiKey.trim(),
    XDG_CONFIG_HOME: input.isolationDir,
    XDG_DATA_HOME: input.isolationDir,
    MUSE_NO_AUTO_UPDATE: "1",
    [MUSE_FOREIGN_BASE_URL_ENV]: baseUrl,
  };
}

/**
 * Point official Muse Code at a foreign Responses endpoint and strip catalog
 * prefixes from `--model`. Idempotent if the flags are already present.
 */
export function applyMuseForeignLaunchArgs(
  args: readonly string[],
  extraEnv?: Record<string, string> | undefined,
): string[] {
  const out = [...args];
  const modelIdx = out.indexOf("--model");
  if (modelIdx >= 0 && typeof out[modelIdx + 1] === "string") {
    out[modelIdx + 1] = stripModelProviderPrefix(out[modelIdx + 1]!);
  }
  const baseUrl = extraEnv?.[MUSE_FOREIGN_BASE_URL_ENV]?.trim();
  if (!baseUrl) return out;
  if (out.includes("--base-url")) return out;
  const trustIdx = out.indexOf("--trust-workspace");
  const insertAt = trustIdx >= 0 ? trustIdx + 1 : 0;
  out.splice(insertAt, 0, "--provider", "meta", "--base-url", baseUrl);
  return out;
}
