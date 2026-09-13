import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { stripModelProviderPrefix } from "@/shared/harnessCompatibility";
import { quotePosixShellArg } from "../base/shellBasics";
import { museForeignSettingsDocument, museForeignShimPythonSource } from "./foreignGateway";

export const OPENCODE_GO_PROVIDER = "opencode-go";
export const OPENCODE_GO_RESPONSES_BASE_URL = "https://opencode.ai/zen/go/v1";
export const MUSE_FOREIGN_BASE_URL_ENV = "CRAFTSTATION_MUSE_BASE_URL";
/** JSON body for `$XDG_CONFIG_HOME/muse/settings.json` (no secrets). */
export const MUSE_FOREIGN_SETTINGS_JSON_ENV = "CRAFTSTATION_MUSE_SETTINGS_JSON";
export const MUSE_FOREIGN_SHIM_UPSTREAM_ENV = "CRAFTSTATION_MUSE_SHIM_UPSTREAM";
export const MUSE_FOREIGN_SHIM_MODEL_ENV = "CRAFTSTATION_MUSE_SHIM_MODEL";
export const MUSE_FOREIGN_SHIM_PYTHON_ENV = "CRAFTSTATION_MUSE_SHIM_PYTHON";

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

export function museForeignSettingsJson(
  baseUrl: string,
  model = "muse-spark-1.3-contributor",
): string {
  return JSON.stringify(museForeignSettingsDocument({ model, gatewayOrigin: baseUrl }));
}

export function writeMuseForeignSettings(
  isolationDir: string,
  baseUrl: string,
  model = "muse-spark-1.3-contributor",
): void {
  const dir = join(isolationDir, "muse");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "settings.json"), `${museForeignSettingsJson(baseUrl, model)}\n`, "utf8");
}

/**
 * WSL cannot see a Windows-created isolation dir. Start the local Responses
 * shim inside the distro (catalog at GET /muse-code/models, POST /responses
 * forwarded to the third-party API), then write settings.json at that origin.
 */
export function museForeignWslBootstrap(env: Record<string, string>): string {
  const home = env.XDG_CONFIG_HOME?.trim();
  const upstream = env[MUSE_FOREIGN_SHIM_UPSTREAM_ENV]?.trim();
  const python = env[MUSE_FOREIGN_SHIM_PYTHON_ENV];
  const model = env[MUSE_FOREIGN_SHIM_MODEL_ENV]?.trim() || "muse-spark-1.3-contributor";
  if (!home || !upstream || !python) {
    const json = env[MUSE_FOREIGN_SETTINGS_JSON_ENV]?.trim();
    if (!json || !home) return "";
    const museDir = `${home.replace(/\/+$/u, "")}/muse`;
    return (
      `mkdir -p ${quotePosixShellArg(museDir)}; ` +
      `printf '%s\\n' ${quotePosixShellArg(json)} > ${quotePosixShellArg(`${museDir}/settings.json`)}; `
    );
  }
  const museDir = `${home.replace(/\/+$/u, "")}/muse`;
  const shimPy = `${home.replace(/\/+$/u, "")}/shim.py`;
  const portFile = `${home.replace(/\/+$/u, "")}/shim.port`;
  const settingsPath = `${museDir}/settings.json`;
  const template = museForeignSettingsJson("http://127.0.0.1:0", model);
  const rewrite = [
    "import json,os",
    "d=json.loads(os.environ['MUSE_SHIM_SETTINGS_TEMPLATE'])",
    "p=open(os.environ['MUSE_SHIM_PORT_FILE']).read().strip()",
    "d['endpoint_transport']={'base_url':'http://127.0.0.1:'+p,'auth':'bearer'}",
    "open(os.environ['MUSE_SHIM_SETTINGS_OUT'],'w').write(json.dumps(d)+'\\n')",
  ].join("; ");
  return [
    `mkdir -p ${quotePosixShellArg(museDir)}`,
    `printf '%s\\n' ${quotePosixShellArg(python)} > ${quotePosixShellArg(shimPy)}`,
    `export MUSE_SHIM_PORT_FILE=${quotePosixShellArg(portFile)}`,
    `export MUSE_SHIM_UPSTREAM=${quotePosixShellArg(upstream)}`,
    `export MUSE_SHIM_MODEL=${quotePosixShellArg(model)}`,
    `export MUSE_SHIM_SETTINGS_TEMPLATE=${quotePosixShellArg(template)}`,
    `export MUSE_SHIM_SETTINGS_OUT=${quotePosixShellArg(settingsPath)}`,
    `python3 ${quotePosixShellArg(shimPy)} >/dev/null 2>&1 &`,
    `muse_shim_pid=$!`,
    `trap 'kill $muse_shim_pid 2>/dev/null' EXIT`,
    `i=0; while [ ! -s ${quotePosixShellArg(portFile)} ] && [ "$i" -lt 50 ]; do sleep 0.1; i=$((i+1)); done`,
    `python3 -c ${quotePosixShellArg(rewrite)}`,
  ].join("; ");
}

export function buildMuseForeignChildEnv(input: {
  apiKey: string;
  baseUrl: string;
  isolationDir: string;
  model?: string;
  /** Host-side mkdir. Skip for WSL Linux paths the Windows process cannot create. */
  createIsolationDir?: boolean;
}): Record<string, string> {
  const baseUrl = normalizeMuseResponsesBaseUrl(input.baseUrl);
  if (!baseUrl) throw new Error("muse foreign launch requires a valid base URL");
  if (!input.apiKey.trim()) throw new Error("muse foreign launch requires an API key");
  const model =
    stripModelProviderPrefix(input.model ?? "muse-spark-1.3-contributor") ||
    "muse-spark-1.3-contributor";
  if (input.createIsolationDir !== false) {
    mkdirSync(input.isolationDir, { recursive: true });
    writeMuseForeignSettings(input.isolationDir, baseUrl, model);
  }
  return {
    META_API_KEY: input.apiKey.trim(),
    XDG_CONFIG_HOME: input.isolationDir,
    XDG_DATA_HOME: input.isolationDir,
    MUSE_NO_AUTO_UPDATE: "1",
    [MUSE_FOREIGN_BASE_URL_ENV]: baseUrl,
    [MUSE_FOREIGN_SETTINGS_JSON_ENV]: museForeignSettingsJson(baseUrl, model),
    [MUSE_FOREIGN_SHIM_UPSTREAM_ENV]: baseUrl,
    [MUSE_FOREIGN_SHIM_MODEL_ENV]: model,
    [MUSE_FOREIGN_SHIM_PYTHON_ENV]: museForeignShimPythonSource(),
  };
}

/**
 * Point official Muse Code at a foreign Responses endpoint and strip catalog
 * prefixes from `--model`. Muse 1.0.2 withholds bearer auth unless
 * `endpoint_transport.auth=bearer` is pinned in settings — do not pass
 * `--base-url` on argv (that flag is not vouched by the settings pin).
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
  if (out.includes("--provider")) return out;
  const trustIdx = out.indexOf("--trust-workspace");
  const insertAt = trustIdx >= 0 ? trustIdx + 1 : 0;
  out.splice(insertAt, 0, "--provider", "meta");
  return out;
}
