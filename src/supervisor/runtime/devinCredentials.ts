import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { OAuthToken } from "@craftstation/agents-usage";

export const DEVIN_API_KEY_ENVS = ["DEVIN_API_KEY", "WINDSURF_API_KEY"] as const;

function cleaned(raw: string | undefined): string | undefined {
  let value = raw?.trim();
  if (!value) return undefined;
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value || undefined;
}

/** Paths `devin auth login` writes, matching the CLI detection probe. */
export function nativeDevinCredentialPaths(): string[] {
  const home = homedir();
  if (process.platform === "win32") {
    const appData = process.env.APPDATA?.trim();
    return [
      ...(appData ? [join(appData, "devin", "credentials.toml")] : []),
      join(home, ".devin", "credentials.toml"),
    ];
  }
  const xdg = process.env.XDG_DATA_HOME?.trim();
  const linux = xdg
    ? join(xdg, "devin", "credentials.toml")
    : join(home, ".local", "share", "devin", "credentials.toml");
  const mac = join(home, "Library", "Application Support", "devin", "credentials.toml");
  const legacy = join(home, ".devin", "credentials.toml");
  return process.platform === "darwin" ? [mac, linux, legacy] : [linux, legacy];
}

export function parseDevinEnv(env: Record<string, string | undefined>): OAuthToken | undefined {
  for (const name of DEVIN_API_KEY_ENVS) {
    const accessToken = cleaned(env[name]);
    if (accessToken) return { accessToken };
  }
  return undefined;
}

const TOKEN_KEYS = new Set(["token", "api_token", "api_key", "apikey", "access_token", "pat"]);
const EMAIL_KEYS = new Set(["email", "user_email", "username", "user", "login"]);
const PLAN_KEYS = new Set(["plan", "plan_name", "tier", "subscription"]);

function walkToml(value: unknown, found: { token?: string; email?: string; plan?: string }): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) walkToml(entry, found);
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase();
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      if (!found.token && TOKEN_KEYS.has(normalized)) found.token = trimmed;
      else if (!found.email && EMAIL_KEYS.has(normalized)) found.email = trimmed;
      else if (!found.plan && PLAN_KEYS.has(normalized)) found.plan = trimmed;
      continue;
    }
    walkToml(entry, found);
  }
}

/** Pure: parse `credentials.toml` written by `devin auth login`. */
export function parseDevinCredentialsToml(content: string): OAuthToken | undefined {
  let parsed: unknown;
  try {
    parsed = parseToml(content);
  } catch {
    return undefined;
  }
  const found: { token?: string; email?: string; plan?: string } = {};
  walkToml(parsed, found);
  if (!found.token) return undefined;
  return {
    accessToken: found.token,
    ...(found.email ? { email: found.email, accountId: found.email } : {}),
    ...(found.plan ? { subscriptionType: found.plan } : {}),
  };
}

export async function resolveDevinToken(): Promise<OAuthToken | undefined> {
  const envToken = parseDevinEnv(process.env);
  if (envToken) return envToken;
  for (const path of nativeDevinCredentialPaths()) {
    if (!existsSync(path)) continue;
    try {
      const token = parseDevinCredentialsToml(await readFile(path, "utf8"));
      if (token) return token;
    } catch {
      // try the next known location
    }
  }
  return undefined;
}
