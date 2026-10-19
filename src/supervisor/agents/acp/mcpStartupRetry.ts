/**
 * dsh fails the whole `session/new` when one MCP server is rejected at
 * startup (`failOnStartupError`). The JSON-RPC error names that server, so
 * the open can drop just that one and try again. Errors that do not name a
 * server stay visible.
 */

export interface McpStartupServer {
  name: string;
}

function evidenceText(error: unknown): string {
  if (!error || typeof error !== "object") return String(error ?? "");
  const candidate = error as { message?: unknown; data?: unknown };
  const data =
    candidate.data && typeof candidate.data === "object"
      ? (candidate.data as { details?: unknown; detail?: unknown; message?: unknown })
      : undefined;
  return [candidate.message, data?.details, data?.detail, data?.message]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
}

/** Server name cited by a startup rejection, if it is one of `servers`. */
export function rejectedMcpServerName(
  error: unknown,
  servers: readonly McpStartupServer[],
): string | undefined {
  const evidence = evidenceText(error);
  const named = /mcp-client\(([^)]+)\)/i.exec(evidence);
  if (named?.[1] && servers.some((server) => server.name === named[1])) return named[1];
  const indexed = /mcpServers\[(\d+)\]/i.exec(evidence);
  if (!indexed?.[1]) return undefined;
  const index = Number(indexed[1]);
  return servers[index]?.name;
}

/**
 * Call `open` and, when the failure names one server, drop that server and
 * retry. `protect` refuses the drop and rethrows the original error.
 */
export async function openDroppingRejectedMcpServers<T, Server extends McpStartupServer>(
  servers: readonly Server[],
  open: (servers: Server[]) => Promise<T>,
  options?: {
    protect?: (name: string) => boolean;
  },
): Promise<{ result: T; dropped: string[] }> {
  let current = [...servers];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (;;) {
    try {
      return { result: await open(current), dropped };
    } catch (error) {
      const name = rejectedMcpServerName(error, current);
      if (!name || seen.has(name) || options?.protect?.(name)) throw error;
      const next = current.filter((server) => server.name !== name);
      if (next.length === current.length) throw error;
      seen.add(name);
      dropped.push(name);
      current = next;
    }
  }
}
