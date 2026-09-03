import { describe, expect, it } from "vitest";
import { prepareNativeProfile, verifyProfileIdentity } from "./nativeProfile";
import { AccountControlError } from "@/shared/contracts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("NativeProfileSpec preparation", () => {
  it("prepares Grok profile with isolated GROK_HOME and GROK_LEADER_SOCKET", () => {
    const spec = prepareNativeProfile("grok", {
      accountId: "grok-user-1",
      credentialRoot: "D:\\test\\grok-1",
      credentialScopeRef: "managed:grok-user-1",
    });

    expect(spec.providerId).toBe("grok");
    expect(spec.accountId).toBe("grok-user-1");
    expect(spec.profilePath).toBe("D:\\test\\grok-1");
    expect(spec.env.GROK_HOME).toBe("D:\\test\\grok-1");
    expect(spec.env.GROK_LEADER_SOCKET).toBe("D:\\test\\grok-1\\leader.sock");
    expect(spec.runtimeIsolation?.socketPath).toBe("D:\\test\\grok-1\\leader.sock");
    expect(spec.runtimeIsolation?.ipcPath).toBe("D:\\test\\grok-1\\leader.sock");
  });

  it("prepares Codex profile with isolated CODEX_HOME and blanked router vars", () => {
    const spec = prepareNativeProfile("codex", {
      accountId: "codex-user-1",
      credentialRoot: "D:\\test\\codex-1",
      credentialScopeRef: "managed:codex-user-1",
    });

    expect(spec.providerId).toBe("codex");
    expect(spec.accountId).toBe("codex-user-1");
    expect(spec.profilePath).toBe("D:\\test\\codex-1");
    expect(spec.env.CODEX_HOME).toBe("D:\\test\\codex-1");
  });

  it("prepares Kimi profile with isolated KIMI_CODE_HOME", () => {
    const spec = prepareNativeProfile("kimi", {
      accountId: "kimi-user-1",
      credentialRoot: "D:\\test\\kimi-1",
      credentialScopeRef: "managed:kimi-user-1",
    });

    expect(spec.providerId).toBe("kimi");
    expect(spec.accountId).toBe("kimi-user-1");
    expect(spec.profilePath).toBe("D:\\test\\kimi-1");
    expect(spec.env.KIMI_CODE_HOME).toBe("D:\\test\\kimi-1");
  });
});

describe("verifyProfileIdentity", () => {
  it("passes when identity matches expected account", () => {
    const dir = mkdtempSync(join(tmpdir(), "grok-id-match-"));
    writeFileSync(
      join(dir, "auth.json"),
      JSON.stringify({ user: { email: "user-b@example.com" } }),
      "utf8",
    );

    expect(() =>
      verifyProfileIdentity("grok", dir, {
        accountId: "grok-b",
        providerAccountId: "user-b@example.com",
      }),
    ).not.toThrow();
  });

  it("throws PROFILE_IDENTITY_MISMATCH fail-closed when profile contains a different identity", () => {
    const dir = mkdtempSync(join(tmpdir(), "grok-id-mismatch-"));
    writeFileSync(
      join(dir, "auth.json"),
      JSON.stringify({ user: { email: "user-a@example.com" } }),
      "utf8",
    );

    expect(() =>
      verifyProfileIdentity("grok", dir, {
        accountId: "grok-b",
        providerAccountId: "user-b@example.com",
      }),
    ).toThrowError(AccountControlError);

    expect(() =>
      verifyProfileIdentity("grok", dir, {
        accountId: "grok-b",
        providerAccountId: "user-b@example.com",
      }),
    ).toThrow(expect.objectContaining({ code: "PROFILE_IDENTITY_MISMATCH" }));
  });

  it("validates Codex profile identity mismatch fail-closed", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-id-mismatch-"));
    writeFileSync(
      join(dir, "auth.json"),
      JSON.stringify({
        tokens: {
          account_id: "acc-a",
          email: "user-a@openai.com",
          access_token: "tok",
        },
      }),
      "utf8",
    );

    expect(() =>
      verifyProfileIdentity("codex", dir, {
        accountId: "codex-b",
        providerAccountId: "acc-b",
      }),
    ).toThrowError(AccountControlError);
  });
});
