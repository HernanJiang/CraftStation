// Single source of truth for the desktop dev-server port. `pnpm run dev`
// defaults to 3100; smoke runs and parallel worktrees override it with
// CRAFTSTATION_DEV_SERVER_PORT so multiple dev apps can run side by side.
// vite.config.ts inlines the same resolution (it cannot import this module
// without dragging scripts/ into the typechecked config graph).

export function resolveDevServerPort() {
  const raw = process.env.CRAFTSTATION_DEV_SERVER_PORT?.trim();
  if (!raw) return 3100;
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`CRAFTSTATION_DEV_SERVER_PORT must be a TCP port between 1 and 65535, got: ${raw}`);
  }
  return port;
}
