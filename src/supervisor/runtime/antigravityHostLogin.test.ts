import { describe, expect, it, vi } from "vitest";
import {
  ANTIGRAVITY_HOST_CREDENTIAL_TARGET,
  ANTIGRAVITY_HOST_CREDENTIAL_USER,
  buildAntigravityHostCredentialPayload,
  formatHostCredentialExpiry,
  writeAntigravityHostCredential,
  type HostCredentialRunner,
} from "./antigravityHostLogin";

describe("buildAntigravityHostCredentialPayload", () => {
  it("builds the exact host-login blob agy reads (consumer auth method)", () => {
    const payload = JSON.parse(
      buildAntigravityHostCredentialPayload({
        accessToken: "ya29.access",
        refreshToken: "1//refresh",
        tokenType: "Bearer",
        expiresAt: 1788588326000,
      }),
    ) as Record<string, Record<string, string>>;

    expect(payload.auth_method).toBe("consumer");
    expect(payload.token?.access_token).toBe("ya29.access");
    expect(payload.token?.token_type).toBe("Bearer");
    expect(payload.token?.refresh_token).toBe("1//refresh");
    // Microsecond ISO expiry like agm/agy consumers emit.
    expect(payload.token?.expiry).toBe("2026-09-05T06:05:26.000000Z");
  });

  it("rejects missing tokens before touching the OS store", () => {
    expect(() =>
      buildAntigravityHostCredentialPayload({ accessToken: "  ", refreshToken: "r" }),
    ).toThrow(/both an access token and a refresh token/);
    expect(() =>
      buildAntigravityHostCredentialPayload({ accessToken: "a", refreshToken: "" }),
    ).toThrow(/both an access token and a refresh token/);
  });

  it("formats expiries with microsecond precision and defaults to +1h", () => {
    expect(formatHostCredentialExpiry(1788588326000)).toBe("2026-09-05T06:05:26.000000Z");
    const fallback = new Date(formatHostCredentialExpiry(undefined)).getTime();
    expect(fallback).toBeGreaterThan(Date.now() + 50 * 60_000);
  });
});

describe("writeAntigravityHostCredential", () => {
  it("passes the payload on stdin (never argv) and requires round-trip proof", async () => {
    const runPowerShell = vi.fn<(script: string, stdin: string) => Promise<{ stdout: string }>>(
      async (_script: string, _stdin: string) => ({
        stdout: "HOST_CREDENTIAL_VERIFIED\n",
      }),
    );
    const runner: HostCredentialRunner = { runPowerShell };

    await writeAntigravityHostCredential('{"token":{}}', runner);

    expect(runPowerShell).toHaveBeenCalledTimes(1);
    const [script, stdin] = runPowerShell.mock.calls[0] as [string, string];
    expect(stdin).toBe('{"token":{}}');
    // Secret must not leak into the spawned command line.
    expect(script).not.toContain('{"token":{}}');
    expect(script).toContain(ANTIGRAVITY_HOST_CREDENTIAL_TARGET);
    expect(script).toContain(ANTIGRAVITY_HOST_CREDENTIAL_USER);
    // Atomic single write: no delete-then-write gap for concurrent readers.
    expect(script).not.toContain("CredDelete");
  });

  it("fails closed when the round-trip proof is missing", async () => {
    const runner: HostCredentialRunner = {
      runPowerShell: async () => ({ stdout: "something else\n" }),
    };
    await expect(writeAntigravityHostCredential('{"token":{}}', runner)).rejects.toThrow(
      /could not be verified/,
    );
  });

  it("rejects non-JSON payloads before spawning anything", async () => {
    const runner: HostCredentialRunner = {
      runPowerShell: vi.fn<() => Promise<{ stdout: string }>>(async () => ({
        stdout: "HOST_CREDENTIAL_VERIFIED\n",
      })),
    };
    await expect(writeAntigravityHostCredential("not-json", runner)).rejects.toThrow(
      /must be JSON/,
    );
    expect(runner.runPowerShell).not.toHaveBeenCalled();
  });
});
