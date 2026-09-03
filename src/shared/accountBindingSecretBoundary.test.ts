import { describe, expect, it } from "vitest";
import { craftAgentResultSchema } from "./ipc/schemas";
import { accountBindingSchema } from "./contracts/accountBinding";
import { nativeProfileSpecSchema } from "./contracts/nativeProfile";
import { sessionSwitchStateSchema } from "./sessionHandoff";

const sentinel = {
  apiKey: "API_KEY=sentinel-native-secret",
  token: "TOKEN=sentinel-native-secret",
  cookie: "COOKIE=sentinel-native-secret",
  proxyPassword: "proxy-password=sentinel-native-secret",
  profilePath: "C:\\Users\\secret\\managed-profile",
};

const bindingInput = {
  accountId: "codex:work",
  provider: "codex",
  credentialScopeRef: "managed:codex:work",
  reason: "selected" as const,
  boundAt: 1,
  providerAccountId: "codex:work",
  maskedIdentity: "work@example.com",
  nativeProfile: {
    providerId: "codex",
    accountId: "codex:work",
    env: { API_KEY: sentinel.apiKey, TOKEN: sentinel.token },
    profilePath: sentinel.profilePath,
    runtimeIsolation: { COOKIE: sentinel.cookie },
  },
  env: {
    API_KEY: sentinel.apiKey,
    TOKEN: sentinel.token,
    COOKIE: sentinel.cookie,
    HTTPS_PROXY: `https://user:${sentinel.proxyPassword}@proxy.invalid`,
  },
};

describe("managed account binding secret boundary", () => {
  it("keeps runtime paths and process environment out of shared binding schemas", () => {
    const parsed = accountBindingSchema.parse(bindingInput);
    const serialized = JSON.stringify(parsed);

    expect(parsed).not.toHaveProperty("nativeProfile");
    expect(parsed).not.toHaveProperty("env");
    expect(parsed).not.toHaveProperty("profilePath");
    expect(serialized).not.toContain("sentinel-native-secret");
    expect(serialized).not.toContain(sentinel.profilePath);
  });

  it("keeps NativeProfileSpec renderer-safe even when hostile launch fields are supplied", () => {
    const parsed = nativeProfileSpecSchema.parse({
      providerId: "codex",
      accountId: "codex:work",
      credentialScope: "managed:codex:work",
      env: { API_KEY: sentinel.apiKey },
      profilePath: sentinel.profilePath,
      runtimeIsolation: { COOKIE: sentinel.cookie },
    });

    expect(parsed).toEqual({
      providerId: "codex",
      accountId: "codex:work",
      credentialScope: "managed:codex:work",
    });
    expect(JSON.stringify(parsed)).not.toContain("sentinel-native-secret");
  });

  it("preserves safe provider identity through CraftAgent IPC without accepting secrets", () => {
    const parsed = craftAgentResultSchema.parse({
      threadId: "thread-1",
      entityId: "entity-1",
      sessionId: "session-1",
      response: "ok",
      accountBinding: bindingInput,
      runtimeEnv: { API_KEY: sentinel.apiKey },
    });

    expect(parsed.accountBinding).toMatchObject({
      accountId: "codex:work",
      providerAccountId: "codex:work",
      maskedIdentity: "work@example.com",
    });
    expect(parsed.accountBinding).not.toHaveProperty("nativeProfile");
    expect(parsed.accountBinding).not.toHaveProperty("env");
    expect(JSON.stringify(parsed)).not.toContain("sentinel-native-secret");
    expect(JSON.stringify(parsed)).not.toContain(sentinel.profilePath);
  });

  it("does not carry secrets through the durable session-switch state", () => {
    const parsed = sessionSwitchStateSchema.parse({
      requestId: "switch-1",
      threadId: "thread-1",
      mode: "after-current-turn",
      phase: "active",
      sourceSegmentId: "segment-1",
      targetBinding: {
        harnessKind: "codex",
        modelId: "gpt-5.3-codex",
        vendor: "openai",
        runtimeAdapterId: "codex-native-runtime",
      },
      activeAccountBinding: bindingInput,
      requestedAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
    });

    const serialized = JSON.stringify(parsed);
    expect(parsed.activeAccountBinding).not.toHaveProperty("nativeProfile");
    expect(parsed.activeAccountBinding).not.toHaveProperty("env");
    expect(serialized).not.toContain("sentinel-native-secret");
    expect(serialized).not.toContain(sentinel.profilePath);
  });
});
