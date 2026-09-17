import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasDevinCredentialContent,
  parseDevinAuthStatus,
  parseDevinCredentialsToml,
  parseDevinEnv,
  resetDevinIdentityCache,
  resolveDevinIdentity,
  resolveDevinToken,
} from "./devinCredentials";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn<typeof actual.existsSync>() };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn<typeof actual.readFile>() };
});

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const existsSyncMock = vi.mocked(existsSync);
const readFileMock = vi.mocked(readFile);

const REAL_CLI_TOML = [
  'windsurf_api_key = "devin-session-token$eyJhbGciOiJIUzI1NiJ9.eyJzZXNzaW9uX2lkIjoidGVzdCJ9.sig"',
  'api_server_url = "https://server.codeium.com"',
  'devin_api_url = "https://api.devin.ai"',
  "",
].join("\n");

const LOGGED_IN_STATUS = [
  "Logged in (via Devin).",
  "",
  "Credentials:",
  "  File:              C:\\Users\\test\\AppData\\Roaming\\devin\\credentials.toml",
  "  API server:        https://server.codeium.com",
  "  Devin webapp:      https://app.devin.ai",
  "  Devin API:         https://api.devin.ai",
  "",
  "User:",
  "  Name:              Hernan Jiang",
  "  Email:             poise.johnson@gmail.com",
  "  User ID:           user-8ca18c90d361460aa5f4c5381faaf02a",
  "",
  "Account:",
  "  Tier:              Devin Pro",
  "  Plan:              Pro",
  "  Team ID:           devin-team$account-166deb2546964232ae8eb04f1263ed1e",
  "  Team membership:   Approved",
  "",
].join("\n");

beforeEach(() => {
  resetDevinIdentityCache();
  existsSyncMock.mockReset();
  readFileMock.mockReset();
  delete process.env.DEVIN_API_KEY;
  delete process.env.WINDSURF_API_KEY;
});

describe("parseDevinEnv", () => {
  it("prefers DEVIN_API_KEY then WINDSURF_API_KEY", () => {
    expect(parseDevinEnv({ DEVIN_API_KEY: " cog_a " })?.accessToken).toBe("cog_a");
    expect(parseDevinEnv({ WINDSURF_API_KEY: "cog_b" })?.accessToken).toBe("cog_b");
    expect(parseDevinEnv({})).toBeUndefined();
  });
});

describe("parseDevinCredentialsToml", () => {
  it("reads a top-level token and email", () => {
    expect(parseDevinCredentialsToml('token = "cog_cli"\nemail = "me@devin.ai"\n')).toEqual({
      accessToken: "cog_cli",
      email: "me@devin.ai",
      accountId: "me@devin.ai",
    });
  });

  it("reads nested api_key / plan tables", () => {
    const token = parseDevinCredentialsToml(`
[auth]
api_key = "cog_nested"
plan = "Teams"
`);
    expect(token).toMatchObject({
      accessToken: "cog_nested",
      subscriptionType: "Teams",
    });
  });

  it("rejects empty or token-less files", () => {
    expect(parseDevinCredentialsToml('email = "me@devin.ai"\n')).toBeUndefined();
    expect(parseDevinCredentialsToml("not toml {{{")).toBeUndefined();
  });

  it("reads the current CLI session-token format", () => {
    expect(parseDevinCredentialsToml(REAL_CLI_TOML)?.accessToken).toContain("devin-session-token$");
  });
});

describe("hasDevinCredentialContent", () => {
  it("accepts the persisted CLI login and rejects leftovers", () => {
    expect(hasDevinCredentialContent(REAL_CLI_TOML)).toBe(true);
    expect(hasDevinCredentialContent("")).toBe(false);
    expect(hasDevinCredentialContent('email = "me@devin.ai"\n')).toBe(false);
    expect(hasDevinCredentialContent("not toml {{{")).toBe(false);
  });
});

describe("parseDevinAuthStatus", () => {
  it("reads identity and prefers Plan over Tier", () => {
    expect(parseDevinAuthStatus(LOGGED_IN_STATUS)).toEqual({
      email: "poise.johnson@gmail.com",
      name: "Hernan Jiang",
      userId: "user-8ca18c90d361460aa5f4c5381faaf02a",
      plan: "Pro",
    });
  });

  it("falls back to Tier when Plan is absent", () => {
    const withoutPlan = LOGGED_IN_STATUS.replace(/^\s*Plan:.*$/m, "");
    expect(parseDevinAuthStatus(withoutPlan)?.plan).toBe("Devin Pro");
  });

  it("rejects logged-out and garbage output", () => {
    expect(parseDevinAuthStatus("Not logged in.\n")).toBeUndefined();
    expect(parseDevinAuthStatus("")).toBeUndefined();
    expect(parseDevinAuthStatus("Logged in (via Devin).\n")).toBeUndefined();
  });
});

describe("resolveDevinIdentity", () => {
  it("caches the CLI identity within the TTL window", async () => {
    const runner = vi.fn<() => Promise<string>>(async () => LOGGED_IN_STATUS);
    await expect(resolveDevinIdentity(runner)).resolves.toMatchObject({
      email: "poise.johnson@gmail.com",
    });
    await expect(resolveDevinIdentity(runner)).resolves.toMatchObject({
      email: "poise.johnson@gmail.com",
    });
    expect(runner).toHaveBeenCalledTimes(1);
    resetDevinIdentityCache();
    await expect(resolveDevinIdentity(runner)).resolves.toMatchObject({
      email: "poise.johnson@gmail.com",
    });
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("degrades to undefined when the CLI is missing", async () => {
    await expect(resolveDevinIdentity(async () => "")).resolves.toBeUndefined();
    await expect(
      resolveDevinIdentity(async () => {
        throw new Error("not found");
      }),
    ).resolves.toBeUndefined();
  });
});

describe("resolveDevinToken identity enrichment", () => {
  it("attaches CLI identity to the persisted file login", async () => {
    existsSyncMock.mockReturnValue(true);
    readFileMock.mockResolvedValue(REAL_CLI_TOML);
    const token = await resolveDevinToken({ authStatusRunner: async () => LOGGED_IN_STATUS });
    expect(token?.accessToken).toContain("devin-session-token$");
    expect(token).toMatchObject({
      email: "poise.johnson@gmail.com",
      accountId: "user-8ca18c90d361460aa5f4c5381faaf02a",
      subscriptionType: "Pro",
    });
  });

  it("never borrows CLI identity for an env/pasted key", async () => {
    process.env.DEVIN_API_KEY = "cog_pasted";
    const token = await resolveDevinToken({ authStatusRunner: async () => LOGGED_IN_STATUS });
    expect(token).toEqual({ accessToken: "cog_pasted" });
    expect(existsSyncMock).not.toHaveBeenCalled();
  });

  it("returns the bare file token when the CLI status is unavailable", async () => {
    existsSyncMock.mockReturnValue(true);
    readFileMock.mockResolvedValue(REAL_CLI_TOML);
    const token = await resolveDevinToken({
      authStatusRunner: async () => {
        throw new Error("no cli");
      },
    });
    expect(token?.accessToken).toContain("devin-session-token$");
    expect(token?.email).toBeUndefined();
  });
});
