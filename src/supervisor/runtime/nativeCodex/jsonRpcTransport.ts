import type { Readable, Writable } from "node:stream";
import type {
  JsonRpcId,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from "./types";
import { CraftingError } from "@/shared/crafting/errors";

export interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeoutTimer?: NodeJS.Timeout | undefined;
}

export class JsonRpcTransport {
  private _nextId = 1;
  private readonly _pendingRequests = new Map<JsonRpcId, PendingRequest>();
  private readonly _notificationListeners = new Set<(notification: JsonRpcNotification) => void>();
  private readonly _closeListeners = new Set<() => void>();
  private _serverRequestHandler?: ((request: JsonRpcRequest) => Promise<unknown>) | undefined;
  private _buffer = "";
  private _closed = false;

  constructor(
    private readonly inStream: Readable,
    private readonly outStream: Writable,
  ) {
    this.inStream.on("data", (chunk: Buffer | string) => {
      this.handleData(chunk);
    });

    this.inStream.on("close", () => {
      this.handleClose();
    });

    this.inStream.on("error", (err) => {
      this.handleError(err);
    });
  }

  get isClosed(): boolean {
    return this._closed;
  }

  setServerRequestHandler(handler: (request: JsonRpcRequest) => Promise<unknown>): void {
    this._serverRequestHandler = handler;
  }

  onNotification(listener: (notification: JsonRpcNotification) => void): () => void {
    this._notificationListeners.add(listener);
    return () => {
      this._notificationListeners.delete(listener);
    };
  }

  onClose(listener: () => void): () => void {
    this._closeListeners.add(listener);
    return () => {
      this._closeListeners.delete(listener);
    };
  }

  private handleData(chunk: Buffer | string): void {
    this._buffer += chunk.toString("utf8");
    const lines = this._buffer.split(/\r?\n/);
    this._buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as JsonRpcMessage;
        this.processMessage(msg);
      } catch (err) {
        console.error("[JsonRpcTransport] Failed to parse message:", trimmed, err);
      }
    }
  }

  private processMessage(msg: JsonRpcMessage): void {
    // 1. Response to our client request
    if ("id" in msg && ("result" in msg || "error" in msg)) {
      const res = msg as JsonRpcResponse;
      const pending = this._pendingRequests.get(res.id);
      if (pending) {
        this._pendingRequests.delete(res.id);
        if (pending.timeoutTimer) clearTimeout(pending.timeoutTimer);
        if (res.error) {
          pending.reject(
            CraftingError.executionFailed(
              `Codex JSON-RPC error ${res.error.code}: ${res.error.message}`,
              { code: res.error.code, data: res.error.data },
            ),
          );
        } else {
          pending.resolve(res.result);
        }
      }
      return;
    }

    // 2. Server request
    if ("id" in msg && "method" in msg) {
      const req = msg as JsonRpcRequest;
      if (this._serverRequestHandler) {
        this._serverRequestHandler(req)
          .then((result) => {
            this.sendResponse({
              id: req.id,
              result,
            });
          })
          .catch((err) => {
            this.sendResponse({
              id: req.id,
              error: {
                code: -32603,
                message: err instanceof Error ? err.message : String(err),
              },
            });
          });
      } else {
        this.sendResponse({
          id: req.id,
          error: {
            code: -32601,
            message: `Method not found: ${req.method}`,
          },
        });
      }
      return;
    }

    // 3. Notification
    if ("method" in msg && !("id" in msg)) {
      const notif = msg as JsonRpcNotification;
      for (const listener of this._notificationListeners) {
        try {
          listener(notif);
        } catch (err) {
          console.error("[JsonRpcTransport] Error in notification listener:", err);
        }
      }
    }
  }

  async request<TResult = unknown, TParams = unknown>(
    method: string,
    params?: TParams,
    timeoutMs = 30000,
  ): Promise<TResult> {
    if (this._closed) {
      throw CraftingError.executionFailed("Cannot send request on closed JSON-RPC transport");
    }

    const id = this._nextId++;
    const req: JsonRpcRequest<TParams> = {
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };

    return new Promise<TResult>((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this._pendingRequests.delete(id);
              reject(
                CraftingError.executionFailed(
                  `Codex JSON-RPC request '${method}' timed out after ${timeoutMs}ms`,
                  { method, id },
                ),
              );
            }, timeoutMs)
          : undefined;

      this._pendingRequests.set(id, {
        resolve: resolve as (r: unknown) => void,
        reject,
        timeoutTimer: timer,
      });

      this.sendMessage(req);
    });
  }

  notify<TParams = unknown>(method: string, params?: TParams): void {
    if (this._closed) return;
    const notif: JsonRpcNotification<TParams> = {
      method,
      ...(params !== undefined ? { params } : {}),
    };
    this.sendMessage(notif);
  }

  private sendResponse(res: JsonRpcResponse): void {
    if (this._closed) return;
    this.sendMessage(res);
  }

  private sendMessage(msg: JsonRpcMessage): void {
    // Official Codex App-Server protocol omits jsonrpc header on wire
    const raw = JSON.stringify(msg) + "\n";
    this.outStream.write(raw, "utf8");
  }

  private handleClose(): void {
    if (this._closed) return;
    this._closed = true;
    for (const [id, pending] of this._pendingRequests) {
      if (pending.timeoutTimer) clearTimeout(pending.timeoutTimer);
      pending.reject(
        CraftingError.executionFailed("Codex JSON-RPC transport closed unexpectedly", { id }),
      );
    }
    this._pendingRequests.clear();
    this._notificationListeners.clear();
    for (const listener of this._closeListeners) {
      try {
        listener();
      } catch (err) {
        console.error("[JsonRpcTransport] Error in close listener:", err);
      }
    }
    this._closeListeners.clear();
  }

  private handleError(err: Error): void {
    console.error("[JsonRpcTransport] Stream error:", err);
    this.handleClose();
  }

  close(): void {
    this.handleClose();
  }
}
