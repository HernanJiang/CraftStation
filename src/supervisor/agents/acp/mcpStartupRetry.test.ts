import { describe, expect, it } from "vitest";
import { openDroppingRejectedMcpServers, rejectedMcpServerName } from "./mcpStartupRetry";

const servers = [{ name: "notion" }, { name: "notion-oauth" }];

function rpcError(message: string, details?: string): Error {
  const error = new Error(message) as Error & { data?: { details: string } };
  if (details) error.data = { details };
  return error;
}

describe("rejectedMcpServerName", () => {
  it("reads the dsh mcp-client(name) detail", () => {
    expect(
      rejectedMcpServerName(
        rpcError(
          "Internal error",
          "mcp-client(notion-oauth): initial connection or tool synchronization failed",
        ),
        servers,
      ),
    ).toBe("notion-oauth");
  });

  it("reads mcpServers[index] from the absolute-path rejection", () => {
    expect(
      rejectedMcpServerName(
        rpcError("Invalid params: mcpServers[0].command must be an absolute path"),
        servers,
      ),
    ).toBe("notion");
  });

  it("ignores a rejection that does not name one of the servers", () => {
    expect(rejectedMcpServerName(rpcError("Internal error"), servers)).toBeUndefined();
  });
});

describe("openDroppingRejectedMcpServers", () => {
  it("retries session open without the named server", async () => {
    const calls: string[][] = [];
    const opened = await openDroppingRejectedMcpServers(servers, async (attempt) => {
      calls.push(attempt.map((server) => server.name));
      if (attempt.some((server) => server.name === "notion-oauth")) {
        throw rpcError("Internal error", "mcp-client(notion-oauth): initial connection failed");
      }
      return "ready";
    });
    expect(opened).toEqual({ result: "ready", dropped: ["notion-oauth"] });
    expect(calls).toEqual([["notion", "notion-oauth"], ["notion"]]);
  });

  it("does not retry an error that names no server", async () => {
    let calls = 0;
    await expect(
      openDroppingRejectedMcpServers(servers, async () => {
        calls += 1;
        throw rpcError("Internal error");
      }),
    ).rejects.toThrow("Internal error");
    expect(calls).toBe(1);
  });

  it("keeps a protected server and rethrows", async () => {
    let calls = 0;
    await expect(
      openDroppingRejectedMcpServers(
        [{ name: "craft_goal" }],
        async () => {
          calls += 1;
          throw rpcError("Internal error", "mcp-client(craft_goal): failed");
        },
        { protect: (name) => name === "craft_goal" },
      ),
    ).rejects.toThrow("Internal error");
    expect(calls).toBe(1);
  });
});
