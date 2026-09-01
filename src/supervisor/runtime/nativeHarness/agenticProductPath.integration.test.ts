import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Crafter, getDefaultRegistry, type CraftPlan, type CraftSession } from "@/shared/crafting";
import type { McpServer, RuntimeEvent, ThreadConfig } from "@/shared/contracts";
import { SupervisorRuntime } from "@/supervisor/supervisorRuntime";

const enabled = process.env.CRAFTSTATION_REAL_AGENTIC_HARNESSES === "1";
const harnessFilter = new Set(
  (process.env.CRAFTSTATION_REAL_AGENTIC_HARNESS_FILTER ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const probeServerPath = join(
  process.cwd(),
  "ai_workspace",
  "temp",
  "v0.7.13-agentic-probe",
  "mcp-server.mjs",
);

const cases = [
  {
    harnessKind: "grok",
    modelItemId: "xai:grok-4.6",
    harnessItemId: "harness:grok",
    marker: "CRAFTSTATION_GROK_AGENTIC_PRODUCT_OK",
    skillMarker: "CRAFTSTATION_GROK_SKILL_PRODUCT_OK",
    subagentMarker: "CRAFTSTATION_GROK_SUBAGENT_PRODUCT_OK",
    resumeMarker: "CRAFTSTATION_GROK_RESUME_PRODUCT_OK",
  },
  {
    harnessKind: "kimi",
    modelItemId: "moonshot:kimi-for-coding",
    harnessItemId: "harness:kimi",
    marker: "CRAFTSTATION_KIMI_AGENTIC_PRODUCT_OK",
    skillMarker: "CRAFTSTATION_KIMI_SKILL_PRODUCT_OK",
    subagentMarker: "CRAFTSTATION_KIMI_SUBAGENT_PRODUCT_OK",
    resumeMarker: "CRAFTSTATION_KIMI_RESUME_PRODUCT_OK",
  },
] as const;

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

function assistantText(events: readonly RuntimeEvent[], from: number): string {
  return events
    .slice(from)
    .filter(
      (event): event is Extract<RuntimeEvent, { type: "content.delta" }> =>
        event.type === "content.delta" && event.stream === "assistant_text",
    )
    .map((event) => event.delta)
    .join("");
}

function toolEvidence(events: readonly RuntimeEvent[]): RuntimeEvent[] {
  const toolIds = new Set(
    events
      .filter(
        (event): event is Extract<RuntimeEvent, { type: "item.started" }> =>
          event.type === "item.started" &&
          /tool|mcp|command_execution|dynamic_tool_call/iu.test(event.itemType),
      )
      .map((event) => event.itemId),
  );
  return events.filter(
    (event) =>
      (event.type === "item.started" ||
        event.type === "item.updated" ||
        event.type === "item.completed") &&
      toolIds.has(event.itemId),
  );
}

function isSubagentPayload(payload: unknown): boolean {
  return (
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    (payload as Record<string, unknown>).isSubAgent === true
  );
}

function subagentEvidence(events: readonly RuntimeEvent[]): RuntimeEvent[] {
  const ids = new Set(
    events
      .filter(
        (event): event is Extract<RuntimeEvent, { type: "item.started" }> =>
          event.type === "item.started" && isSubagentPayload(event.payload),
      )
      .map((event) => event.itemId),
  );
  return events.filter(
    (event) =>
      (event.type === "item.started" ||
        event.type === "item.updated" ||
        event.type === "item.completed") &&
      ids.has(event.itemId),
  );
}

function eventsContain(events: readonly RuntimeEvent[], marker: string): boolean {
  return events.some(
    (event) => "payload" in event && JSON.stringify(event.payload ?? {}).includes(marker),
  );
}

function nativeSessionRef(runtime: SupervisorRuntime, threadId: string): string | undefined {
  const sessions = (runtime as unknown as { craftedSessionsByThread: Map<string, CraftSession> })
    .craftedSessionsByThread;
  return sessions.get(threadId)?.nativeSessionRef;
}

function removeWorkspace(path: string): string | undefined {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe.skipIf(!enabled)("CraftStation real Grok/Kimi Agentic product paths", () => {
  it("uses MCP/Skills/subagents and resumes the provider Session in a new Runtime", async () => {
    const registry = getDefaultRegistry();
    const attempts: Array<Record<string, unknown>> = [];
    const mcpServer: McpServer = {
      id: "craftstation-agentic-probe",
      name: "craftstation-agentic-probe",
      description: "Local deterministic MCP acceptance server.",
      enabled: true,
      timeoutMs: 30_000,
      transport: {
        type: "stdio",
        command: process.execPath,
        args: [probeServerPath],
        env: {},
        cwd: process.cwd(),
      },
    };

    for (const candidate of cases.filter(
      (entry) => harnessFilter.size === 0 || harnessFilter.has(entry.harnessKind),
    )) {
      const workspace = mkdtempSync(join(tmpdir(), `craftstation-${candidate.harnessKind}-skill-`));
      const skillDir = join(workspace, ".agents", "skills", "agentic-smoke");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---\nname: agentic-smoke\ndescription: Product-path skill probe\n---\n` +
          `For this request, the final answer must include ${candidate.skillMarker}.\n`,
        "utf8",
      );
      const events: RuntimeEvent[] = [];
      let runtime: SupervisorRuntime | undefined = new SupervisorRuntime(() => undefined);
      let unsubscribe = runtime.subscribeRuntimeEvents((_threadId, event) => events.push(event));
      const attempt: Record<string, unknown> = {
        harnessKind: candidate.harnessKind,
        synthetic: false,
        mcpServerId: mcpServer.id,
      };
      let threadId: string | undefined;
      let resumedThreadId: string | undefined;
      try {
        const model = registry.getItem(candidate.modelItemId);
        const harness = registry.getItem(candidate.harnessItemId);
        if (!model || !harness) throw new Error("Required native Item is not registered.");
        const compiled = new Crafter(registry).compile(
          { slots: { model, harness } },
          {
            workspace,
            threadId: `craft-real-${candidate.harnessKind}-agentic-${Date.now()}`,
          },
        );
        if (!compiled.success || !compiled.craftPlan) {
          throw new Error("Native Agentic CraftPlan compilation failed.");
        }
        const plan: CraftPlan = {
          ...compiled.craftPlan,
          overrides: {
            ...compiled.craftPlan.overrides,
            approvalPolicy: "never",
            mcpServerIds: [mcpServer.id],
            skills: ["agentic-smoke"],
          },
        };
        const first = await runtime.craftAgent({
          craftPlan: plan,
          projectLocation: { kind: "windows", path: workspace },
          mcpServers: [mcpServer],
          prompt:
            `You must call the MCP tool read_probe_marker exactly once. ` +
            `After reading its result, follow the selected skill and reply with exactly ` +
            `${candidate.marker} ${candidate.skillMarker}.`,
        });
        threadId = first.threadId;
        const firstToolEvents = toolEvidence(events);
        const subagentEventStart = events.length;
        const config: ThreadConfig = {
          model: plan.overrides?.model ?? plan.runtimeBinding.modelId,
          approvalPolicy: "never",
        };
        await runtime.sendThreadInput({
          threadId,
          prompt:
            `The user explicitly authorizes delegation. Launch exactly one provider-native ` +
            `background subagent and ask it to return ${candidate.subagentMarker}. ` +
            `Wait for that subagent to finish, then reply with exactly ${candidate.subagentMarker}.`,
          config,
        });
        const subagentResponse = assistantText(events, subagentEventStart);
        const subagentEvents = subagentEvidence(events.slice(subagentEventStart));
        const subagentResultMarkerObserved = eventsContain(
          subagentEvents,
          candidate.subagentMarker,
        );
        const savedSessionRef = nativeSessionRef(runtime, threadId);
        if (!savedSessionRef) {
          throw new Error(`${candidate.harnessKind} did not expose a provider session ref.`);
        }
        const firstExitedStart = events.length;
        await runtime.closeThread({ threadId });
        const firstExited = events
          .slice(firstExitedStart)
          .some((event) => event.type === "session.exited");
        unsubscribe();
        await runtime.disposeAsync();
        runtime = new SupervisorRuntime(() => undefined);
        unsubscribe = runtime.subscribeRuntimeEvents((_threadId, event) => events.push(event));
        const resumeEventStart = events.length;
        const resumed = await runtime.resumeCraftAgent({
          craftPlan: plan,
          projectLocation: { kind: "windows", path: workspace },
          sessionRef: savedSessionRef,
          mcpServers: [mcpServer],
          prompt:
            `Resume the previous provider session. Reply with exactly ` +
            `${candidate.resumeMarker} ${candidate.marker}.`,
        });
        resumedThreadId = resumed.threadId;
        const resumeResponse = assistantText(events, resumeEventStart) || resumed.response;
        const resumedExitedStart = events.length;
        await runtime.closeThread({ threadId: resumed.threadId });
        const resumedExited = events
          .slice(resumedExitedStart)
          .some((event) => event.type === "session.exited");
        Object.assign(attempt, {
          verdict:
            first.response.includes(candidate.marker) &&
            first.response.includes(candidate.skillMarker) &&
            firstToolEvents.length > 0 &&
            (subagentResponse.includes(candidate.subagentMarker) || subagentResultMarkerObserved) &&
            subagentEvents.length > 0 &&
            resumeResponse.includes(candidate.resumeMarker) &&
            resumeResponse.includes(candidate.marker) &&
            firstExited &&
            resumedExited
              ? "PASS"
              : "FAILED",
          firstResponseLength: first.response.length,
          firstMarkerObserved: first.response.includes(candidate.marker),
          skillMarkerObserved: first.response.includes(candidate.skillMarker),
          mcpToolEventCount: firstToolEvents.length,
          mcpToolNativeTypes: firstToolEvents.map((event) => event.nativeEnvelope?.nativeType),
          subagentResponseLength: subagentResponse.length,
          subagentMarkerObserved: subagentResponse.includes(candidate.subagentMarker),
          subagentResultMarkerObserved,
          subagentEventCount: subagentEvents.length,
          subagentNativeTypes: subagentEvents.map((event) => event.nativeEnvelope?.nativeType),
          nativeSessionRefObserved: Boolean(savedSessionRef),
          resumedResponseLength: resumeResponse.length,
          resumeMarkerObserved: resumeResponse.includes(candidate.resumeMarker),
          rememberedFirstMarkerObserved: resumeResponse.includes(candidate.marker),
          firstSessionExitedObserved: firstExited,
          resumedSessionExitedObserved: resumedExited,
          eventTypes: events.map((event) => event.type),
        });
      } catch (error) {
        Object.assign(attempt, {
          verdict: "FAILED",
          error: errorDetail(error),
          eventTypes: events.map((event) => event.type),
          mcpToolEventCount: toolEvidence(events).length,
        });
      } finally {
        if (threadId) await runtime?.closeThread({ threadId }).catch(() => undefined);
        if (resumedThreadId) {
          await runtime?.closeThread({ threadId: resumedThreadId }).catch(() => undefined);
        }
        unsubscribe();
        await runtime?.disposeAsync().catch(() => undefined);
        const cleanupWarning = removeWorkspace(workspace);
        if (cleanupWarning) attempt.workspaceCleanupWarning = cleanupWarning;
      }
      attempts.push(attempt);
    }

    const evidence = {
      timestamp: new Date().toISOString(),
      synthetic: false,
      executionPath:
        "SupervisorRuntime.craftAgent -> StructuredNativeHarnessRuntimeAdapter -> official ACP carrier -> selected stdio MCP + Skill + provider-native subagent -> close/dispose -> new SupervisorRuntime.resumeCraftAgent -> closeThread",
      attempts,
      summary: {
        attempted: attempts.length,
        passed: attempts.filter((attempt) => attempt.verdict === "PASS").length,
        failed: attempts.filter((attempt) => attempt.verdict !== "PASS").length,
      },
    };
    const validationDir = join(process.cwd(), "ai_workspace", "validation");
    mkdirSync(validationDir, { recursive: true });
    writeFileSync(
      join(
        validationDir,
        process.env.CRAFTSTATION_REAL_AGENTIC_ARTIFACT?.trim() ||
          "v0.7.13-structured-agentic-product-path.json",
      ),
      JSON.stringify(evidence, null, 2),
      "utf8",
    );

    expect(attempts.every((attempt) => attempt.verdict === "PASS")).toBe(true);
  }, 600_000);
});
