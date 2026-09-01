import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Crafter, getDefaultRegistry, type CraftPlan } from "@/shared/crafting";
import type { McpServer, RuntimeEvent } from "@/shared/contracts";
import { SupervisorRuntime } from "@/supervisor/supervisorRuntime";

const enabled = process.env.CRAFTSTATION_REAL_ANTIGRAVITY_AGENTIC === "1";
const toolMarker = "CRAFTSTATION_AGY_TOOL_PRODUCT_OK";
const networkMarker = "CRAFTSTATION_AGY_NETWORK_PRODUCT_OK";
const skillMarker = "CRAFTSTATION_AGY_SKILL_PRODUCT_OK";
const agentsMarker = "CRAFTSTATION_AGY_AGENTS_PRODUCT_OK";
const subagentMarker = "CRAFTSTATION_AGY_SUBAGENT_PRODUCT_OK";
const mcpMarker = "CRAFTSTATION_AGY_MCP_PRODUCT_OK";
const multiTurnMarker = "CRAFTSTATION_AGY_MULTITURN_PRODUCT_OK";
const resumeMarker = "CRAFTSTATION_AGY_RESUME_PRODUCT_OK";
const memoryMarker = `AGY_MEMORY_${Date.now()}`;

function toolEvents(events: readonly RuntimeEvent[]): RuntimeEvent[] {
  return events.filter(
    (event) =>
      (event.type === "item.started" || event.type === "item.completed") &&
      event.itemId.startsWith("tool:"),
  );
}

function subagentEvents(events: readonly RuntimeEvent[]): RuntimeEvent[] {
  return events.filter(
    (event) =>
      (event.type === "item.started" || event.type === "item.completed") &&
      event.itemId.startsWith("subagent:") &&
      event.payload !== null &&
      typeof event.payload === "object" &&
      !Array.isArray(event.payload) &&
      (event.payload as Record<string, unknown>).isSubAgent === true,
  );
}

function toolNames(events: readonly RuntimeEvent[]): string[] {
  return events.flatMap((event) => {
    if (event.type !== "item.started" && event.type !== "item.completed") return [];
    if (
      event.payload === null ||
      typeof event.payload !== "object" ||
      Array.isArray(event.payload)
    ) {
      return [];
    }
    const name = (event.payload as Record<string, unknown>).name;
    return typeof name === "string" ? [name] : [];
  });
}

function selectedMcpToolObserved(events: readonly RuntimeEvent[]): boolean {
  return events.some((event) => {
    if (event.type !== "item.started" && event.type !== "item.completed") return false;
    if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
      return false;
    }
    const payload = event.payload as Record<string, unknown>;
    return (
      payload.name === "call_mcp_tool" &&
      payload.mcpServerName === "craftstation-agy-agentic-probe" &&
      payload.mcpToolName === "read_agy_mcp_marker"
    );
  });
}

function errorDetail(error: unknown): Record<string, unknown> {
  const raw = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { message: raw };
  } catch {
    return { message: raw };
  }
}

describe.skipIf(!enabled)("CraftStation real Antigravity Agentic product path", () => {
  it("uses native tools, web search, selected Skill, subagent, AGENTS and resumable context", async () => {
    const events: RuntimeEvent[] = [];
    const workspace = mkdtempSync(join(tmpdir(), "craftstation-agy-agentic-"));
    const skillDir = join(workspace, ".agents", "skills", "agentic-smoke");
    const mcpServerPath = join(workspace, "mcp-server.mjs");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(workspace, "AGENTS.md"),
      `For every final answer include ${agentsMarker}.\n`,
      "utf8",
    );
    writeFileSync(join(workspace, "tool-proof.txt"), toolMarker, "utf8");
    writeFileSync(
      mcpServerPath,
      `import { createInterface } from "node:readline";\n` +
        `const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });\n` +
        `for await (const line of lines) {\n` +
        `  let request; try { request = JSON.parse(line); } catch { continue; }\n` +
        `  const { id, method } = request;\n` +
        `  if (method === "initialize") console.log(JSON.stringify({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "craftstation-agy-probe", version: "1.0.0" } } }));\n` +
        `  else if (method === "tools/list") console.log(JSON.stringify({ jsonrpc: "2.0", id, result: { tools: [{ name: "read_agy_mcp_marker", description: "Return the fixed acceptance marker", inputSchema: { type: "object", properties: {}, additionalProperties: false } }] } }));\n` +
        `  else if (method === "tools/call") console.log(JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "${mcpMarker}" }] } }));\n` +
        `  else if (id !== undefined && method !== "notifications/initialized") console.log(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } }));\n` +
        `}\n`,
      "utf8",
    );
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\nname: agentic-smoke\ndescription: Antigravity product-path probe\n---\n` +
        `For this request, the final answer must include ${skillMarker}.\n`,
      "utf8",
    );

    const evidence: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      synthetic: false,
      executionPath:
        "SupervisorRuntime.craftAgent -> NativeProcessHarnessRuntimeAdapter -> official agy 1.1.22 stream-json -> close/dispose -> new SupervisorRuntime.resumeCraftAgent(--conversation)",
      selectedSkill: "agentic-smoke",
      selectedMcp: true,
      compactionInScope: false,
    };
    let firstRuntime: SupervisorRuntime | undefined;
    let resumedRuntime: SupervisorRuntime | undefined;
    let unsubscribeFirst: (() => void) | undefined;
    let unsubscribeResume: (() => void) | undefined;
    let plan: CraftPlan | undefined;

    try {
      const registry = getDefaultRegistry();
      const model = registry.getItem("google:antigravity-default");
      const harness = registry.getItem("harness:antigravity");
      if (!model || !harness) throw new Error("Antigravity registry Items are unavailable.");
      const mcpServer: McpServer = {
        id: "craftstation-agy-agentic-probe",
        name: "craftstation-agy-agentic-probe",
        description: "Local deterministic AGY MCP acceptance server.",
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
      const compiled = new Crafter(registry).compile(
        { slots: { model, harness } },
        {
          workspace,
          threadId: `craft-real-agy-agentic-${Date.now()}`,
          clientProperties: {
            approvalPolicy: "never",
            skills: ["agentic-smoke"],
            mcpServerIds: [mcpServer.id],
          },
        },
      );
      if (!compiled.success || !compiled.craftPlan) {
        throw new Error("Antigravity CraftPlan failed.");
      }
      plan = compiled.craftPlan;

      firstRuntime = new SupervisorRuntime(() => undefined);
      unsubscribeFirst = firstRuntime.subscribeRuntimeEvents((_threadId, event) =>
        events.push(event),
      );
      const first = await firstRuntime.craftAgent({
        craftPlan: plan,
        projectLocation: { kind: "windows", path: workspace },
        mcpServers: [mcpServer],
        prompt:
          `Actually read tool-proof.txt with a native file or shell tool. Actually call search_web ` +
          `and confirm the official repository URL https://github.com/deepseek-ai/deepseek-harness. ` +
          `Actually call the selected MCP tool read_agy_mcp_marker and include ${mcpMarker}. ` +
          `Actually invoke exactly one provider-native subagent and ask it to return ${subagentMarker}; ` +
          `wait for it. Remember secret ${memoryMarker}. Do not claim a tool ran unless it did. ` +
          `Then include the exact content read from tool-proof.txt, ${networkMarker}, and ` +
          `${subagentMarker}.`,
      });
      const savedSessionRef = first.sessionRef;
      const firstEventsEnd = events.length;
      const instructionTurnStart = events.length;
      await firstRuntime.sendThreadInput({
        threadId: first.threadId,
        prompt:
          "Follow the selected Skill and the project AGENTS instructions. Reply with exactly the " +
          "two markers those instructions require; do not add any other text.",
        config: {
          model: plan.overrides?.model ?? plan.runtimeBinding.modelId,
          approvalPolicy: "never",
        },
      });
      const instructionText = events
        .slice(instructionTurnStart)
        .filter(
          (event): event is Extract<RuntimeEvent, { type: "content.delta" }> =>
            event.type === "content.delta" && event.stream === "assistant_text",
        )
        .map((event) => event.delta)
        .join("");
      const sameRuntimeTurnStart = events.length;
      await firstRuntime.sendThreadInput({
        threadId: first.threadId,
        prompt: `What secret did I ask you to remember? Include ${multiTurnMarker} and the exact secret.`,
        config: {
          model: plan.overrides?.model ?? plan.runtimeBinding.modelId,
          approvalPolicy: "never",
        },
      });
      const sameRuntimeEvents = events.slice(sameRuntimeTurnStart);
      const sameRuntimeText = sameRuntimeEvents
        .filter(
          (event): event is Extract<RuntimeEvent, { type: "content.delta" }> =>
            event.type === "content.delta" && event.stream === "assistant_text",
        )
        .map((event) => event.delta)
        .join("");
      const firstExitStart = events.length;
      await firstRuntime.closeThread({ threadId: first.threadId });
      const firstExited = events
        .slice(firstExitStart)
        .some((event) => event.type === "session.exited");
      unsubscribeFirst();
      unsubscribeFirst = undefined;
      await firstRuntime.disposeAsync();
      firstRuntime = undefined;

      if (!savedSessionRef) throw new Error("Official agy conversation id was not exposed.");
      resumedRuntime = new SupervisorRuntime(() => undefined);
      unsubscribeResume = resumedRuntime.subscribeRuntimeEvents((_threadId, event) =>
        events.push(event),
      );
      const resumeEventStart = events.length;
      const resumed = await resumedRuntime.resumeCraftAgent({
        craftPlan: plan,
        projectLocation: { kind: "windows", path: workspace },
        sessionRef: savedSessionRef,
        mcpServers: [mcpServer],
        prompt:
          `Resume the official conversation. What secret did I ask you to remember? ` +
          `Include ${resumeMarker} and the exact secret.`,
      });
      const resumedEvents = events.slice(resumeEventStart);
      const resumedText =
        resumedEvents
          .filter(
            (event): event is Extract<RuntimeEvent, { type: "content.delta" }> =>
              event.type === "content.delta" && event.stream === "assistant_text",
          )
          .map((event) => event.delta)
          .join("") || resumed.response;
      const resumedExitStart = events.length;
      await resumedRuntime.closeThread({ threadId: resumed.threadId });
      const resumedExited = events
        .slice(resumedExitStart)
        .some((event) => event.type === "session.exited");

      const firstEvents = events.slice(0, firstEventsEnd);
      const observedToolEvents = toolEvents(firstEvents);
      const observedSubagentEvents = subagentEvents(firstEvents);
      const observedToolNames = toolNames(observedToolEvents);
      const corePass =
        first.response.includes(toolMarker) &&
        first.response.includes(networkMarker) &&
        first.response.includes(mcpMarker) &&
        instructionText.includes(skillMarker) &&
        instructionText.includes(agentsMarker) &&
        first.response.includes(subagentMarker) &&
        observedToolEvents.length >= 2 &&
        observedToolNames.some((name) => /search_web/iu.test(name)) &&
        selectedMcpToolObserved(observedToolEvents) &&
        observedSubagentEvents.length >= 2 &&
        sameRuntimeText.includes(multiTurnMarker) &&
        sameRuntimeText.includes(memoryMarker) &&
        resumedText.includes(resumeMarker) &&
        resumedText.includes(memoryMarker) &&
        firstExited &&
        resumedExited;

      Object.assign(evidence, {
        verdict: corePass ? "PASS" : "FAILED",
        modelId: plan.runtimeBinding.modelId,
        firstResponseLength: first.response.length,
        toolMarkerObserved: first.response.includes(toolMarker),
        networkMarkerObserved: first.response.includes(networkMarker),
        mcpMarkerObserved: first.response.includes(mcpMarker),
        selectedMcpToolEventObserved: selectedMcpToolObserved(observedToolEvents),
        skillMarkerObserved: instructionText.includes(skillMarker),
        agentsMarkerObserved: instructionText.includes(agentsMarker),
        subagentMarkerObserved: first.response.includes(subagentMarker),
        nativeToolEventCount: observedToolEvents.length,
        nativeToolNames: [...new Set(observedToolNames)],
        nativeSubagentEventCount: observedSubagentEvents.length,
        sessionRefObserved: Boolean(savedSessionRef),
        sameRuntimeMultiTurnPassed:
          sameRuntimeText.includes(multiTurnMarker) && sameRuntimeText.includes(memoryMarker),
        crossRuntimeResumePassed:
          resumedText.includes(resumeMarker) && resumedText.includes(memoryMarker),
        firstSessionExitedObserved: firstExited,
        resumedSessionExitedObserved: resumedExited,
        eventTypes: events.map((event) => event.type),
        nativeTypes: events.flatMap((event) => event.nativeEnvelope?.nativeType ?? []),
      });
    } catch (error) {
      Object.assign(evidence, { verdict: "FAILED", error: errorDetail(error) });
    } finally {
      unsubscribeFirst?.();
      unsubscribeResume?.();
      await firstRuntime?.disposeAsync().catch(() => undefined);
      await resumedRuntime?.disposeAsync().catch(() => undefined);
      const validationDir = join(process.cwd(), "ai_workspace", "validation");
      mkdirSync(validationDir, { recursive: true });
      writeFileSync(
        join(validationDir, "v0.7.13-antigravity-agentic-product-path.json"),
        JSON.stringify(evidence, null, 2),
        "utf8",
      );
      if (existsSync(workspace)) {
        rmSync(workspace, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
      }
    }

    expect(evidence.verdict).toBe("PASS");
  }, 600_000);
});
