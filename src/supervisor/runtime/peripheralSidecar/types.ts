export const PERIPHERAL_PROTOCOL_VERSION = 1 as const;

export interface PeripheralRequest<TParams = unknown> {
  protocolVersion: typeof PERIPHERAL_PROTOCOL_VERSION;
  requestId: string;
  method: string;
  params?: TParams;
}

export interface PeripheralError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PeripheralResponse<TResult = unknown> {
  protocolVersion: typeof PERIPHERAL_PROTOCOL_VERSION;
  requestId: string;
  result?: TResult;
  error?: PeripheralError;
}

export interface PeripheralDiagnostic {
  stderrTail: string;
  exitCode: number | null;
  exitSignal: string | null;
}

export interface PeripheralSidecarOptions {
  binaryPath?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  requestTimeoutMs?: number;
}

export interface PeripheralSidecarTransport {
  readonly isClosed: boolean;
  start(): Promise<void>;
  write(line: string): void;
  onLine(listener: (line: string) => void): () => void;
  onClose(listener: (diagnostic: PeripheralDiagnostic) => void): () => void;
  stop(): Promise<void>;
}
