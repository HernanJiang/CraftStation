/**
 * Native profile preparation and validation for CraftStation multi-account runtime.
 *
 * Reuses profile isolation and environment preparation designs from:
 * - switch-acc-ai (MIT License, Copyright (c) 2025-2026 tonamson) for Grok Leader socket isolation
 * - subswap (MIT License, Copyright (c) 2026 subswap contributors) for Codex and Kimi profile isolation
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AccountControlError, type NativeProfileSpec } from "@/shared/contracts";
import { managedGrokProcessEnvironment, grokAccountIdentityFromContainer } from "./grokProfiles";
import { managedCodexProcessEnvironment } from "./codexProfiles";
import { managedKimiProcessEnvironment } from "./kimiProfiles";
import { grokAuthContainer } from "./grokCredentials";
import { parseCodexAuth } from "./codexCredentials";

export function prepareGrokProfile(
  account: { accountId: string; credentialRoot: string; credentialScopeRef?: string },
  baseEnv?: Record<string, string | undefined>,
): NativeProfileSpec {
  const profilePath = account.credentialRoot;
  const leaderSocket = join(profilePath, "leader.sock");
  const env = managedGrokProcessEnvironment(profilePath, baseEnv);
  return {
    providerId: "grok",
    accountId: account.accountId,
    profilePath,
    env,
    ...(account.credentialScopeRef ? { credentialScope: account.credentialScopeRef } : {}),
    runtimeIsolation: {
      socketPath: leaderSocket,
      ipcPath: leaderSocket,
    },
  };
}

export function prepareCodexProfile(
  account: { accountId: string; credentialRoot: string; credentialScopeRef?: string },
  baseEnv?: Record<string, string | undefined>,
): NativeProfileSpec {
  const profilePath = account.credentialRoot;
  const env = managedCodexProcessEnvironment(profilePath, baseEnv);
  return {
    providerId: "codex",
    accountId: account.accountId,
    profilePath,
    env,
    ...(account.credentialScopeRef ? { credentialScope: account.credentialScopeRef } : {}),
  };
}

export function prepareKimiProfile(
  account: { accountId: string; credentialRoot: string; credentialScopeRef?: string },
  baseEnv?: Record<string, string | undefined>,
): NativeProfileSpec {
  const profilePath = account.credentialRoot;
  const env = managedKimiProcessEnvironment(profilePath, baseEnv);
  return {
    providerId: "kimi",
    accountId: account.accountId,
    profilePath,
    env,
    ...(account.credentialScopeRef ? { credentialScope: account.credentialScopeRef } : {}),
  };
}

export function prepareNativeProfile(
  provider: string,
  account: { accountId: string; credentialRoot: string; credentialScopeRef?: string },
  baseEnv?: Record<string, string | undefined>,
): NativeProfileSpec {
  switch (provider) {
    case "grok":
      return prepareGrokProfile(account, baseEnv);
    case "codex":
      return prepareCodexProfile(account, baseEnv);
    case "kimi":
      return prepareKimiProfile(account, baseEnv);
    default:
      return {
        providerId: provider,
        accountId: account.accountId,
        profilePath: account.credentialRoot,
        env: {},
        ...(account.credentialScopeRef ? { credentialScope: account.credentialScopeRef } : {}),
      };
  }
}

/**
 * Verify that the runtime profile contains credentials matching the expected account.
 * Throws PROFILE_IDENTITY_MISMATCH if the profile belongs to a different identity.
 */
export function verifyProfileIdentity(
  provider: string,
  profilePath: string,
  expectedAccount: {
    accountId: string;
    providerAccountId?: string | undefined;
    maskedIdentity?: string | undefined;
  },
): void {
  if (provider === "grok") {
    const authPath = join(profilePath, "auth.json");
    if (!existsSync(authPath)) return;
    try {
      const raw = readFileSync(authPath, "utf8");
      const json = JSON.parse(raw);
      const container = grokAuthContainer(json);
      const target =
        container?.container ?? (typeof json === "object" && json !== null ? json : undefined);
      if (!target) return;
      const parsed = grokAccountIdentityFromContainer(target);
      if (!parsed) return;
      const expected = expectedAccount.providerAccountId || expectedAccount.maskedIdentity;
      if (
        expected &&
        parsed.providerAccountId &&
        parsed.providerAccountId !== expected &&
        parsed.maskedIdentity !== expected
      ) {
        throw new AccountControlError(
          "PROFILE_IDENTITY_MISMATCH",
          `Grok profile identity mismatch: expected '${expected}', got '${parsed.providerAccountId}' in profile.`,
          {
            accountId: expectedAccount.accountId,
            expected,
            actual: parsed.providerAccountId,
            profilePath,
          },
        );
      }
    } catch (err) {
      if (err instanceof AccountControlError) throw err;
    }
  } else if (provider === "codex") {
    const authPath = join(profilePath, "auth.json");
    if (!existsSync(authPath)) return;
    try {
      const raw = readFileSync(authPath, "utf8");
      const token = parseCodexAuth(raw);
      if (!token) return;
      const expected = expectedAccount.providerAccountId || expectedAccount.maskedIdentity;
      const actual = token.accountId || token.email;
      if (expected && actual && actual !== expected && token.email !== expected) {
        throw new AccountControlError(
          "PROFILE_IDENTITY_MISMATCH",
          `Codex profile identity mismatch: expected '${expected}', got '${actual}' in profile.`,
          {
            accountId: expectedAccount.accountId,
            expected,
            actual,
            profilePath,
          },
        );
      }
    } catch (err) {
      if (err instanceof AccountControlError) throw err;
    }
  }
}
