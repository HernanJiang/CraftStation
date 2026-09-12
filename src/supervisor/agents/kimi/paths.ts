import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Native (non-WSL) Kimi Code home and credential paths.
 *
 * Kept in its own leaf module — `detection.ts`, `sessionFiles.ts`,
 * `kimiTrust.ts` and the supervisor's credential reader all need them, and
 * detection now depends on kimiTrust, so a shared import here is what keeps
 * that from becoming an import cycle.
 */

export function nativeKimiHomePath(): string {
  const kimiHome = process.env["KIMI_CODE_HOME"];
  return kimiHome && kimiHome.trim().length > 0 ? kimiHome : join(homedir(), ".kimi-code");
}

export function nativeKimiOAuthCredentialPath(): string {
  return join(nativeKimiHomePath(), "credentials", "kimi-code.json");
}

/** Home directory that owns a `credentials/kimi-code.json` path. */
export function kimiHomeFromOAuthCredentialPath(credentialPath: string): string {
  return dirname(dirname(credentialPath));
}

/**
 * CraftStation managed-account root. Detection and usage both scan
 * profile directories for credentials/kimi-code.json here so a wiped host
 * CLI home does not hide a logged-in pool account.
 */
export function craftstationAccountsRoot(): string {
  const override = process.env["CRAFTSTATION_ACCOUNTS_DIR"]?.trim();
  return override && override.length > 0
    ? override
    : join(homedir(), ".craftstation", "craftstation-accounts");
}

/**
 * Every Kimi OAuth file CraftStation knows about: the host CLI home first,
 * then each managed profile directory under the accounts root.
 */
export async function listKimiOAuthCredentialPaths(): Promise<string[]> {
  const paths: string[] = [];
  if (existsSync(nativeKimiOAuthCredentialPath())) paths.push(nativeKimiOAuthCredentialPath());
  let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
  try {
    entries = await readdir(craftstationAccountsRoot(), { withFileTypes: true });
  } catch {
    return paths;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("profile-")) continue;
    const candidate = join(
      craftstationAccountsRoot(),
      entry.name,
      "credentials",
      "kimi-code.json",
    );
    if (existsSync(candidate)) paths.push(candidate);
  }
  return paths;
}
