import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OAuthToken } from "@craftstation/agents-usage";
import { readCodexAuthFromWsl } from "./wslCredentials";

/**
 * Codex (OpenAI / ChatGPT) credential resolution from `~/.codex/auth.json`. The
 * pure parser is exported separately for tests. Secrets are never logged.
 */

interface CodexAuthBlob {
  OPENAI_API_KEY?: string | null;
  auth_mode?: string | null;
  last_refresh?: string | null;
  personal_access_token?: string | null;
  agent_identity?: unknown;
  bedrock_api_key?: unknown;
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
    id_token?: string;
  };
}

/**
 * OpenAI OAuth access tokens are compact JWTs (`eyJ…`). Codex's login flow can
 * also mint `sk-svcacct-…` service-account keys; if such a key ever lands in
 * `tokens.access_token` (token-exchange persistence on some Codex builds), the
 * ChatGPT backend at chatgpt.com/backend-api rejects it with "Incorrect API
 * key provided" — the bearer must never be key-shaped.
 */
export function isCodexOAuthAccessToken(token: string | undefined): token is string {
  if (!token) return false;
  const trimmed = token.trim();
  if (!trimmed.startsWith("eyJ")) return false;
  const segments = trimmed.split(".");
  return segments.length === 3 && segments.every((segment) => segment.length > 0);
}

/** Decode the OpenAI id_token JWT payload and return the account email. */
export function codexEmailFromIdToken(idToken: string | undefined): string | undefined {
  if (!idToken) return undefined;
  const payload = idToken.split(".")[1];
  if (!payload) return undefined;
  try {
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8",
    );
    const email = (JSON.parse(json) as { email?: unknown }).email;
    return typeof email === "string" && email.includes("@") ? email : undefined;
  } catch {
    return undefined;
  }
}

/** Parse `~/.codex/auth.json` contents into an OAuth token bundle. */
export function parseCodexAuth(content: string): OAuthToken | undefined {
  let parsed: CodexAuthBlob | undefined;
  try {
    parsed = JSON.parse(content) as CodexAuthBlob;
  } catch {
    return undefined;
  }
  const accessToken = parsed?.tokens?.access_token;
  if (!isCodexOAuthAccessToken(accessToken)) return undefined;
  const email = codexEmailFromIdToken(parsed.tokens?.id_token);
  return {
    accessToken,
    ...(parsed.tokens?.refresh_token ? { refreshToken: parsed.tokens.refresh_token } : {}),
    ...(parsed.tokens?.account_id ? { accountId: parsed.tokens.account_id } : {}),
    ...(email ? { email } : {}),
  };
}

/**
 * Canonicalize an `auth.json` for a CraftStation-managed subscription profile.
 *
 * `codex login` mints an `sk-svcacct-…` key via token-exchange and persists it
 * as `OPENAI_API_KEY`; other Codex builds may store `personal_access_token`,
 * `agent_identity` or `bedrock_api_key` alongside the ChatGPT tokens. Any of
 * these make `resolved_mode` pick a key-auth mode or feed a key-shaped bearer
 * to `chatgpt.com/backend-api/codex` (the 401 "Incorrect API key" failure).
 * A managed subscription profile is OAuth-only, so the alternate credentials
 * are stripped and `auth_mode` is pinned to `chatgpt`.
 *
 * Returns `undefined` when the input is not parseable JSON — callers decide
 * whether that is fatal.
 */
export function sanitizeCodexAuthJson(content: string): string | undefined {
  let parsed: CodexAuthBlob | undefined;
  try {
    parsed = JSON.parse(content) as CodexAuthBlob;
  } catch {
    return undefined;
  }
  const accessToken = parsed.tokens?.access_token;
  // A key-shaped access_token is a revoked/expired minted key — keeping it only
  // produces the chatgpt-backend 401 loop; drop the whole token bundle so Codex
  // surfaces "not logged in" and the user re-authenticates.
  const poisonedTokens = parsed.tokens !== undefined && !isCodexOAuthAccessToken(accessToken);
  const sanitized: CodexAuthBlob = {
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    ...(parsed.last_refresh ? { last_refresh: parsed.last_refresh } : {}),
    ...(poisonedTokens || !parsed.tokens ? {} : { tokens: parsed.tokens }),
  };
  return JSON.stringify(sanitized, null, 2) + "\n";
}

function codexAuthFilePath(): string {
  const home = process.env.CODEX_HOME?.trim();
  return home ? join(home, "auth.json") : join(homedir(), ".codex", "auth.json");
}

export interface CodexCredentialScope {
  /** Explicit isolated CODEX_HOME. Omitted means the user's normal Codex home. */
  codexHome?: string;
  /** Disable the WSL fallback for a managed native profile. */
  allowWslFallback?: boolean;
}

export async function resolveCodexToken(
  scope: CodexCredentialScope = {},
): Promise<OAuthToken | undefined> {
  // Read fresh every call — the access token is a short-lived JWT the Codex CLI
  // refreshes (~5 min); a cached Bearer would go stale and 401.
  const path = scope.codexHome ? join(scope.codexHome, "auth.json") : codexAuthFilePath();
  if (existsSync(path)) {
    try {
      const token = parseCodexAuth(readFileSync(path, "utf8"));
      if (token) return token;
    } catch {
      // fall through to the WSL fallback
    }
  }
  if (process.platform === "win32" && scope.allowWslFallback !== false && !scope.codexHome) {
    const blob = await readCodexAuthFromWsl();
    if (blob) {
      const token = parseCodexAuth(blob);
      if (token) return token;
    }
  }
  return undefined;
}
