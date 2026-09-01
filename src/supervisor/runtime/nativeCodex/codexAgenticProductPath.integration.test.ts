import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Crafter, getDefaultRegistry, type CraftPlan } from "@/shared/crafting";
import type { McpServer, RuntimeEvent } from "@/shared/contracts";
import { SupervisorRuntime } from "@/supervisor/supervisorRuntime";

const enabled = process.env.CRAFTSTATION_REAL_CODEX_AGENTIC === "1";
const marker = "CRAFTSTATION_CODEX_MCP_PRODUCT_OK";
const resumeMarker = "CRAFTSTATION_CODEX_RESUME_OK";
const skillMarker = "CRAFTSTATION_CODEX_SKILL_PRODUCT_OK";
const subagentMarker = "CRAFTSTATION_CODEX_SUBAGENT_PRODUCT_OK";
const memoryMarker = `CODEX_MEMORY_${Date.now()}`;
const preferredModelId = process.env.CRAFTSTATION_REAL_CODEX_AGENTIC_MODEL?.trim() || "gpt-5.6-sol";
const probeServerPath = join(
  process.cwd(),
  "ai_workspace",
  "temp",
  "v0.7.13-agentic-probe",
  "mcp-server.mjs",
);

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

function toolEvents(events: readonly RuntimeEvent[]): RuntimeEvent[] {
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

function subagentEvents(events: readonly RuntimeEvent[]): RuntimeEvent[] {
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

function subagentIdentityEvidence(events: readonly RuntimeEvent[]) {
  const parentIds = new Set(
    events
      .filter(
        (event): event is Extract<RuntimeEvent, { type: "item.started" }> =>
          event.type === "item.started" && isSubagentPayload(event.payload),
      )
      .map((event) => event.itemId),
  );
  const parentStarted = events.filter(
    (event) => event.type === "item.started" && parentIds.has(event.itemId),
  );
  const parentCompleted = events.filter(
    (event) => event.type === "item.completed" && parentIds.has(event.itemId),
  );
  const childLinked = events.filter(
    (event) =>
      "parentItemId" in event &&
      typeof event.parentItemId === "string" &&
      parentIds.has(event.parentItemId),
  );
  const receiverThreadIds = parentCompleted.flatMap((event) => {
    const payload = "payload" in event ? readRecord(event.payload) : undefined;
    const args = readRecord(payload?.args);
    return Array.isArray(args?.receiverThreadIds)
      ? args.receiverThreadIds.filter((value): value is string => typeof value === "string")
      : [];
  });
  const completionResults = parentCompleted
    .map((event) => {
      const payload = "payload" in event ? readRecord(event.payload) : undefined;
      return typeof payload?.result === "string" ? payload.result : undefined;
    })
    .filter((value): value is string => value !== undefined);
  return {
    parentIds,
    parentStarted,
    parentCompleted,
    childLinked,
    receiverThreadIds,
    completionResults,
  };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
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

describe.skipIf(!enabled)("CraftStation real Codex Agentic product path", () => {
  it("uses selected MCP and resumes the official thread after runtime disposal", async () => {
    const events: RuntimeEvent[] = [];
    const mcpServer: McpServer = {
      id: "craftstation-codex-agentic-probe",
      name: "craftstation-codex-agentic-probe",
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
    const evidence: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      synthetic: false,
      executionPath:
        "SupervisorRuntime.craftAgent -> NativeCodexRuntimeAdapter -> official codex app-server -> selected stdio MCP -> dispose -> new SupervisorRuntime.resumeCraftAgent -> closeThread",
      mcpServerId: mcpServer.id,
    };
    let firstRuntime: SupervisorRuntime | undefined;
    let resumedRuntime: SupervisorRuntime | undefined;
    let plan: CraftPlan | undefined;
    let nativeSessionRef: string | undefined;
    const workspace = mkdtempSync(join(tmpdir(), "craftstation-codex-skill-"));
    const skillDir = join(workspace, ".agents", "skills", "agentic-smoke");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\nname: agentic-smoke\ndescription: Product-path skill probe\n---\n` +
        `For this request, the final answer must include ${skillMarker}.\n`,
      "utf8",
    );

    try {
      firstRuntime = new SupervisorRuntime(() => undefined);
      const unsubscribeFirst = firstRuntime.subscribeRuntimeEvents((_threadId, event) =>
        events.push(event),
      );
      const inventory = await firstRuntime.getCraftingModelInventory({
        projectLocation: { kind: "windows", path: workspace },
      });
      if (inventory.status !== "ready" || inventory.models.length === 0) {
        throw new Error(
          `Official Codex model inventory unavailable: ${inventory.diagnostic?.code}`,
        );
      }
      const selected =
        inventory.models.find((model) => model.id === preferredModelId) ?? inventory.models[0]!;
      const registry = getDefaultRegistry();
      registry.refreshCodexModels(inventory.models);
      const model = registry.getItem(`openai:${selected.id}`);
      if (!model) throw new Error(`Discovered model Item missing: ${selected.id}`);
      const compiled = new Crafter(registry).compile(
        { slots: { model, harness: "auto" } },
        {
          workspace,
          threadId: `craft-real-codex-agentic-${Date.now()}`,
          overrides: {
            approvalPolicy: "never",
            mcpServerIds: [mcpServer.id],
            skills: ["agentic-smoke"],
          },
        },
      );
      if (!compiled.success || !compiled.craftPlan) throw new Error("Codex CraftPlan failed.");
      plan = compiled.craftPlan;

      const first = await firstRuntime.craftAgent({
        craftPlan: plan,
        projectLocation: { kind: "windows", path: workspace },
        mcpServers: [mcpServer],
        prompt:
          `Call read_probe_marker exactly once. Remember secret ${memoryMarker}. ` +
          `After the tool succeeds follow the selected skill and reply with exactly ` +
          `${marker} ${skillMarker}.`,
      });
      nativeSessionRef = first.threadId;
      const firstToolEvents = toolEvents(events);
      const subagentEventStart = events.length;
      await firstRuntime.sendThreadInput({
        threadId: first.threadId,
        prompt:
          `The user explicitly authorizes delegation. Spawn exactly one provider-native subagent ` +
          `to return ${subagentMarker}. Wait for it to finish, then reply with exactly ` +
          `${subagentMarker}.`,
        config: {
          model: plan.overrides?.model ?? plan.runtimeBinding.modelId,
          approvalPolicy: "never",
        },
      });
      const subagentResponse = assistantText(events, subagentEventStart);
      const subagentEventSlice = events.slice(subagentEventStart);
      const observedSubagentEvents = subagentEvents(subagentEventSlice);
      const subagentIdentity = subagentIdentityEvidence(subagentEventSlice);
      const firstExitedStart = events.length;
      await firstRuntime.closeThread({ threadId: first.threadId });
      const firstExited = events
        .slice(firstExitedStart)
        .some((event) => event.type === "session.exited");
      unsubscribeFirst();
      await firstRuntime.disposeAsync();
      firstRuntime = undefined;

      resumedRuntime = new SupervisorRuntime(() => undefined);
      const resumeEventStart = events.length;
      const unsubscribeResume = resumedRuntime.subscribeRuntimeEvents((_threadId, event) =>
        events.push(event),
      );
      const resumed = await resumedRuntime.resumeCraftAgent({
        craftPlan: plan,
        projectLocation: { kind: "windows", path: workspace },
        sessionRef: nativeSessionRef,
        mcpServers: [mcpServer],
        prompt:
          `What secret did I ask you to remember? Reply with exactly ` +
          `${resumeMarker} ${memoryMarker}.`,
      });
      const resumeResponse = assistantText(events, resumeEventStart) || resumed.response;
      const resumedExitedStart = events.length;
      await resumedRuntime.closeThread({ threadId: resumed.threadId });
      const resumedExited = events
        .slice(resumedExitedStart)
        .some((event) => event.type === "session.exited");
      unsubscribeResume();

      const corePass =
        first.response.includes(marker) &&
        first.response.includes(skillMarker) &&
        firstToolEvents.length > 0 &&
        resumeResponse.includes(resumeMarker) &&
        resumeResponse.includes(memoryMarker) &&
        firstExited &&
        resumedExited;
      const subagentPass =
        subagentResponse.includes(subagentMarker) &&
        subagentIdentity.parentIds.size === 1 &&
        subagentIdentity.parentStarted.length === 1 &&
        subagentIdentity.parentCompleted.length === 1 &&
        subagentIdentity.receiverThreadIds.length === 1 &&
        subagentIdentity.completionResults.some((result) => result.includes(subagentMarker));
      Object.assign(evidence, {
        verdict: corePass && subagentPass ? "PASS" : corePass ? "PARTIAL" : "FAILED",
        corePass,
        subagentPass,
        subagentBoundary: subagentPass
          ? "provider-native subagent identity observed"
          : "text marker alone is insufficient; no provider-native/canonical subagent identity was observed",
        modelId: selected.id,
        firstResponseLength: first.response.length,
        firstMarkerObserved: first.response.includes(marker),
        skillMarkerObserved: first.response.includes(skillMarker),
        mcpToolEventCount: firstToolEvents.length,
        mcpToolNativeTypes: firstToolEvents.map((event) => event.nativeEnvelope?.nativeType),
        subagentResponseLength: subagentResponse.length,
        subagentMarkerObserved: subagentResponse.includes(subagentMarker),
        subagentEventCount: observedSubagentEvents.length,
        subagentNativeTypes: observedSubagentEvents.map(
          (event) => event.nativeEnvelope?.nativeType,
        ),
        subagentParentIdentityObserved: subagentIdentity.parentIds.size === 1,
        subagentParentItemIds: [...subagentIdentity.parentIds],
        subagentChildParentItemObserved: subagentIdentity.childLinked.length > 0,
        subagentChildLinkedEventCount: subagentIdentity.childLinked.length,
        subagentProviderChildIdentityObserved: subagentIdentity.receiverThreadIds.length === 1,
        subagentProviderChildThreadIds: subagentIdentity.receiverThreadIds,
        subagentProviderCompletionResultObserved: subagentIdentity.completionResults.some(
          (result) => result.includes(subagentMarker),
        ),
        subagentParentStartedCount: subagentIdentity.parentStarted.length,
        subagentParentCompletionCount: subagentIdentity.parentCompleted.length,
        subagentCompletionExactlyOnce: subagentIdentity.parentCompleted.length === 1,
        nativeSessionRefObserved: Boolean(nativeSessionRef),
        resumedResponseLength: resumeResponse.length,
        resumeMarkerObserved: resumeResponse.includes(resumeMarker),
        rememberedSecretObserved: resumeResponse.includes(memoryMarker),
        firstSessionExitedObserved: firstExited,
        resumedSessionExitedObserved: resumedExited,
        contextEventObserved: events.some((event) => event.type === "usage.spent"),
        eventTypes: events.map((event) => event.type),
      });
    } catch (error) {
      Object.assign(evidence, {
        verdict: "FAILED",
        error: errorDetail(error),
        mcpToolEventCount: toolEvents(events).length,
        eventTypes: events.map((event) => event.type),
      });
    } finally {
      await firstRuntime?.disposeAsync().catch(() => undefined);
      await resumedRuntime?.disposeAsync().catch(() => undefined);
      const validationDir = join(process.cwd(), "ai_workspace", "validation");
      mkdirSync(validationDir, { recursive: true });
      writeFileSync(
        join(validationDir, "v0.7.15-codex-agentic-product-path.json"),
        JSON.stringify(evidence, null, 2),
        "utf8",
      );
      try {
        rmSync(workspace, {
          recursive: true,
          force: true,
          maxRetries: 20,
          retryDelay: 100,
        });
      } catch (error) {
        evidence.workspaceCleanupWarning = error instanceof Error ? error.message : String(error);
      }
    }

    expect(evidence.corePass).toBe(true);
    expect(evidence.subagentPass).toBe(true);
  }, 600_000);
});
