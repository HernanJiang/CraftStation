import { describe, expect, it } from "vitest";
import { parseDevinCredentialsToml, parseDevinEnv } from "./devinCredentials";

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
});
