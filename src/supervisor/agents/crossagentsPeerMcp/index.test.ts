import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CROSSAGENTS_PEER_MCP_TOKEN_ENV,
  CROSSAGENTS_PEER_MCP_URL_ENV,
  resolveCrossagentsPeerMcpHttpConfig,
  resolveCrossagentsPeerMcpHttpConfigForLaunch,
} from "./index";

const URL = "http://127.0.0.1:18791";
const TOKEN = "peer-token";

describe("crossagents peer MCP launch config", () => {
  beforeEach(() => {
    process.env[CROSSAGENTS_PEER_MCP_URL_ENV] = URL;
    process.env[CROSSAGENTS_PEER_MCP_TOKEN_ENV] = TOKEN;
  });

  afterEach(() => {
    delete process.env[CROSSAGENTS_PEER_MCP_URL_ENV];
    delete process.env[CROSSAGENTS_PEER_MCP_TOKEN_ENV];
  });

  it("resolves a loopback config with the caller thread identity by default", () => {
    const config = resolveCrossagentsPeerMcpHttpConfig(
      { kind: "windows" },
      { threadId: "thread-1" },
    );
    expect(config?.url).toBe(`${URL}/mcp?thread=thread-1`);
    expect(config?.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
  });

  it("returns null without coordinates, and never hands out unreachable WSL urls", async () => {
    delete process.env[CROSSAGENTS_PEER_MCP_URL_ENV];
    expect(resolveCrossagentsPeerMcpHttpConfig({ kind: "posix" })).toBeNull();
    process.env[CROSSAGENTS_PEER_MCP_URL_ENV] = URL;
    expect(
      await resolveCrossagentsPeerMcpHttpConfigForLaunch({ kind: "wsl", distro: "Ubuntu" }, undefined),
    ).toBeUndefined();
  });

  it("rewrites loopback for NAT-mode WSL and passes mirrored mode through", async () => {
    const gateway = {
      resolveHostAccess: async () => ({ kind: "gateway", ip: "172.1.2.1" }),
    } as never;
    const rewritten = await resolveCrossagentsPeerMcpHttpConfigForLaunch(
      { kind: "wsl", distro: "Ubuntu" },
      gateway,
      { threadId: "thread-1" },
    );
    expect(rewritten?.url).toContain("172.1.2.1");
    expect(rewritten?.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });

    const loopback = {
      resolveHostAccess: async () => ({ kind: "loopback" }),
    } as never;
    const direct = await resolveCrossagentsPeerMcpHttpConfigForLaunch(
      { kind: "wsl", distro: "Ubuntu" },
      loopback,
      { threadId: "thread-1" },
    );
    expect(direct?.url).toBe(`${URL}/mcp?thread=thread-1`);
  });
});
