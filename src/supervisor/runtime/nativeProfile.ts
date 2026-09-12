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
import { antigravityAdcCredentialPath } from "./antigravityCredentials";
import { grokAuthContainer } from "./grokCredentials";
import { parseCodexAuth } from "./codexCredentials";

/** Supervisor-only launch description. Never place this object in an IPC,
 * session, renderer or persistence contract. */
export type NativeProfileLaunchSpec = NativeProfileSpec & {
  /** Supervisor-only managed filesystem root. */
  profilePath: string;
  env: Record<string, string>;
  runtimeIsolation?: { ipcPath?: string; socketPath?: string };
};

export function prepareGrokProfile(
  account: { accountId: string; credentialRoot: string; credentialScopeRef?: string },
  baseEnv?: Record<string, string | undefined>,
): NativeProfileLaunchSpec {
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
): NativeProfileLaunchSpec {
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
): NativeProfileLaunchSpec {
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

/**
 * Compatibility-bridge endpoint keys. Native Antigravity runs must never
 * inherit these: only a non-native model on the native vendor may go through
 * CPA, everything else runs the official CLI against the account pool. Blank
 * (not omit): the child env is spread over `process.env`, so omission would
 * leak the host value back in.
 */
export const ANTIGRAVITY_COMPATIBILITY_ENV_KEYS = [
  "GOOGLE_GEMINI_BASE_URL",
  "GEMINI_API_KEY",
] as const;

/**
 * Antigravity has no home-dir redirect: `agy` consumes pool credentials only
 * through Application Default Credentials. The ADC file itself is materialized
 * from the account's sealed vault bucket before this spec is built (see
 * `materializeAntigravityAdcCredential`); the env carries only scope redirects,
 * never secret values.
 */
export function prepareAntigravityProfile(account: {
  accountId: string;
  credentialRoot: string;
  credentialScopeRef?: string;
}): NativeProfileLaunchSpec {
  return {
    providerId: "antigravity",
    accountId: account.accountId,
    profilePath: account.credentialRoot,
    ...(account.credentialScopeRef ? { credentialScope: account.credentialScopeRef } : {}),
    env: {
      AGY_ADC_AUTH: "1",
      GOOGLE_APPLICATION_CREDENTIALS: antigravityAdcCredentialPath(account.credentialRoot),
      GOOGLE_GEMINI_BASE_URL: "",
      GEMINI_API_KEY: "",
    },
  };
}

export function prepareNativeProfile(
  provider: string,
  account: { accountId: string; credentialRoot: string; credentialScopeRef?: string },
  baseEnv?: Record<string, string | undefined>,
): NativeProfileLaunchSpec {
  switch (provider) {
    case "grok":
      return prepareGrokProfile(account, baseEnv);
    case "codex":
      return prepareCodexProfile(account, baseEnv);
    case "kimi":
      return prepareKimiProfile(account, baseEnv);
    case "antigravity":
      return prepareAntigravityProfile(account);
    default:
      return {
        providerId: provider,
        accountId: account.accountId,
        profilePath: account.credentialRoot,
        ...(account.credentialScopeRef ? { credentialScope: account.credentialScopeRef } : {}),
        env: {},
      };
  }
}

/**
 * Verify that the runtime profile contains credentials matching the expected account.
 * A different identity throws PROFILE_IDENTITY_MISMATCH; missing, malformed, or
 * otherwise unverifiable credentials throw ACCOUNT_IDENTITY_UNAVAILABLE. Both
 * outcomes must be handled before Entity/Session creation.
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
    if (!existsSync(authPath)) {
      throw identityUnavailable(provider, expectedAccount, "credential file is missing");
    }
    try {
      const raw = readFileSync(authPath, "utf8");
      const json = JSON.parse(raw);
      const container = grokAuthContainer(json);
      const target = container?.container;
      if (!target) throw identityUnavailable(provider, expectedAccount, "credential is malformed");
      const parsed = grokAccountIdentityFromContainer(target);
      if (!parsed)
        throw identityUnavailable(provider, expectedAccount, "native identity is absent");
      assertIdentityMatch(provider, expectedAccount, [
        parsed.providerAccountId,
        parsed.maskedIdentity,
      ]);
    } catch (err) {
      if (err instanceof AccountControlError) throw err;
      throw identityUnavailable(provider, expectedAccount, "credential could not be read");
    }
  } else if (provider === "codex") {
    const authPath = join(profilePath, "auth.json");
    if (!existsSync(authPath)) {
      throw identityUnavailable(provider, expectedAccount, "credential file is missing");
    }
    try {
      const raw = readFileSync(authPath, "utf8");
      const token = parseCodexAuth(raw);
      if (!token) throw identityUnavailable(provider, expectedAccount, "credential is malformed");
      assertIdentityMatch(provider, expectedAccount, [token.accountId, token.email]);
    } catch (err) {
      if (err instanceof AccountControlError) throw err;
      throw identityUnavailable(provider, expectedAccount, "credential could not be read");
    }
  } else if (provider === "antigravity") {
    // The authorized_user ADC file carries no identity claims — the email lives
    // only in the sealed vault bucket keyed by the same accountId. Verify the
    // credential is materially present instead of pretending to compare it.
    const adcPath = antigravityAdcCredentialPath(profilePath);
    if (!existsSync(adcPath)) {
      throw identityUnavailable(provider, expectedAccount, "credential file is missing");
    }
    try {
      const parsed = JSON.parse(readFileSync(adcPath, "utf8")) as unknown;
      if (
        !parsed ||
        typeof parsed !== "object" ||
        (parsed as Record<string, unknown>).type !== "authorized_user" ||
        !String((parsed as Record<string, unknown>).refresh_token ?? "").trim()
      ) {
        throw identityUnavailable(provider, expectedAccount, "credential is malformed");
      }
    } catch (err) {
      if (err instanceof AccountControlError) throw err;
      throw identityUnavailable(provider, expectedAccount, "credential could not be read");
    }
  } else if (provider === "kimi") {
    const credentialPath = join(profilePath, "credentials", "kimi-code.json");
    if (!existsSync(credentialPath)) {
      throw identityUnavailable(provider, expectedAccount, "credential file is missing");
    }
    try {
      const parsed = JSON.parse(readFileSync(credentialPath, "utf8")) as unknown;
      const identities = collectIdentityValues(parsed);
      if (identities.length === 0) {
        throw identityUnavailable(provider, expectedAccount, "native identity is absent");
      }
      assertIdentityMatch(provider, expectedAccount, identities);
    } catch (err) {
      if (err instanceof AccountControlError) throw err;
      throw identityUnavailable(provider, expectedAccount, "credential could not be read");
    }
  }
}

function identityUnavailable(
  provider: string,
  expected: { accountId: string },
  reason: string,
): AccountControlError {
  return new AccountControlError(
    "ACCOUNT_IDENTITY_UNAVAILABLE",
    `${provider} native identity unavailable: ${reason}.`,
    { accountId: expected.accountId, provider, reason },
  );
}

function assertIdentityMatch(
  provider: string,
  expectedAccount: {
    accountId: string;
    providerAccountId?: string | undefined;
    maskedIdentity?: string | undefined;
  },
  actualValues: readonly (string | undefined)[],
): void {
  const expected =
    expectedAccount.providerAccountId?.trim() || expectedAccount.maskedIdentity?.trim();
  const actual = actualValues.find((value) => value?.trim())?.trim();
  if (!expected || !actual) {
    throw identityUnavailable(provider, expectedAccount, "selected or native identity is absent");
  }
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new AccountControlError(
      "PROFILE_IDENTITY_MISMATCH",
      `${provider} profile identity mismatch or unavailable.`,
      {
        accountId: expectedAccount.accountId,
        provider,
        expected,
        actual,
      },
    );
  }
}

function collectIdentityValues(value: unknown, depth = 0): string[] {
  if (depth > 4 || !value || typeof value !== "object" || Array.isArray(value)) return [];
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
    values.push(...collectIdentityValues(child, depth + 1));
  return [...new Set(values)];
}
