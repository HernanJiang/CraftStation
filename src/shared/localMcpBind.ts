/**
 * Loopback bind for in-process MCP HTTP servers.
 *
 * Binding `0.0.0.0` on Windows raises the "allow public and private networks"
 * firewall dialog. Portable builds unpack to a new temp path on every launch,
 * so "Allow" never sticks. Loopback does not trip that prompt.
 *
 * WSL mirrored networking still reaches `127.0.0.1`. NAT-mode WSL reaches the
 * browser MCP through the in-distro reverse proxy; Own Subagents / app-controls
 * URLs stay on loopback and are rewritten only in mirrored mode.
 */
export const LOCAL_MCP_BIND_HOST = "127.0.0.1" as const;
