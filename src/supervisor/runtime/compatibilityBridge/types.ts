import type { ChildProcess, SpawnOptions } from "node:child_process";

export type SpawnFunction = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

export type FetchFunction = (url: string | URL, init?: RequestInit) => Promise<Response>;

export interface CompatibilityBridgeOptions {
  host?: string | undefined;
  port?: number | undefined;
  binaryPath?: string | undefined;
  authDir?: string | undefined;
  apiKey?: string | undefined;
  debug?: boolean | undefined;
  probeTimeoutMs?: number | undefined;
  spawnFn?: SpawnFunction | undefined;
  fetchFn?: FetchFunction | undefined;
  resolveBinaryFn?: ((command: string) => string | undefined) | undefined;
  stopTimeoutMs?: number | undefined;
}

export interface CompatibilityBridgeStatus {
  running: boolean;
  endpoint?: string | undefined;
  host: string;
  port: number;
  pid?: number | undefined;
  authDir?: string | undefined;
  pinnedAccountId?: string | undefined;
  apiKey?: string | undefined;
}

export interface AccountPinConfig {
  accountId: string;
  credentialNamespace: string;
  authDir: string;
}
