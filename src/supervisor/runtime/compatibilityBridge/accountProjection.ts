import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { writeFileAtomic } from "@/shared/atomicFile";
import { parseGrokAuth, grokAuthContainer } from "../grokCredentials";
import { toEpochMs } from "@craftstation/agents-usage";

/** Native CLI auth.json 与 CPA 的平铺 OAuth 文件不同；投影副本，绝不改写原凭据。 */
export function projectCompatibilityAccount(
  provider: string,
  credentialRoot: string,
  directory: string,
): string {
  if (!["codex", "kimi", "grok"].includes(provider)) return credentialRoot;
  const source =
    provider === "kimi"
      ? join(credentialRoot, "credentials", "kimi-code.json")
      : join(credentialRoot, "auth.json");
  let root: Record<string, unknown>;
  let content: string;
  try {
    content = readFileSync(source, "utf8");
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Invalid object");
    root = parsed as Record<string, unknown>;
  } catch {
    throw new Error(`CPA 无法读取 ${provider} 账号凭据，请重新登录该账号。`);
  }
  const nested =
    provider === "grok" ? (grokAuthContainer(root)?.container ?? root.tokens) : root.tokens;
  const tokens = nested && typeof nested === "object" ? (nested as Record<string, unknown>) : root;
  const grok = provider === "grok" ? parseGrokAuth(content) : undefined;
  const access = grok?.accessToken ?? tokens.access_token ?? tokens.accessToken;
  const refresh = grok?.refreshToken ?? tokens.refresh_token ?? tokens.refreshToken;
  if (
    !(typeof access === "string" && access.trim()) &&
    !(typeof refresh === "string" && refresh.trim())
  ) {
    throw new Error(`CPA 账号投影缺少 ${provider} OAuth token，请选择已登录的订阅账号。`);
  }
  const projected: Record<string, unknown> = { type: provider === "grok" ? "xai" : provider };
  for (const key of [
    "access_token",
    "refresh_token",
    "id_token",
    "account_id",
    "email",
    "expired",
    "expires_at",
    "token_type",
    "scope",
    "device_id",
    "last_refresh",
  ]) {
    const value = tokens[key] ?? root[key];
    if (typeof value === "string" || typeof value === "number") projected[key] = value;
  }
  if (typeof access === "string" && access.trim()) projected.access_token = access;
  if (typeof refresh === "string" && refresh.trim()) projected.refresh_token = refresh;
  const expiryValue = tokens.expired ?? tokens.expires_at ?? tokens.expiresAt;
  const expiry =
    typeof expiryValue === "string" || typeof expiryValue === "number"
      ? toEpochMs(expiryValue)
      : undefined;
  if (expiry !== undefined && Number.isFinite(expiry))
    projected.expired = new Date(expiry).toISOString();
  if (provider === "kimi" && !projected.device_id) {
    try {
      const deviceId = readFileSync(join(credentialRoot, "device_id"), "utf8").trim();
      if (deviceId) projected.device_id = deviceId;
    } catch {
      /* Older profiles may not have a device identifier. */
    }
  }
  if (provider === "grok") {
    projected.auth_kind = "oauth";
    if (grok?.expiresAt) projected.expired = new Date(grok.expiresAt).toISOString();
    if (grok?.raw?.clientId) projected.client_id = grok.raw.clientId;
    if (grok?.email) projected.email = grok.email;
    if (grok?.accountId) projected.sub = grok.accountId;
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = join(directory, "account.json");
  const sourceMarker = join(directory, ".source.digest");
  // CPA owns refreshes in its copy. Only a changed source login may replace
  // that copy; repeated launches must never roll a rotated refresh token back.
  // The marker contains only a digest and is not an auth JSON scanned by CPA.
  const digest = createHash("sha256").update(content).digest("hex");
  let previousDigest: string | undefined;
  try {
    previousDigest = readFileSync(sourceMarker, "utf8");
  } catch {
    /* First projection has no source marker. */
  }
  // CPA writes refreshed credentials non-atomically. An empty/partial file
  // during refresh must never authorize restoring the stale source tokens.
  if (previousDigest === digest) {
    if (!existsSync(target)) throw new Error("CPA 凭据副本缺失，请重新导入该账号后重试。");
    return directory;
  }
  writeFileAtomic(target, JSON.stringify(projected), { mode: 0o600 });
  writeFileAtomic(sourceMarker, digest, { mode: 0o600 });
  return directory;
}
