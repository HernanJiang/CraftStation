import { spawn } from "node:child_process";

/**
 * Apply a pool Antigravity account as the host `agy` CLI login ("设为本机登录").
 *
 * Mirrors the switch logic of the standalone multi-account tools
 * (agm `switch --target agy`, agy-swap, agy-cli-manager): the host CLI keeps a
 * single login in the OS credential store, so applying a pool row means
 * overwriting that login. The payload schema matches what `agy` itself reads
 * (`antigravityCredentialStore.ts`: `{ token: { access_token, token_type,
 * refresh_token, expiry }, auth_method: "consumer" }`), which is also what
 * flips its auth-mode resolution to consumer so the model catalog loads.
 *
 * Secrets never touch the command line: the JSON payload travels on stdin.
 * Windows-only for now (the user's platform); other platforms throw a typed
 * unsupported error instead of silently doing nothing.
 */

export const ANTIGRAVITY_HOST_CREDENTIAL_TARGET = "gemini:antigravity";
export const ANTIGRAVITY_HOST_CREDENTIAL_USER = "antigravity";

export interface AntigravityHostCredentialInput {
  accessToken: string;
  refreshToken: string;
  tokenType?: string;
  /** Epoch milliseconds; defaults to now + 1h like agm. */
  expiresAt?: number;
}

export interface HostCredentialRunner {
  runPowerShell(script: string, stdin: string): Promise<{ stdout: string }>;
}

function defaultRunner(): HostCredentialRunner {
  if (process.env.VITEST) {
    throw new Error("Host credential store is not available under vitest; inject a runner.");
  }
  return {
    runPowerShell: (script: string, stdin: string) =>
      new Promise((resolve, reject) => {
        const child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
          windowsHide: true,
          timeout: 30_000,
        });
        if (!child.stdout || !child.stdin) {
          child.kill();
          reject(new Error("Host credential helper failed to start."));
          return;
        }
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: unknown) => {
          stdout += String(chunk);
        });
        child.stderr.on("data", (chunk: unknown) => {
          stderr += String(chunk);
        });
        child.on("error", (error: Error) => {
          reject(new Error(`Host credential helper failed to start: ${error.message}`));
        });
        child.on("close", (code: number | null) => {
          if (code === 0) {
            resolve({ stdout });
            return;
          }
          const detail = stderr.trim().slice(0, 200);
          reject(
            new Error(
              `Host credential helper failed (exit ${code ?? "unknown"})${detail ? `: ${detail}` : ""}`,
            ),
          );
        });
        child.stdin.write(stdin);
        child.stdin.end();
      }),
  };
}

/** Microsecond-ISO expiry (`...SSS000Z`), matching agm/agy consumers. */
export function formatHostCredentialExpiry(expiresAt?: number): string {
  const at = Number.isFinite(expiresAt) && (expiresAt as number) > 0 ? expiresAt as number : Date.now() + 3_600_000;
  return new Date(at).toISOString().replace(/\.(\d{3})Z$/, ".$1000Z");
}

/** Build the exact host-login JSON blob. Pure: safe to unit test. */
export function buildAntigravityHostCredentialPayload(input: AntigravityHostCredentialInput): string {
  const accessToken = input.accessToken.trim();
  const refreshToken = input.refreshToken.trim();
  if (!accessToken || !refreshToken) {
    throw new Error("Host credential needs both an access token and a refresh token.");
  }
  return JSON.stringify({
    token: {
      access_token: accessToken,
      token_type: (input.tokenType ?? "Bearer").trim() || "Bearer",
      refresh_token: refreshToken,
      expiry: formatHostCredentialExpiry(input.expiresAt),
    },
    auth_method: "consumer",
  });
}

const CRED_WRITE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$raw = [Console]::In.ReadToEnd()",
  "$code = @'",
  "using System;",
  "using System.Runtime.InteropServices;",
  "using System.Text;",
  "public class CraftHostCred {",
  "  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]",
  "  public struct CREDENTIAL {",
  "    public uint Flags; public uint Type; public string TargetName; public string Comment;",
  "    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;",
  "    public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;",
  "    public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;",
  "  }",
  "  [DllImport(\"advapi32.dll\", CharSet = CharSet.Unicode, SetLastError = true)]",
  "  public static extern bool CredWrite([In] ref CREDENTIAL userCredential, uint flags);",
  "  [DllImport(\"advapi32.dll\", CharSet = CharSet.Unicode, SetLastError = true)]",
  "  public static extern bool CredRead(string target, uint type, uint reservedFlag, out IntPtr credentialPtr);",
  "  [DllImport(\"advapi32.dll\", SetLastError = true)]",
  "  public static extern void CredFree(IntPtr buffer);",
  "  public static void Write(string target, string user, string secret) {",
  "    byte[] b = Encoding.UTF8.GetBytes(secret);",
  "    IntPtr p = Marshal.AllocHGlobal(b.Length);",
  "    try {",
  "      Marshal.Copy(b, 0, p, b.Length);",
  "      CREDENTIAL c = new CREDENTIAL();",
  "      c.Type = 1;",
  "      c.TargetName = target;",
  "      c.CredentialBlobSize = (uint)b.Length;",
  "      c.CredentialBlob = p;",
  "      c.Persist = 2;",
  "      c.UserName = user;",
  "      // Single CredWrite updates the target in place (no prior delete):",
  "      // concurrent session starts must never observe an empty credential.",
  "      if (!CredWrite(ref c, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());",
  "    } finally { Marshal.FreeHGlobal(p); }",
  "  }",
  "  public static string Read(string target) {",
  "    IntPtr p;",
  "    if (!CredRead(target, 1, 0, out p)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());",
  "    try {",
  "      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));",
  "      byte[] b = new byte[c.CredentialBlobSize];",
  "      Marshal.Copy(c.CredentialBlob, b, 0, (int)c.CredentialBlobSize);",
  "      return Encoding.UTF8.GetString(b);",
  "    } finally { CredFree(p); }",
  "  }",
  "}",
  "'@",
  "Add-Type -TypeDefinition $code -Language CSharp",
  `[CraftHostCred]::Write('${ANTIGRAVITY_HOST_CREDENTIAL_TARGET}', '${ANTIGRAVITY_HOST_CREDENTIAL_USER}', $raw)`,
  `$stored = [CraftHostCred]::Read('${ANTIGRAVITY_HOST_CREDENTIAL_TARGET}')`,
  "if ($stored -ceq $raw) { Write-Output 'HOST_CREDENTIAL_VERIFIED' } else { throw 'Host credential round-trip mismatch' }",
].join("\n");

const CRED_READ_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$code = @'",
  "using System;",
  "using System.Runtime.InteropServices;",
  "using System.Text;",
  "public class CraftHostCredRead {",
  "  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]",
  "  public struct CREDENTIAL {",
  "    public uint Flags; public uint Type; public string TargetName; public string Comment;",
  "    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;",
  "    public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;",
  "    public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;",
  "  }",
  "  [DllImport(\"advapi32.dll\", CharSet = CharSet.Unicode, SetLastError = true)]",
  "  public static extern bool CredRead(string target, uint type, uint reservedFlag, out IntPtr credentialPtr);",
  "  [DllImport(\"advapi32.dll\", SetLastError = true)]",
  "  public static extern void CredFree(IntPtr buffer);",
  "  public static string Read(string target) {",
  "    IntPtr p;",
  "    if (!CredRead(target, 1, 0, out p)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());",
  "    try {",
  "      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));",
  "      byte[] b = new byte[c.CredentialBlobSize];",
  "      Marshal.Copy(c.CredentialBlob, b, 0, (int)c.CredentialBlobSize);",
  "      return Encoding.UTF8.GetString(b);",
  "    } finally { CredFree(p); }",
  "  }",
  "}",
  "'@",
  "Add-Type -TypeDefinition $code -Language CSharp",
  `[CraftHostCredRead]::Read('${ANTIGRAVITY_HOST_CREDENTIAL_TARGET}')`,
].join("\n");

/**
 * Read the current host `agy` login blob, or null when absent/unreadable.
 * Never throws and never logs: callers treat null as "unknown host identity".
 */
export async function readAntigravityHostCredential(
  runner: HostCredentialRunner = defaultRunner(),
): Promise<string | null> {
  if (process.platform !== "win32") return null;
  try {
    const { stdout } = await runner.runPowerShell(CRED_READ_SCRIPT, "");
    const text = stdout.trim();
    return text ? text : null;
  } catch {
    return null;
  }
}

/** Extract the refresh token from a host-login blob, or undefined. */
export function hostCredentialRefreshToken(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as {
      token?: { refresh_token?: unknown };
      refresh_token?: unknown;
    };
    const candidate = parsed.token?.refresh_token ?? parsed.refresh_token;
    return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
  } catch {
    return undefined;
  }
}
/**
 * Write the payload to the host OS credential store and read it back for a
 * round-trip check. Resolves when the stored blob equals what was written.
 * The secret travels on stdin only; logs must never include payload/stdout.
 */
export async function writeAntigravityHostCredential(
  payload: string,
  runner: HostCredentialRunner = defaultRunner(),
): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error(
      `Applying an Antigravity account to the host login is only supported on Windows (current: ${process.platform}).`,
    );
  }
  if (!payload.trim().startsWith("{")) {
    throw new Error("Host credential payload must be JSON.");
  }
  const { stdout } = await runner.runPowerShell(CRED_WRITE_SCRIPT, payload);
  if (!stdout.split(/\r?\n/).some((line) => line.trim() === "HOST_CREDENTIAL_VERIFIED")) {
    throw new Error("Host credential write could not be verified.");
  }
}
