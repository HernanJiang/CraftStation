import { randomUUID } from "node:crypto";
import type {
  CraftPlan,
  CraftSession,
  CraftSessionStatus,
  Entity,
  HarnessRuntimeAdapter,
  NativeEventEnvelope,
  NativeHarnessDescriptor,
  NativeHarnessDiagnostic,
  SessionSnapshot,
  StartTurnCommand,
  TurnResult,
} from "@/shared/crafting";
import type { ProjectLocation, ResolvedMcpServer } from "@/shared/contracts";
import type { RuntimeEvent } from "@/shared/contracts/runtimeEvent";
import { CraftingError } from "@/shared/crafting/errors";
import {
  DefaultDeepSeekApiMcpRuntime,
  type DeepSeekApiMcpRuntime,
  type DeepSeekApiToolDefinition,
} from "./deepSeekApiMcp";

const DEFAULT_API_BASE_URL = "https://api.deepseek.com/v1";
const DEFAULT_API_KEY_ENV = "DEEPSEEK_API_KEY";
// A model request can legitimately spend an unbounded amount of time in
// reasoning or an MCP round-trip.  A timeout is therefore opt-in: `0` means
// no host deadline and is the default.  Cancellation still uses the caller's
// AbortSignal.
const DEFAULT_REQUEST_TIMEOUT_MS = 0;
// Tool rounds are also unbounded by default. A positive value is an explicit
// safety ceiling supplied in the CraftPlan runtime options.
const DEFAULT_MAX_TOOL_ROUNDS = 0;
const MAX_TOKEN_FINISH_REASONS = new Set(["length", "max_tokens", "max-tokens"]);
const MAX_TOKEN_CONTINUATION_PROMPT =
  "Continue the task from the previous partial response. Do not repeat completed work; resume from where you stopped and finish the requested task.";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function stringOption(options: Record<string, unknown>, key: string): string | undefined {
  const value = options[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nonNegativeNumberOption(
  options: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = options[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function nonNegativeIntegerOption(
  options: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = nonNegativeNumberOption(options, key);
  return value !== undefined && Number.isInteger(value) ? value : undefined;
}

function errorMessage(value: unknown): string {
  const body = record(value);
  const nested = record(body?.error);
  const message = nested?.message ?? body?.message;
  return typeof message === "string" ? message : "DeepSeek API request failed.";
}

function safeEnvelope(
  descriptor: NativeHarnessDescriptor,
  nativeType: string,
  sequence: number,
): NativeEventEnvelope {
  return {
    harnessKind: descriptor.harnessKind,
    source: "canonical-adapter",
    nativeType,
    sequence,
    receivedAt: new Date().toISOString(),
  };
}

interface DeepSeekApiSessionOptions {
  descriptor: NativeHarnessDescriptor;
  plan: CraftPlan;
  projectLocation: ProjectLocation;
  baseUrl: string;
  apiKeyEnv: string;
  requestTimeoutMs: number;
  maxTokenContinuations: number | undefined;
  maxToolRounds: number;
  mcpRuntime?: DeepSeekApiMcpRuntime;
  inlineSkillInstructions?: string;
}

interface ApiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface StreamingTurnResult {
  response: string;
  reasoning: string;
  toolCalls: ApiToolCall[];
  promptTokens?: number;
  finishReason?: string;
}

class DeepSeekApiCraftSession implements CraftSession {
  private _status: CraftSessionStatus = "idle";
  private _activeTurnId: string | undefined;
  private _activeAbort: AbortController | undefined;
  private _disposed = false;
  private _sequence = 0;
  private _response = "";
  private readonly _messages: JsonRecord[] = [];
  private readonly _events: RuntimeEvent[] = [];
  private readonly _nativeEvents: NativeEventEnvelope[] = [];
  private readonly _diagnostics: NativeHarnessDiagnostic[] = [];
  private readonly _listeners = new Set<(event: RuntimeEvent, snapshot: SessionSnapshot) => void>();

  constructor(
    readonly id: string,
    readonly entityId: string,
    readonly threadId: string,
    private readonly options: DeepSeekApiSessionOptions,
    private readonly onTerminated: () => void,
  ) {}

  get status(): CraftSessionStatus {
    return this._status;
  }

  get sessionRef(): string | undefined {
    return undefined;
  }

  get nativeSessionRef(): string | undefined {
    return undefined;
  }

  getDiagnostics(): readonly NativeHarnessDiagnostic[] {
    return [...this._diagnostics];
  }

  getSnapshot(): SessionSnapshot {
    return {
      sessionId: this.id,
      entityId: this.entityId,
      threadId: this.threadId,
      status: this._status,
      activeTurnId: this._activeTurnId,
      activeTurnStatus: this._activeTurnId ? "running" : undefined,
      events: [...this._events],
      nativeEvents: [...this._nativeEvents],
      diagnostics: [...this._diagnostics],
      runtimeConfig: {
        model: this.options.plan.overrides?.model ?? this.options.plan.runtimeBinding.modelId,
        ...(this.options.plan.workspace ? { workspace: this.options.plan.workspace } : {}),
      },
    };
  }

  subscribe(listener: (event: RuntimeEvent, snapshot: SessionSnapshot) => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private emit(event: RuntimeEvent, nativeType: string = event.type): void {
    const next = {
      ...event,
      nativeEnvelope: safeEnvelope(this.options.descriptor, nativeType, this._sequence++),
    } as RuntimeEvent;
    this._events.push(next);
    this._nativeEvents.push(next.nativeEnvelope!);
    const snapshot = this.getSnapshot();
    for (const listener of this._listeners) listener(next, snapshot);
  }

  private diagnostic(code: NativeHarnessDiagnostic["code"], message: string): void {
    this._diagnostics.push({
      code,
      harnessKind: this.options.descriptor.harnessKind,
      phase: "turn",
      operation: "chat/completions",
      message: message.slice(0, 500),
      occurredAt: new Date().toISOString(),
    });
  }

  private requestBody(
    messages: readonly JsonRecord[],
    tools: readonly DeepSeekApiToolDefinition[],
  ): JsonRecord {
    return {
      model: this.options.plan.overrides?.model ?? this.options.plan.runtimeBinding.modelId,
      messages: this.options.inlineSkillInstructions
        ? [{ role: "system", content: this.options.inlineSkillInstructions }, ...messages]
        : messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(tools.length > 0
        ? {
            // mcpServerName/mcpToolName are CraftStation observability fields.
            // Keep the provider wire payload strictly OpenAI-compatible.
            tools: tools.map(({ type, function: definition }) => ({
              type,
              function: definition,
            })),
            tool_choice: "auto",
          }
        : {}),
    };
  }

  private async readStreamingResponse(
    response: Response,
    turnId: string,
  ): Promise<StreamingTurnResult> {
    if (!response.body) throw new Error("DeepSeek API returned no streaming body.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let responseText = "";
    let reasoningText = "";
    let promptTokens: number | undefined;
    let finishReason: string | undefined;
    const toolCalls = new Map<number, ApiToolCall>();
    const consume = (line: string) => {
      if (!line.startsWith("data: ")) return;
      const payload = line.slice(6).trim();
      if (!payload || payload === "[DONE]") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return;
      }
      const choices = record(parsed)?.choices;
      const choice = Array.isArray(choices) ? record(choices[0]) : undefined;
      const delta = record(choice?.delta);
      if (typeof choice?.finish_reason === "string") finishReason = choice.finish_reason;
      const text = typeof delta?.content === "string" ? delta.content : "";
      const reasoning = typeof delta?.reasoning_content === "string" ? delta.reasoning_content : "";
      const usage = record(record(parsed)?.usage);
      if (typeof usage?.prompt_tokens === "number") promptTokens = usage.prompt_tokens;
      if (Array.isArray(delta?.tool_calls)) {
        for (const entry of delta.tool_calls) {
          const chunk = record(entry);
          const index = typeof chunk?.index === "number" ? chunk.index : toolCalls.size;
          const current = toolCalls.get(index) ?? {
            id: "",
            type: "function" as const,
            function: { name: "", arguments: "" },
          };
          const functionChunk = record(chunk?.function);
          if (typeof chunk?.id === "string") current.id += chunk.id;
          if (typeof functionChunk?.name === "string") current.function.name += functionChunk.name;
          if (typeof functionChunk?.arguments === "string") {
            current.function.arguments += functionChunk.arguments;
          }
          toolCalls.set(index, current);
        }
      }
      if (text) {
        responseText += text;
        this.emit(
          {
            type: "content.delta",
            threadId: this.threadId,
            itemId: `assistant:${turnId}`,
            stream: "assistant_text",
            delta: text,
          },
          "chat.completions.delta",
        );
      }
      if (reasoning) {
        reasoningText += reasoning;
        this.emit(
          {
            type: "content.delta",
            threadId: this.threadId,
            itemId: `reasoning:${turnId}`,
            stream: "reasoning_text",
            delta: reasoning,
          },
          "chat.completions.reasoning_delta",
        );
      }
    };
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? "";
      for (const line of lines) consume(line);
    }
    consume(buffer);
    return {
      response: responseText,
      reasoning: reasoningText,
      toolCalls: [...toolCalls.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, call]) => call),
      ...(promptTokens !== undefined ? { promptTokens } : {}),
      ...(finishReason ? { finishReason } : {}),
    };
  }

  private async executeToolCall(
    call: ApiToolCall,
    signal: AbortSignal,
    tools: readonly DeepSeekApiToolDefinition[],
  ): Promise<JsonRecord> {
    const runtime = this.options.mcpRuntime;
    if (!runtime) throw new Error("DeepSeek API requested a tool without an MCP runtime.");
    const definition = tools.find((tool) => tool.function.name === call.function.name);
    const identity = {
      ...(definition?.mcpServerName ? { mcpServerName: definition.mcpServerName } : {}),
      ...(definition?.mcpToolName ? { mcpToolName: definition.mcpToolName } : {}),
    };
    let args: Record<string, unknown> = {};
    if (call.function.arguments.trim()) {
      const parsed = JSON.parse(call.function.arguments) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`Tool '${call.function.name}' arguments must be a JSON object.`);
      }
      args = parsed as Record<string, unknown>;
    }
    const itemId = `mcp:${call.id || randomUUID()}`;
    this.emit({
      type: "item.started",
      threadId: this.threadId,
      itemId,
      itemType: "mcp_tool_call",
      payload: { name: call.function.name, ...identity, args, status: "running" },
    });
    try {
      const result = await runtime.callTool(call.function.name, args, signal);
      this.emit({
        type: "item.completed",
        threadId: this.threadId,
        itemId,
        payload: {
          name: call.function.name,
          ...identity,
          status: result.isError ? "error" : "success",
          result: result.content,
        },
      });
      return {
        role: "tool",
        tool_call_id: call.id,
        content: result.content,
      };
    } catch (error) {
      this.emit({
        type: "item.completed",
        threadId: this.threadId,
        itemId,
        payload: {
          name: call.function.name,
          ...identity,
          status: "error",
          result: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  async startTurn(command: StartTurnCommand): Promise<TurnResult> {
    if (this._disposed) {
      throw CraftingError.executionFailed(
        "Cannot start a turn on a disposed DeepSeek API session.",
      );
    }
    if (this._activeTurnId) {
      throw CraftingError.executionFailed("A DeepSeek API turn is already active.");
    }
    const turnId = command.turnId ?? `turn:${randomUUID()}`;
    const turnStart = this._events.length;
    const controller = new AbortController();
    this._activeTurnId = turnId;
    this._activeAbort = controller;
    this._status = "busy";
    this._response = "";
    this.emit({ type: "turn.started", threadId: this.threadId, turnId });
    const abortFromCaller = () => controller.abort();
    command.signal?.addEventListener("abort", abortFromCaller, { once: true });
    try {
      const tools = (await this.options.mcpRuntime?.listTools(controller.signal)) ?? [];
      const turnMessages: JsonRecord[] = [{ role: "user", content: command.prompt }];
      let finalReasoning = "";
      let promptTokens: number | undefined;
      let maxTokenContinuationsRemaining = this.options.maxTokenContinuations;
      let toolRounds = 0;
      while (true) {
        const requestSignal =
          this.options.requestTimeoutMs > 0
            ? AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(this.options.requestTimeoutMs),
              ])
            : controller.signal;
        const response = await fetch(`${this.options.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${process.env[this.options.apiKeyEnv] ?? ""}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(this.requestBody([...this._messages, ...turnMessages], tools)),
          signal: requestSignal,
        });
        if (!response.ok) {
          const body = await response.text();
          let parsedBody: unknown;
          try {
            parsedBody = JSON.parse(body);
          } catch {
            parsedBody = undefined;
          }
          const message = errorMessage(parsedBody ?? body);
          this.diagnostic(
            response.status === 401 ? "AUTH_REQUIRED" : "NATIVE_EXECUTION_FAILED",
            message,
          );
          throw response.status === 401
            ? CraftingError.authRequired("deepseek-api", message)
            : CraftingError.executionFailed(message, { status: response.status });
        }
        const result = await this.readStreamingResponse(response, turnId);
        finalReasoning += result.reasoning;
        promptTokens = result.promptTokens ?? promptTokens;
        if (result.toolCalls.length === 0) {
          this._response += result.response;
          turnMessages.push({
            role: "assistant",
            content: result.response,
            ...(result.reasoning ? { reasoning_content: result.reasoning } : {}),
          });
          if (MAX_TOKEN_FINISH_REASONS.has(result.finishReason ?? "")) {
            if (
              maxTokenContinuationsRemaining !== undefined &&
              maxTokenContinuationsRemaining <= 0
            ) {
              this.diagnostic(
                "NATIVE_EXECUTION_FAILED",
                "DeepSeek API reached the output limit before the task was complete.",
              );
              throw CraftingError.executionFailed(
                "DeepSeek API reached the output limit before the task was complete.",
                {
                  finishReason: result.finishReason,
                  continuations: this.options.maxTokenContinuations,
                },
              );
            }
            if (maxTokenContinuationsRemaining !== undefined) maxTokenContinuationsRemaining -= 1;
            this.diagnostic(
              "NATIVE_EXECUTION_FAILED",
              maxTokenContinuationsRemaining === undefined
                ? "DeepSeek API reached the output limit; continuing the active task without a host continuation limit."
                : `DeepSeek API reached the output limit; continuing the active task (${maxTokenContinuationsRemaining} continuation(s) remaining).`,
            );
            turnMessages.push({ role: "user", content: MAX_TOKEN_CONTINUATION_PROMPT });
            continue;
          }
          break;
        }
        turnMessages.push({
          role: "assistant",
          content: result.response || null,
          ...(result.reasoning ? { reasoning_content: result.reasoning } : {}),
          tool_calls: result.toolCalls,
        });
        for (const call of result.toolCalls) {
          turnMessages.push(await this.executeToolCall(call, controller.signal, tools));
        }
        toolRounds += 1;
        if (this.options.maxToolRounds > 0 && toolRounds >= this.options.maxToolRounds) {
          throw new Error(`DeepSeek API exceeded ${this.options.maxToolRounds} MCP tool rounds.`);
        }
      }
      this._messages.push(...turnMessages);
      if (promptTokens !== undefined) {
        this.emit({
          type: "context.updated",
          threadId: this.threadId,
          usage: { usedTokens: promptTokens },
        });
      }
      this._status = "idle";
      this.emit({ type: "turn.completed", threadId: this.threadId, turnId, state: "completed" });
      return {
        turnId,
        status: "completed",
        events: this._events.slice(turnStart),
        response: this._response,
      };
    } catch (error) {
      const interrupted = controller.signal.aborted || command.signal?.aborted;
      if (interrupted) {
        this._status = "idle";
        this.emit({
          type: "turn.completed",
          threadId: this.threadId,
          turnId,
          state: "interrupted",
        });
        return { turnId, status: "interrupted", events: this._events.slice(turnStart) };
      }
      this._status = "error";
      this.emit({ type: "error", threadId: this.threadId, message: errorMessage(error) });
      this.emit({ type: "turn.completed", threadId: this.threadId, turnId, state: "failed" });
      throw error instanceof CraftingError
        ? error
        : CraftingError.executionFailed(errorMessage(error), { harnessKind: "deepseek-api" });
    } finally {
      command.signal?.removeEventListener("abort", abortFromCaller);
      this._activeTurnId = undefined;
      this._activeAbort = undefined;
    }
  }

  async interrupt(): Promise<void> {
    this._activeAbort?.abort();
  }

  async terminate(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;
    this._activeAbort?.abort();
    await this.options.mcpRuntime?.close();
    this._status = "terminated";
    this.emit({ type: "session.exited", threadId: this.threadId, reason: "normal" });
    this._listeners.clear();
    this.onTerminated();
  }

  async sendPrompt(
    prompt: string,
    onEvent?: (event: RuntimeEvent) => void,
  ): Promise<{
    response: string;
    events: RuntimeEvent[];
    error?: string;
  }> {
    const unsubscribe = onEvent ? this.subscribe((event) => onEvent(event)) : undefined;
    try {
      const result = await this.startTurn({ prompt });
      return { response: result.response ?? "", events: [...result.events] };
    } finally {
      unsubscribe?.();
    }
  }
}

export interface DeepSeekApiRuntimeAdapterOptions {
  descriptor: NativeHarnessDescriptor;
  projectLocation: ProjectLocation;
  runtimeOptions?: Record<string, unknown>;
  mcpServers?: readonly ResolvedMcpServer[];
  createMcpRuntime?: (servers: readonly ResolvedMcpServer[]) => DeepSeekApiMcpRuntime;
  inlineSkillInstructions?: string;
}

export class DeepSeekApiRuntimeAdapter implements HarnessRuntimeAdapter {
  readonly id: string;
  readonly harnessKind: string;
  readonly descriptor: NativeHarnessDescriptor;
  private readonly sessions = new Set<DeepSeekApiCraftSession>();
  private readonly diagnostics: NativeHarnessDiagnostic[] = [];

  constructor(private readonly options: DeepSeekApiRuntimeAdapterOptions) {
    this.id = options.descriptor.id;
    this.harnessKind = options.descriptor.harnessKind;
    this.descriptor = options.descriptor;
  }

  supports(plan: CraftPlan): boolean {
    return plan.runtimeBinding.harnessKind === this.harnessKind;
  }

  getDiagnostics(): readonly NativeHarnessDiagnostic[] {
    return [...this.diagnostics];
  }

  getActiveSessions(): readonly CraftSession[] {
    return [...this.sessions];
  }

  async spawnEntity(plan: CraftPlan): Promise<Entity> {
    if (!this.supports(plan)) {
      throw CraftingError.runtimeUnavailable(
        this.harnessKind,
        "DeepSeek API adapter does not support this CraftPlan.",
      );
    }
    const runtimeOptions = plan.runtimeBinding.options ?? this.options.runtimeOptions ?? {};
    const apiKeyEnv = stringOption(runtimeOptions, "apiKeyEnv") ?? DEFAULT_API_KEY_ENV;
    if (!process.env[apiKeyEnv]?.trim()) {
      const message = `DeepSeek API key environment variable '${apiKeyEnv}' is not configured.`;
      this.diagnostics.push({
        code: "RUNTIME_UNAVAILABLE",
        harnessKind: this.harnessKind,
        phase: "readiness",
        operation: "api-key",
        message,
        remediation: `Configure ${apiKeyEnv} and retry the DeepSeek API provider path.`,
        occurredAt: new Date().toISOString(),
      });
      throw CraftingError.runtimeUnavailable(this.harnessKind, message);
    }
    return {
      id: `entity:${this.harnessKind}:${randomUUID()}`,
      resultItemId: plan.resultItemId,
      craftPlan: plan,
      status: "spawned",
      createdAt: new Date().toISOString(),
      nativeHarness: this.descriptor,
      metadata: { vendor: plan.runtimeBinding.vendor, modelId: plan.runtimeBinding.modelId },
    };
  }

  async createSession(entity: Entity): Promise<CraftSession> {
    const runtimeOptions =
      entity.craftPlan.runtimeBinding.options ?? this.options.runtimeOptions ?? {};
    const baseUrl =
      stringOption(runtimeOptions, "apiBaseUrl") ??
      stringOption(runtimeOptions, "apiEndpoint") ??
      DEFAULT_API_BASE_URL;
    const apiKeyEnv = stringOption(runtimeOptions, "apiKeyEnv") ?? DEFAULT_API_KEY_ENV;
    const requestTimeoutMs =
      nonNegativeNumberOption(runtimeOptions, "requestTimeoutMs") ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const maxTokenContinuations = nonNegativeIntegerOption(runtimeOptions, "maxTokenContinuations");
    const session = new DeepSeekApiCraftSession(
      `sess:${this.harnessKind}:${randomUUID()}`,
      entity.id,
      entity.craftPlan.threadId ?? entity.id,
      {
        descriptor: this.descriptor,
        plan: entity.craftPlan,
        projectLocation: this.options.projectLocation,
        baseUrl: baseUrl.replace(/\/$/u, ""),
        apiKeyEnv,
        requestTimeoutMs,
        maxTokenContinuations,
        maxToolRounds:
          nonNegativeIntegerOption(runtimeOptions, "maxToolRounds") ?? DEFAULT_MAX_TOOL_ROUNDS,
        ...(this.options.mcpServers?.length
          ? {
              mcpRuntime: this.options.createMcpRuntime
                ? this.options.createMcpRuntime(this.options.mcpServers)
                : new DefaultDeepSeekApiMcpRuntime(this.options.mcpServers),
            }
          : {}),
        ...(this.options.inlineSkillInstructions
          ? { inlineSkillInstructions: this.options.inlineSkillInstructions }
          : {}),
      },
      () => this.sessions.delete(session),
    );
    this.sessions.add(session);
    entity.status = "running";
    return session;
  }

  async resumeSession(_entity: Entity, _sessionRef: string): Promise<CraftSession> {
    throw CraftingError.runtimeUnavailable(
      this.harnessKind,
      "DeepSeek API is stateless at the provider boundary; resume requires a persisted message transcript.",
    );
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([...this.sessions].map((session) => session.terminate()));
    this.sessions.clear();
  }
}
