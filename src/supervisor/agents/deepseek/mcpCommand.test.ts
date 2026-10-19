import { describe, expect, it, vi } from "vitest";
import type { ProjectLocation, ResolvedMcpServer } from "@/shared/contracts";
import { prepareDeepSeekMcpServers, type DeepSeekMcpCommandDeps } from "./mcpCommand";

const NOTION_SHIM = [
  "@ECHO off",
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@notionhq\\notion-mcp-server\\bin\\cli.mjs" %*',
].join("\r\n");

const windows: ProjectLocation = { kind: "windows", path: "C:\\repo" };
const posix: ProjectLocation = { kind: "posix", path: "/repo" };
const wsl: ProjectLocation = {
  kind: "wsl",
  distro: "Ubuntu",
  linuxPath: "/home/demo/repo",
  uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\demo\\repo",
};

function stdio(
  name: string,
  command: string,
  args: string[] = [],
  env: Record<string, string> = {},
): ResolvedMcpServer {
  return {
    id: name,
    name,
    timeoutMs: 30_000,
    transport: { type: "stdio", command, args, env },
  };
}

function deps(
  partial: Partial<DeepSeekMcpCommandDeps> & Pick<DeepSeekMcpCommandDeps, "resolveExecutable">,
): DeepSeekMcpCommandDeps {
  return {
    readText: () => undefined,
    exists: () => false,
    resolveWslCommand: async () => undefined,
    ...partial,
  };
}

describe("prepareDeepSeekMcpServers", () => {
  it("rewrites an npm .cmd shim into absolute node plus the shim script", async () => {
    const servers = await prepareDeepSeekMcpServers(
      [
        stdio("notion", "notion-mcp-server.cmd", ["--verbose"], { NOTION_TOKEN: "secret" }),
        {
          id: "notion-oauth",
          name: "notion-oauth",
          timeoutMs: 30_000,
          transport: { type: "http", url: "https://mcp.notion.com/mcp", headers: {} },
        },
      ],
      windows,
      deps({
        resolveExecutable(command) {
          if (command === "notion-mcp-server.cmd") {
            return "C:\\Users\\Haona\\AppData\\Roaming\\npm\\notion-mcp-server.cmd";
          }
          if (command === "node") return "C:\\Program Files\\nodejs\\node.exe";
          return undefined;
        },
        readText: (filePath) =>
          filePath.endsWith("notion-mcp-server.cmd") ? NOTION_SHIM : undefined,
        exists: (filePath) => filePath.endsWith("cli.mjs"),
      }),
    );

    expect(servers).toEqual([
      {
        id: "notion",
        name: "notion",
        timeoutMs: 30_000,
        transport: {
          type: "stdio",
          command: "C:\\Program Files\\nodejs\\node.exe",
          args: [
            "C:\\Users\\Haona\\AppData\\Roaming\\npm\\node_modules\\@notionhq\\notion-mcp-server\\bin\\cli.mjs",
            "--verbose",
          ],
          env: { NOTION_TOKEN: "secret" },
        },
      },
      {
        id: "notion-oauth",
        name: "notion-oauth",
        timeoutMs: 30_000,
        transport: { type: "http", url: "https://mcp.notion.com/mcp", headers: {} },
      },
    ]);
  });

  it("keeps an absolute Windows executable and drops a command that cannot be resolved", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const servers = await prepareDeepSeekMcpServers(
      [stdio("local", "C:\\tools\\server.exe"), stdio("missing", "not-installed")],
      windows,
      deps({ resolveExecutable: () => undefined }),
    );
    expect(servers?.map((server) => server.name)).toEqual(["local"]);
    expect(warn).toHaveBeenCalledWith(
      "[deepseek] skipping MCP server missing: stdio command is not an absolute path",
    );
    warn.mockRestore();
  });

  it("resolves a relative Windows executable against the project directory", async () => {
    const servers = await prepareDeepSeekMcpServers(
      [stdio("local", ".\\bin\\server.exe")],
      windows,
      deps({
        resolveExecutable: () => undefined,
        exists: (filePath) => filePath === "C:\\repo\\bin\\server.exe",
      }),
    );
    expect(servers?.[0]?.transport).toMatchObject({
      command: "C:\\repo\\bin\\server.exe",
    });
  });

  it("prefers node.exe beside the shim", async () => {
    const servers = await prepareDeepSeekMcpServers(
      [stdio("notion", "C:\\npm\\notion-mcp-server.cmd")],
      windows,
      deps({
        resolveExecutable: () => {
          throw new Error("PATH lookup should not run when node.exe sits beside the shim");
        },
        readText: () => NOTION_SHIM,
        exists: (filePath) => filePath === "C:\\npm\\node.exe" || filePath.endsWith("cli.mjs"),
      }),
    );
    expect(servers?.[0]?.transport).toMatchObject({
      command: "C:\\npm\\node.exe",
    });
  });

  it("resolves a bare POSIX command and leaves an absolute one unchanged", async () => {
    const servers = await prepareDeepSeekMcpServers(
      [stdio("tools", "npx", ["server"]), stdio("local", "/usr/bin/local-mcp")],
      posix,
      deps({
        resolveExecutable: (command) => (command === "npx" ? "/usr/local/bin/npx" : undefined),
      }),
    );
    expect(servers?.map((server) => server.transport)).toEqual([
      { type: "stdio", command: "/usr/local/bin/npx", args: ["server"], env: {} },
      { type: "stdio", command: "/usr/bin/local-mcp", args: [], env: {} },
    ]);
  });

  it("resolves WSL commands inside the distro and drops SSE servers", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const resolveWslCommand = vi.fn<
      (distro: string, command: string) => Promise<string | undefined>
    >(async () => "/usr/bin/npx");
    const servers = await prepareDeepSeekMcpServers(
      [
        stdio("tools", "npx"),
        stdio("abs", "/usr/local/bin/mcp"),
        {
          id: "events",
          name: "events",
          timeoutMs: 30_000,
          transport: { type: "sse", url: "https://example.test/sse", headers: {} },
        },
      ],
      wsl,
      deps({ resolveExecutable: () => undefined, resolveWslCommand }),
    );
    expect(resolveWslCommand).toHaveBeenCalledWith("Ubuntu", "npx");
    expect(servers?.map((server) => server.name)).toEqual(["tools", "abs"]);
    expect(servers?.[0]?.transport).toMatchObject({ command: "/usr/bin/npx" });
    expect(warn).toHaveBeenCalledWith(
      "[deepseek] skipping MCP server events: SSE transport is not supported",
    );
    warn.mockRestore();
  });
});
