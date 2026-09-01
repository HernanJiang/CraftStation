import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Crafter, getDefaultRegistry } from "@/shared/crafting";
import type { McpServer, RuntimeEvent } from "@/shared/contracts";
import { SupervisorRuntime } from "@/supervisor/supervisorRuntime";

const enabled = process.env.CRAFTSTATION_REAL_DEEPSEEK_API_AGENTIC === "1";
const officialKeyEnv = "CRAFTSTATION_DEEPSEEK_OFFICIAL_API_KEY";
const arkKeyEnv = "CRAFTSTATION_DEEPSEEK_ARK_API_KEY";
const mcpMarker = "CRAFTSTATION_DEEPSEEK_API_MCP_OK";
const skillMarker = "CRAFTSTATION_DEEPSEEK_API_SKILL_OK";
const multiTurnMarker = "CRAFTSTATION_DEEPSEEK_API_MULTITURN_OK";
const interruptMarker = "CRAFTSTATION_DEEPSEEK_API_INTERRUPT_STARTED";
const memoryMarker = `DEEPSEEK_API_MEMORY_${Date.now()}`;

const cases = [
  {
    provider: "deepseek-official-api",
    keyEnv: officialKeyEnv,
    baseUrl: "https://api.deepseek.com/v1",
    modelId: "deepseek-chat",
    itemId: "deepseek:deepseek-chat-api",
  },
  {
    provider: "deepseek-ark-coding-api",
    keyEnv: arkKeyEnv,
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
    modelId: "deepseek-v4-flash",
    itemId: "deepseek:deepseek-v4-flash-api",
  },
] as const;

function contentText(events: readonly RuntimeEvent[]): string {
  return events
    .filter(
      (event): event is Extract<RuntimeEvent, { type: "content.delta" }> =>
        event.type === "content.delta" && event.stream === "assistant_text",
    )
    .map((event) => event.delta)
    .join("");
}

function selectedMcpIdentityObserved(events: readonly RuntimeEvent[]): boolean {
  return events.some((event) => {
    if (event.type !== "item.started" && event.type !== "item.completed") return false;
    if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
      return false;
    }
    const payload = event.payload as Record<string, unknown>;
    return (
      payload.mcpServerName === "craftstation-deepseek-api-probe" &&
      payload.mcpToolName === "read_deepseek_api_marker"
    );
  });
}

function safeError(error: unknown): Record<string, unknown> {
  const raw = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(raw) as unknown;
    const record =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    const detail = record?.detail;
    const source =
      detail && typeof detail === "object" && !Array.isArray(detail)
        ? (detail as Record<string, unknown>)
        : record;
    return {
      code: typeof source?.code === "string" ? source.code : "EXECUTION_FAILED",
      message:
        typeof source?.message === "string"
          ? source.message.slice(0, 240)
          : "DeepSeek API Agentic product path failed.",
    };
  } catch {
    return { code: "EXECUTION_FAILED", message: raw.slice(0, 240) };
  }
}

describe.skipIf(!enabled)("CraftStation real DeepSeek API Agentic product path", () => {
  it("tests selected MCP, Skill, multi-turn, context, interrupt and cleanup per configured provider", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "craftstation-deepseek-api-agentic-"));
    const skillDir = join(workspace, ".agents", "skills", "deepseek-api-agentic");
    const mcpServerPath = join(workspace, "mcp-server.mjs");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\nname: deepseek-api-agentic\ndescription: Real API skill-delivery probe\n---\n` +
        `Every final answer must include ${skillMarker}.\n`,
      "utf8",
    );
    writeFileSync(
      mcpServerPath,
      `import { createInterface } from "node:readline";\n` +
        `const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });\n` +
        `for await (const line of lines) {\n` +
        `  let request; try { request = JSON.parse(line); } catch { continue; }\n` +
        `  const { id, method } = request;\n` +
        `  if (method === "initialize") console.log(JSON.stringify({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "craftstation-deepseek-api-probe", version: "1.0.0" } } }));\n` +
        `  else if (method === "tools/list") console.log(JSON.stringify({ jsonrpc: "2.0", id, result: { tools: [{ name: "read_deepseek_api_marker", description: "Return the fixed acceptance marker. You must call this tool when the user asks for the marker.", inputSchema: { type: "object", properties: {}, additionalProperties: false } }] } }));\n` +
        `  else if (method === "tools/call") console.log(JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "${mcpMarker}" }] } }));\n` +
        `  else if (id !== undefined && method !== "notifications/initialized") console.log(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } }));\n` +
        `}\n`,
      "utf8",
    );

    const evidence: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      synthetic: false,
      scope: "DeepSeek OpenAI-compatible API adapter; separate from official DSH JSON-RPC Harness",
      executionPath:
        "SupervisorRuntime.craftAgent -> DeepSeekApiRuntimeAdapter -> real HTTPS streaming -> selected stdio MCP -> same-session follow-up -> interruptThread -> closeThread",
      unsupportedByThisAdapter: [
        "provider-native subagent",
        "cross-runtime resume",
        "native file/shell tools",
        "AGENTS.md auto-read",
        "compaction",
      ],
      attempts: [],
    };
    const attempts: Array<Record<string, unknown>> = [];
    const mcpServer: McpServer = {
      id: "craftstation-deepseek-api-probe",
      name: "craftstation-deepseek-api-probe",
      description: "Local deterministic DeepSeek API MCP acceptance server.",
      enabled: true,
      timeoutMs: 30_000,
      transport: {
        type: "stdio",
        command: process.execPath,
        args: [mcpServerPath],
        env: {},
        cwd: workspace,
      },
    };

    try {
      const registry = getDefaultRegistry();
      const harness = registry.getItem("harness:deepseek-api");
      if (!harness) throw new Error("DeepSeek API Harness Item is unavailable.");

      for (const [index, candidate] of cases.entries()) {
        if (!process.env[candidate.keyEnv]?.trim()) {
          attempts.push({
            provider: candidate.provider,
            model: candidate.modelId,
            attempted: false,
            verdict: "KEY_NOT_CONFIGURED",
          });
          continue;
        }
        const model = registry.getItem(candidate.itemId);
        if (!model) throw new Error(`Missing model Item '${candidate.itemId}'.`);
        const compiled = new Crafter(registry).compile(
          { slots: { model, harness } },
          {
            workspace,
            threadId: `craft-real-deepseek-api-agentic-${index}-${Date.now()}`,
            clientProperties: {
              apiBaseUrl: candidate.baseUrl,
              apiKeyEnv: candidate.keyEnv,
              requestTimeoutMs: 180_000,
              skills: ["deepseek-api-agentic"],
              mcpServerIds: [mcpServer.id],
            },
          },
        );
        if (!compiled.success || !compiled.craftPlan) {
          throw new Error(`CraftPlan failed for ${candidate.provider}.`);
        }

        const runtime = new SupervisorRuntime(() => undefined);
        const events: RuntimeEvent[] = [];
        const unsubscribe = runtime.subscribeRuntimeEvents((_threadId, event) =>
          events.push(event),
        );
        const attempt: Record<string, unknown> = {
          provider: candidate.provider,
          model: candidate.modelId,
          attempted: true,
          synthetic: false,
        };
        try {
          const first = await runtime.craftAgent({
            craftPlan: compiled.craftPlan,
            projectLocation: { kind: "windows", path: workspace },
            mcpServers: [mcpServer],
            prompt:
              `You must call read_deepseek_api_marker before answering. Include the tool result ` +
              `${mcpMarker} and remember ${memoryMarker}. Follow the selected Skill.`,
          });
          const firstEventsEnd = events.length;
          const secondStart = events.length;
          await runtime.sendThreadInput({
            threadId: first.threadId,
            prompt:
              `What value did I ask you to remember? Include ${multiTurnMarker}, the exact value, ` +
              `and follow the selected Skill.`,
            config: { model: candidate.modelId, approvalPolicy: "never" },
          });
          const secondText = contentText(events.slice(secondStart));

          const interruptStart = events.length;
          const pendingTurn = runtime.sendThreadInput({
            threadId: first.threadId,
            prompt: `Begin a very long response of at least 5000 words. Start with ${interruptMarker}.`,
            config: { model: candidate.modelId, approvalPolicy: "never" },
          });
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error("Timed out waiting for interrupt turn to start.")),
              10_000,
            );
            const poll = () => {
              if (events.slice(interruptStart).some((event) => event.type === "turn.started")) {
                clearTimeout(timeout);
                resolve();
                return;
              }
              setTimeout(poll, 10);
            };
            poll();
          });
          await runtime.interruptThread({ threadId: first.threadId });
          await pendingTurn;
          const interruptEvents = events.slice(interruptStart);
          await runtime.closeThread({ threadId: first.threadId });

          const firstEvents = events.slice(0, firstEventsEnd);
          const passed =
            first.response.includes(mcpMarker) &&
            first.response.includes(skillMarker) &&
            selectedMcpIdentityObserved(firstEvents) &&
            firstEvents.some((event) => event.type === "context.updated") &&
            secondText.includes(multiTurnMarker) &&
            secondText.includes(memoryMarker) &&
            secondText.includes(skillMarker) &&
            interruptEvents.some(
              (event) => event.type === "turn.completed" && event.state === "interrupted",
            ) &&
            !interruptEvents.some((event) => event.type === "error") &&
            events.some((event) => event.type === "session.exited");
          Object.assign(attempt, {
            verdict: passed ? "PASS" : "FAILED",
            responseLength: first.response.length,
            mcpMarkerObserved: first.response.includes(mcpMarker),
            skillMarkerObserved: first.response.includes(skillMarker),
            selectedMcpIdentityObserved: selectedMcpIdentityObserved(firstEvents),
            contextEventObserved: firstEvents.some((event) => event.type === "context.updated"),
            sameSessionMultiTurnPassed:
              secondText.includes(multiTurnMarker) && secondText.includes(memoryMarker),
            secondTurnSkillObserved: secondText.includes(skillMarker),
            interruptedCompletionObserved: interruptEvents.some(
              (event) => event.type === "turn.completed" && event.state === "interrupted",
            ),
            falseErrorAfterInterruptObserved: interruptEvents.some(
              (event) => event.type === "error",
            ),
            sessionExitedObserved: events.some((event) => event.type === "session.exited"),
            eventTypes: events.map((event) => event.type),
          });
        } catch (error) {
          Object.assign(attempt, { verdict: "FAILED", error: safeError(error) });
        } finally {
          unsubscribe();
          await runtime.disposeAsync().catch(() => undefined);
        }
        attempts.push(attempt);
      }
    } finally {
      evidence.attempts = attempts;
      evidence.summary = {
        configured: attempts.filter((attempt) => attempt.attempted === true).length,
        passed: attempts.filter((attempt) => attempt.verdict === "PASS").length,
        failed: attempts.filter(
          (attempt) => attempt.attempted === true && attempt.verdict !== "PASS",
        ).length,
        skipped: attempts.filter((attempt) => attempt.verdict === "KEY_NOT_CONFIGURED").length,
      };
      const validationDir = join(process.cwd(), "ai_workspace", "validation");
      mkdirSync(validationDir, { recursive: true });
      writeFileSync(
        join(validationDir, "v0.7.14-deepseek-api-agentic-product-path.json"),
        JSON.stringify(evidence, null, 2),
        "utf8",
      );
      if (existsSync(workspace)) {
        rmSync(workspace, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
      }
    }

    const configured = attempts.filter((attempt) => attempt.attempted === true);
    expect(configured.length).toBeGreaterThan(0);
    expect(configured.every((attempt) => attempt.verdict === "PASS")).toBe(true);
  }, 600_000);
});
