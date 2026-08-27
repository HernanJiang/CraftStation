import { randomUUID } from "node:crypto";
import { CraftingError } from "@/shared/crafting/errors";
import {
  PERIPHERAL_PROTOCOL_VERSION,
  type PeripheralRequest,
  type PeripheralResponse,
  type PeripheralSidecarTransport,
  type PeripheralDiagnostic,
} from "./types";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class PeripheralSidecarClient {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly diagnostics: PeripheralDiagnostic = {
    stderrTail: "",
    exitCode: null,
    exitSignal: null,
  };
  private unsubscribeLine: (() => void) | undefined;
  private unsubscribeClose: (() => void) | undefined;

  constructor(
    private readonly transport: PeripheralSidecarTransport,
    private readonly requestTimeoutMs = 10_000,
  ) {}

  getDiagnostic(): PeripheralDiagnostic {
    return { ...this.diagnostics };
  }

  async start(): Promise<void> {
    if (this.unsubscribeLine && !this.transport.isClosed) return;
    if (this.transport.isClosed) this.cleanupSubscriptions();
    this.unsubscribeLine = this.transport.onLine((line) => this.handleLine(line));
    this.unsubscribeClose = this.transport.onClose((diagnostic) => {
      Object.assign(this.diagnostics, diagnostic);
      this.rejectPending(
        CraftingError.executionFailed(
          "Peripheral sidecar exited while a request was in flight.",
          { code: "SIDECAR_CRASH", ...diagnostic },
          "Restart the peripheral capability and retry the operation.",
        ),
      );
    });
    try {
      await this.transport.start();
    } catch (error) {
      this.cleanupSubscriptions();
      throw CraftingError.runtimeUnavailable(
        "peripheral-sidecar",
        `Failed to start peripheral sidecar: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async request<TResult = unknown, TParams = unknown>(
    method: string,
    params?: TParams,
  ): Promise<TResult> {
    if (this.transport.isClosed) {
      throw CraftingError.runtimeUnavailable(
        "peripheral-sidecar",
        "Peripheral sidecar is not running.",
      );
    }
    const requestId = randomUUID();
    const request: PeripheralRequest<TParams> = {
      protocolVersion: PERIPHERAL_PROTOCOL_VERSION,
      requestId,
      method,
      ...(params !== undefined ? { params } : {}),
    };
    return new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          CraftingError.executionFailed(`Peripheral sidecar request '${method}' timed out.`, {
            code: "SIDECAR_TIMEOUT",
            requestId,
            method,
          }),
        );
      }, this.requestTimeoutMs);
      this.pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      try {
        this.transport.write(`${JSON.stringify(request)}\n`);
      } catch (error) {
        this.pending.delete(requestId);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async ping(): Promise<{ ready: boolean; version: number }> {
    return this.request("ping");
  }

  async version(): Promise<{ name: string; version: string; protocolVersion: number }> {
    return this.request("version");
  }

  async shutdown(): Promise<void> {
    if (this.transport.isClosed) return;
    await this.request("shutdown").catch(() => undefined);
    await this.transport.stop();
  }

  async restart(): Promise<void> {
    this.cleanupSubscriptions();
    await this.transport.stop();
    this.rejectPending(
      CraftingError.executionFailed("Peripheral sidecar restarted.", { code: "SIDECAR_RESTART" }),
    );
    this.unsubscribeLine = this.transport.onLine((line) => this.handleLine(line));
    this.unsubscribeClose = this.transport.onClose((diagnostic) => {
      Object.assign(this.diagnostics, diagnostic);
      this.rejectPending(
        CraftingError.executionFailed(
          "Peripheral sidecar exited while a request was in flight.",
          { code: "SIDECAR_CRASH", ...diagnostic },
          "Restart the peripheral capability and retry the operation.",
        ),
      );
    });
    await this.transport.start();
  }

  async stop(): Promise<void> {
    this.cleanupSubscriptions();
    this.rejectPending(
      CraftingError.executionFailed("Peripheral sidecar stopped.", { code: "SIDECAR_STOPPED" }),
    );
    await this.transport.stop();
  }

  private handleLine(line: string): void {
    let message: PeripheralResponse;
    try {
      message = JSON.parse(line) as PeripheralResponse;
    } catch {
      return;
    }
    if (message.protocolVersion !== PERIPHERAL_PROTOCOL_VERSION || !message.requestId) return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(
        CraftingError.executionFailed(message.error.message, {
          code: message.error.code,
          ...(message.error.details ?? {}),
        }),
      );
    } else {
      pending.resolve(message.result);
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private cleanupSubscriptions(): void {
    this.unsubscribeLine?.();
    this.unsubscribeClose?.();
    this.unsubscribeLine = undefined;
    this.unsubscribeClose = undefined;
  }
}
