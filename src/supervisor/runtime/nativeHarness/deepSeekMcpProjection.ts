import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSeq, parseDocument } from "yaml";
import type { ResolvedMcpServer } from "@/shared/contracts";

/** Official DSH Cordis overlay; credentials travel in the child env. */
export function createDeepSeekMcpProjection(
  servers: readonly ResolvedMcpServer[],
  baseConfig?: string,
) {
  if (!servers.length) return undefined;
  const env: Record<string, string> = {};
  const rows: string[] = [];
  for (const [index, server] of servers.entries()) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(server.name)) throw new Error("DSH_MCP_INVALID_NAME");
    if (server.transport.type === "sse") throw new Error("DSH_MCP_UNSUPPORTED_TRANSPORT");
    const prefix = `CRAFTSTATION_DSH_MCP_${index}`;
    const config = {
      serverName: server.name,
      transport: server.transport.type === "http" ? "streamable-http" : "stdio",
      toolCallTimeoutMs: server.timeoutMs,
      failOnStartupError: true,
      ...(server.transport.type === "stdio"
        ? { command: server.transport.command, args: server.transport.args }
        : { url: server.transport.url }),
    };
    const entries = Object.entries(config).map(
      ([key, value]) => `    ${key}: ${JSON.stringify(value)}`,
    );
    if (server.transport.type === "http") {
      env[`${prefix}_HEADERS`] = JSON.stringify(server.transport.headers);
      entries.push(
        `    headers: !!js ${JSON.stringify(`JSON.parse(process.env.${prefix}_HEADERS ?? '{}')`)}`,
      );
    } else {
      env[`${prefix}_ENV`] = JSON.stringify(server.transport.env);
      entries.push(
        `    env: !!js ${JSON.stringify(`JSON.parse(process.env.${prefix}_ENV ?? '{}')`)}`,
      );
      entries.push("    cwd: !!js process.env.DSH_CWD ?? process.cwd()");
    }
    rows.push(
      `- id: ${JSON.stringify(`craftstation-mcp-${server.id}`)}\n  name: '@deepseek-ai/dsh-mcp-client'\n  config:\n${entries.join("\n")}`,
    );
  }
  let content: string;
  if (baseConfig) {
    const original = readFileSync(baseConfig, "utf8");
    const document = parseDocument(original);
    if (document.errors.length || !isSeq(document.contents))
      throw new Error("DSH_MCP_CONFIG_REQUIRES_PLUGIN_SEQUENCE");
    content = `${original}\n${rows.join("\n")}\n`;
  } else {
    content = `- insert:\n${rows
      .join("\n")
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n")}\n`;
  }
  const directory = mkdtempSync(join(tmpdir(), "craftstation-dsh-mcp-"));
  const configPath = join(directory, "mcp.cordis.yml");
  try {
    writeFileSync(configPath, content, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    configPath,
    env,
    dispose: () => {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
