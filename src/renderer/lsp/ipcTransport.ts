import type { SupervisorEvent } from "@/shared/ipc";
import type { LspMessagePayload } from "@/shared/lsp";
import { readBridge } from "../bridge";

/**
 * Thin IPC transport that relays JSON-RPC messages between the renderer
 * and the supervisor's language server via Electron IPC.
 */
export class LspIpcTransport {
  private unsubscribe: (() => void) | null = null;
  private messageHandler: ((message: unknown) => void) | null = null;
  private statusHandler: ((status: string, error?: string) => void) | null = null;

  constructor(readonly sessionId: string) {
    this.unsubscribe = readBridge().onSupervisorEvent((event: SupervisorEvent) => {
      if (event.type === "lsp-message" && event.sessionId === this.sessionId) {
        this.messageHandler?.(event.message);
      }
      if (event.type === "lsp-status" && event.sessionId === this.sessionId) {
        this.statusHandler?.(event.status, event.error);
      }
    });
  }

  /** Send a JSON-RPC message (request or notification) to the language server. */
  async sendMessage(message: unknown): Promise<unknown> {
    const payload: LspMessagePayload = { sessionId: this.sessionId, message };
    return readBridge().lspSendMessage(payload);
  }

  /** Subscribe to JSON-RPC messages from the language server. */
  onMessage(handler: (message: unknown) => void): void {
    this.messageHandler = handler;
  }

  /** Subscribe to server status changes. */
  onStatus(handler: (status: string, error?: string) => void): void {
    this.statusHandler = handler;
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.messageHandler = null;
    this.statusHandler = null;
  }
}
