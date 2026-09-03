import type {
  CodexApprovalDecisionParams,
  CodexInitializeParams,
  CodexInitializeResult,
  CodexModelInfo,
  CodexThreadStartParams,
  CodexThreadStartResult,
  CodexTurnInterruptParams,
  CodexTurnStartParams,
  CodexTurnStartResult,
  CodexTurnSteerParams,
  JsonRpcNotification,
  JsonRpcRequest,
} from "./types";
import { JsonRpcTransport } from "./jsonRpcTransport";
import { CraftingError } from "@/shared/crafting/errors";

export interface CodexRuntimeCapabilitySnapshot {
  serverInfo: {
    name: string;
    version: string;
  };
  capabilities: Record<string, unknown>;
  authenticated: boolean;
  account?: string | null | undefined;
  models: CodexModelInfo[];
}

export class AppServerClient {
  private _initialized = false;
  private _initResult?: CodexInitializeResult | undefined;
  private _cachedModels: CodexModelInfo[] = [];

  constructor(private readonly transport: JsonRpcTransport) {}

  get isInitialized(): boolean {
    return this._initialized;
  }

  get capabilities(): Record<string, unknown> {
    return this._initResult?.capabilities ?? {};
  }

  get serverInfo(): { name: string; version: string } | undefined {
    return (
      this._initResult?.serverInfo ?? {
        name: "codex-app-server",
        version: this._initResult?.userAgent ?? "unknown",
      }
    );
  }

  onNotification(listener: (notification: JsonRpcNotification) => void): () => void {
    return this.transport.onNotification(listener);
  }

  onClose(listener: () => void): () => void {
    return this.transport.onClose(listener);
  }

  setServerRequestHandler(handler: (request: JsonRpcRequest) => Promise<unknown>): void {
    this.transport.setServerRequestHandler(handler);
  }

  async initialize(
    clientInfo = { name: "CraftStation", version: "0.3.0" },
  ): Promise<CodexInitializeResult> {
    if (this._initialized && this._initResult) {
      return this._initResult;
    }

    const params: CodexInitializeParams = {
      clientInfo,
      capabilities: {
        // Official collaboration/sub-agent items are emitted on the app-server's
        // experimental notification surface. CraftStation consumes those native
        // identities rather than synthesizing child agents.
        experimentalApi: true,
        requestAttestation: false,
      },
    };

    try {
      const result = await this.transport.request<CodexInitializeResult>(
        "initialize",
        params,
        15000,
      );
      this._initResult = result;
      this.transport.notify("initialized");
      this._initialized = true;
      return result;
    } catch (err) {
      throw CraftingError.executionFailed(
        `Failed to initialize Codex App-Server: ${err instanceof Error ? err.message : String(err)}`,
        { clientInfo },
        "Verify that the official Codex app-server is running and compatible.",
      );
    }
  }

  async listModels(): Promise<CodexModelInfo[]> {
    if (!this._initialized) {
      await this.initialize();
    }

    try {
      const res = await this.transport.request<any>("model/list", {}, 10000);
      // Official Codex App-Server returns { data: [ ... ], nextCursor } or { models: [ ... ] }
      const rawList = Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res?.models)
          ? res.models
          : [];
      const models: CodexModelInfo[] = rawList.map((m: any) => ({
        id: m.id || m.model || "unknown",
        displayName: m.displayName || m.name || m.id,
        vendor: m.vendor || "openai",
        contextWindow: m.contextWindow,
        supportsStreaming: m.supportsStreaming ?? true,
        supportsToolCalling: m.supportsToolCalling ?? true,
        inputModalities: m.inputModalities,
        reasoningEfforts: m.supportedReasoningEfforts?.map((r: any) => r.reasoningEffort || r),
        serviceTiers: m.serviceTiers?.map((s: any) => s.id || s),
      }));

      this._cachedModels = models;
      return models;
    } catch (err) {
      // F03: Do NOT silently return fake builtin models on failure. Throw observable error.
      throw CraftingError.executionFailed(
        `Failed to fetch official model list from Codex app-server: ${err instanceof Error ? err.message : String(err)}`,
        { error: String(err) },
        "Verify network connection and active authentication with Codex.",
      );
    }
  }

  async readAccount(): Promise<Record<string, unknown> | undefined> {
    if (!this._initialized) {
      await this.initialize();
    }
    try {
      return await this.transport.request<Record<string, unknown>>("account/read", {}, 10000);
    } catch {
      return undefined;
    }
  }

  async readRateLimits(): Promise<Record<string, unknown> | undefined> {
    if (!this._initialized) {
      await this.initialize();
    }
    try {
      return await this.transport.request<Record<string, unknown>>(
        "account/rateLimits/read",
        {},
        10000,
      );
    } catch {
      return undefined;
    }
  }

  async getCapabilitySnapshot(): Promise<CodexRuntimeCapabilitySnapshot> {
    const init = await this.initialize();
    const models = await this.listModels();

    return {
      serverInfo: this.serverInfo ?? { name: "codex-app-server", version: "unknown" },
      capabilities: init.capabilities ?? {},
      authenticated: init.authStatus?.authenticated ?? true,
      account: init.authStatus?.account,
      models,
    };
  }

  async startThread(params: CodexThreadStartParams): Promise<CodexThreadStartResult> {
    if (!this._initialized) await this.initialize();
    return this.transport.request<CodexThreadStartResult>("thread/start", params);
  }

  async resumeThread(params: { threadId: string }): Promise<CodexThreadStartResult> {
    if (!this._initialized) await this.initialize();
    return this.transport.request<CodexThreadStartResult>("thread/resume", params);
  }

  async startTurn(params: CodexTurnStartParams): Promise<CodexTurnStartResult> {
    if (!this._initialized) await this.initialize();
    return this.transport.request<CodexTurnStartResult>("turn/start", params);
  }

  async steerTurn(params: CodexTurnSteerParams): Promise<void> {
    if (!this._initialized) await this.initialize();
    return this.transport.request<void>("turn/steer", params);
  }

  async interruptTurn(params: CodexTurnInterruptParams): Promise<void> {
    if (!this._initialized) await this.initialize();
    return this.transport.request<void>("turn/interrupt", params);
  }

  async respondApproval(params: CodexApprovalDecisionParams): Promise<void> {
    if (!this._initialized) await this.initialize();
    return this.transport.request<void>("approval/respond", params);
  }
}
