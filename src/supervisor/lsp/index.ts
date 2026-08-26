import type { SupervisorEvent } from "@/shared/ipc";
import type { LspStartPayload, LspStopPayload, LspMessagePayload } from "@/shared/lsp";
import { getConfigForLanguage } from "./serverRegistry";
import { ServerInstance } from "./serverInstance";

export class LanguageServerManager {
  private sessions = new Map<string, ServerInstance>();

  constructor(private readonly emit: (event: SupervisorEvent) => void) {}

  async start(payload: LspStartPayload): Promise<void> {
    const { sessionId, projectLocation, languageId } = payload;

    // Already running
    if (this.sessions.has(sessionId)) return;

    const config = getConfigForLanguage(languageId);
    if (!config) {
      this.emit({
        type: "lsp-status",
        sessionId,
        status: "error",
        languageId,
        error: `No language server configured for "${languageId}"`,
      });
      return;
    }

    const instance = new ServerInstance(
      sessionId,
      config,
      projectLocation,
      (message) => {
        this.emit({ type: "lsp-message", sessionId, message });
      },
      (status, error) => {
        this.emit({
          type: "lsp-status",
          sessionId,
          status,
          languageId,
          ...(error !== undefined ? { error } : {}),
        });
      },
    );

    this.sessions.set(sessionId, instance);
    try {
      await instance.start();
    } catch (error) {
      this.sessions.delete(sessionId);
      throw error;
    }
  }

  async stop(payload: LspStopPayload): Promise<void> {
    const instance = this.sessions.get(payload.sessionId);
    if (instance) {
      instance.dispose();
      this.sessions.delete(payload.sessionId);
    }
  }

  async sendMessage(payload: LspMessagePayload): Promise<unknown> {
    const instance = this.sessions.get(payload.sessionId);
    if (!instance) return undefined;
    return instance.sendMessage(payload.message);
  }

  dispose(): void {
    for (const instance of this.sessions.values()) {
      instance.dispose();
    }
    this.sessions.clear();
  }
}
