/**
 * Managed Kimi Code profile isolation.
 *
 * Based on subswap Kimi provider isolation:
 * MIT License, Copyright (c) 2026 subswap contributors
 *
 * Pins KIMI_CODE_HOME to the managed account credential root so each Kimi account
 * operates in an isolated filesystem and credential namespace.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AccountControlError, type AccountView } from "@/shared/contracts";
import { writeFileAtomic } from "@/shared/atomicFile";

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

export interface KimiProfileImportInput {
  label: string;
  profileRoot?: string | undefined;
}

/** Kimi's credential format has changed names over time. We intentionally
 * accept only provider identities, never infer identity from the bearer. */
export function kimiCredentialIdentities(value: unknown, depth = 0): string[] {
  if (depth > 5 || !value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const values: string[] = [];
  for (const key of [
    "email",
    "user_email",
    "userId",
    "user_id",
    "accountId",
    "account_id",
    "subject",
    "sub",
  ]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) values.push(candidate.trim());
  }
  for (const child of Object.values(record))
    values.push(...kimiCredentialIdentities(child, depth + 1));
  return [...new Set(values)];
}

function credentialPath(root: string): string {
  return join(root, "credentials", "kimi-code.json");
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

  createEmpty(label: string): AccountView {
    return this.options.store.add({ provider: this.provider, label });
  }

  /** Copy a global Kimi login into an account-owned root. The global home is
   * never used as a runtime home and the credential never crosses IPC. */
  importCredential(input: KimiProfileImportInput): AccountView {
    const sourceRoot = input.profileRoot?.trim() || join(homedir(), ".kimi-code");
    const source = credentialPath(sourceRoot);
    if (!existsSync(source)) {
      throw new AccountControlError(
        "ACCOUNT_PROJECTION_FAILED",
        "Kimi Code credential file was not found in the selected profile.",
      );
    }
    let content: string;
    let parsed: unknown;
    try {
      content = readFileSync(source, "utf8");
      parsed = JSON.parse(content);
    } catch {
      throw new AccountControlError(
        "ACCOUNT_PROJECTION_FAILED",
        "The selected Kimi Code credential is malformed.",
      );
    }
    const identity = kimiCredentialIdentities(parsed)[0];
    if (!identity) {
      throw new AccountControlError(
        "ACCOUNT_IDENTITY_UNAVAILABLE",
        "The selected Kimi Code credential has no provider identity.",
      );
    }
    const existing = this.options.store.findByProviderIdentity(this.provider, identity);
    const account = existing
      ? this.options.store.get(existing.accountId)!
      : this.options.store.add({
          provider: this.provider,
          label: input.label,
          providerAccountId: identity,
          maskedIdentity: identity,
        });
    try {
      const root = this.options.store.credentialRoot(account.accountId);
      ensureManagedKimiHome(root);
      writeFileAtomic(credentialPath(root), content, { encoding: "utf8", mode: 0o600 });
      return this.options.store.updateStatus(account.accountId, "available");
    } catch (error) {
      if (!existing) this.options.store.remove(account.accountId);
      throw error;
    }
  }

  /** Promote a login-created row only after the managed credential has an
   * actual identity. An empty or malformed login can never become runnable. */
  completeLogin(accountId: string): AccountView {
    const account = this.options.store.getRecord(accountId);
    if (!account)
      throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${accountId}'.`);
    const path = credentialPath(account.credentialRoot);
    if (!existsSync(path)) {
      throw new AccountControlError(
        "ACCOUNT_IDENTITY_UNAVAILABLE",
        "Kimi Code login did not create a credential.",
        { accountId },
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      throw new AccountControlError(
        "ACCOUNT_PROJECTION_FAILED",
        "Kimi Code login produced a malformed credential.",
        { accountId },
      );
    }
    const identity = kimiCredentialIdentities(parsed)[0];
    if (!identity) {
      throw new AccountControlError(
        "ACCOUNT_IDENTITY_UNAVAILABLE",
        "Kimi Code login produced no provider identity.",
        { accountId },
      );
    }
    const expected = account.providerAccountId?.trim() || account.maskedIdentity?.trim();
    if (expected && expected.toLowerCase() !== identity.toLowerCase()) {
      throw new AccountControlError(
        "PROFILE_IDENTITY_MISMATCH",
        "Kimi Code login produced credentials for a different account.",
        { accountId, expected, actual: identity },
      );
    }
    this.options.store.updateProviderMetadata(accountId, {
      providerAccountId: identity,
      maskedIdentity: identity,
    });
    return this.options.store.updateStatus(accountId, "available");
  }
}

export function buildKimiLoginScript(
  shellKind: "windows" | "posix",
  completionToken: string,
): string {
  const command = "kimi acp --login";
  if (shellKind === "windows") {
    return [
      "Clear-Host",
      "if (-not $env:KIMI_CODE_HOME) { throw 'KIMI_CODE_HOME is missing from the isolated login shell.' }",
      "Write-Host ('CraftStation KIMI_CODE_HOME=' + $env:KIMI_CODE_HOME)",
      command,
      "$lcExit = if ($LASTEXITCODE -ne $null) { $LASTEXITCODE } else { 0 }",
      `Write-Host "$([char]27)]777;craftstation-login-complete=${completionToken}:$lcExit$([char]7)" -NoNewline`,
    ].join("; ");
  }
  const bash = [
    "clear",
    'if [ -z "$KIMI_CODE_HOME" ]; then echo "KIMI_CODE_HOME is missing from the isolated login shell." >&2; exit 1; fi',
    'echo "CraftStation KIMI_CODE_HOME=$KIMI_CODE_HOME"',
    command,
    "__lc_exit=$?",
    `printf '\\033]777;craftstation-login-complete=${completionToken}:%s\\007' "$__lc_exit"`,
  ].join("; ");
  return `command bash -lc '${bash.replaceAll("'", "'\\''")}'`;
}

export function managedKimiLoginCwd(managedKimiHome: string): string {
  return ensureManagedKimiHome(managedKimiHome);
}
