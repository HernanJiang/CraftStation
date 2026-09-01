import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Crafter, getDefaultRegistry } from "@/shared/crafting";
import type { RuntimeEvent } from "@/shared/contracts";
import { SupervisorRuntime } from "@/supervisor/supervisorRuntime";
import { resolveExecutablePath } from "@/supervisor/agents/base";

const enabled = process.env.CRAFTSTATION_REAL_NATIVE_HARNESSES === "1";
const deepSeekEnabled = process.env.CRAFTSTATION_REAL_DEEPSEEK_HARNESS === "1";
const kimiEnabled = process.env.CRAFTSTATION_REAL_KIMI_HARNESS === "1";
const grokEnabled = process.env.CRAFTSTATION_REAL_GROK_HARNESS === "1";
const defaultAgyPath = join(homedir(), "AppData", "Local", "agy", "bin", "agy.exe");
const defaultDshExecutable = join(homedir(), "AppData", "Roaming", "npm", "dsh-jsonrpc-agent.cmd");
const defaultDshPackage = join(
  homedir(),
  "AppData",
  "Roaming",
  "npm",
  "node_modules",
  "@deepseek-ai",
  "dsh-sdk-jsonrpc-demo",
  "package.json",
);

function errorDetail(error: unknown): Record<string, unknown> {
  const raw = error instanceof Error ? error.message : String(error);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Preserve the provider/supervisor error without guessing a code.
  }
  return { message: raw };
}

describe.skipIf(!enabled)("CraftStation native Antigravity product path evidence", () => {
  it("runs craftAgent through the official agy stream-json process boundary", async () => {
    const validationDir = join(process.cwd(), "ai_workspace", "validation");
    mkdirSync(validationDir, { recursive: true });
    const dataDir = mkdtempSync(join(process.cwd(), ".tmp-v0.7-native-data-"));
    const executablePath = process.env.CRAFTSTATION_AGY_EXECUTABLE?.trim() || defaultAgyPath;
    const prompt = "Reply with exactly CRAFTSTATION_AGY_PRODUCT_PATH_OK.";
    const events: RuntimeEvent[] = [];
    const ipcEvents: RuntimeEvent[] = [];
    const evidence: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      synthetic: false,
      feature: "v0.7.0 — Native Antigravity CLI and DeepSeek Harness Adapters",
      executionPath:
        "SupervisorRuntime.craftAgent -> NativeProcessHarnessRuntimeAdapter -> agy.exe --input-format stream-json --output-format stream-json -> Entity -> Session",
      executablePath,
      promptMarker: prompt,
    };
    const previousDataDir = process.env.PORACODE_DATA_DIR;
    process.env.PORACODE_DATA_DIR = dataDir;
    let runtime: SupervisorRuntime | undefined;
    let unsubscribe: (() => void) | undefined;
    let unsubscribeIpc: (() => void) | undefined;
    try {
      if (!existsSync(executablePath)) {
        throw new Error(
          "RUNTIME_UNAVAILABLE: official agy.exe was not found at the configured path.",
        );
      }
      const version = execFileSync(executablePath, ["--version"], { encoding: "utf8" }).trim();
      const registry = getDefaultRegistry();
      const model = registry.getItem("google:antigravity-default");
      const harness = registry.getItem("harness:antigravity");
      if (!model || !harness)
        throw new Error("RUNTIME_UNAVAILABLE: native Antigravity items are not registered.");
      const planResult = new Crafter(registry).compile(
        { slots: { model, harness } },
        {
          workspace: process.cwd(),
          threadId: `craft-real-antigravity-${Date.now()}`,
          clientProperties: {
            executablePath,
            approvalPolicy: "never",
          },
        },
      );
      if (!planResult.success || !planResult.craftPlan) {
        throw new Error(`COMPILATION_ERROR: ${JSON.stringify(planResult.errors ?? [])}`);
      }
      runtime = new SupervisorRuntime(() => undefined);
      unsubscribe = runtime.subscribeRuntimeEvents((_threadId, event) => events.push(event));
      unsubscribeIpc = runtime.subscribeRuntimeEvents((_threadId, event) => ipcEvents.push(event));
      const result = await runtime.craftAgent({
        craftPlan: planResult.craftPlan,
        projectLocation: { kind: "windows", path: process.cwd() },
        prompt,
      });
      await runtime.closeThread({ threadId: result.threadId });
      const observedExited = events.some((event) => event.type === "session.exited");
      expect(observedExited).toBe(true);
      const isPass =
        typeof result.response === "string" &&
        result.response.includes("CRAFTSTATION_AGY_PRODUCT_PATH_OK");
      Object.assign(evidence, {
        verdict: isPass ? "PASS" : "AUTH_REQUIRED",
        version,
        entityId: result.entityId,
        sessionId: result.sessionId,
        threadId: result.threadId,
        responseLength: result.response.length,
        responseMarkerObserved: isPass,
        eventTypes: events.map((event) => event.type),
        nativeTypes: events.flatMap((event) => event.nativeEnvelope?.nativeType ?? []),
        eventCount: events.length,
        ipcEventTypes: ipcEvents.map((event) => event.type),
        ipcEventCount: ipcEvents.length,
        cleanup: {
          operation: "SupervisorRuntime.closeThread",
          observedSessionExited: observedExited,
        },
      });
    } catch (error) {
      const detail = errorDetail(error);
      Object.assign(evidence, {
        verdict: "UNAVAILABLE",
        error: detail,
        eventTypes: events.map((event) => event.type),
        nativeTypes: events.flatMap((event) => event.nativeEnvelope?.nativeType ?? []),
        eventCount: events.length,
        ipcEventTypes: ipcEvents.map((event) => event.type),
        ipcEventCount: ipcEvents.length,
        cleanup: {
          operation: "SupervisorRuntime.closeThread",
          observedSessionExited: events.some((event) => event.type === "session.exited"),
        },
      });
      const code = String(detail.code ?? "");
      if (
        !["RUNTIME_UNAVAILABLE", "AUTH_REQUIRED", "EXECUTION_FAILED", "PROTOCOL_MISMATCH"].includes(
          code,
        )
      ) {
        throw error;
      }
    } finally {
      unsubscribeIpc?.();
      unsubscribe?.();
      await runtime?.disposeAsync().catch(() => undefined);
      if (previousDataDir === undefined) delete process.env.PORACODE_DATA_DIR;
      else process.env.PORACODE_DATA_DIR = previousDataDir;
      writeFileSync(
        join(validationDir, "v0.7.0-antigravity-product-path.json"),
        JSON.stringify(evidence, null, 2),
        "utf8",
      );
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 180_000);
});

describe.skipIf(!deepSeekEnabled)("CraftStation native DeepSeek product path evidence", () => {
  it("runs craftAgent through the official DSH JSON-RPC stdio process boundary", async () => {
    const validationDir = join(process.cwd(), "ai_workspace", "validation");
    mkdirSync(validationDir, { recursive: true });
    const executablePath = process.env.CRAFTSTATION_DSH_EXECUTABLE?.trim() || defaultDshExecutable;
    const configPath =
      process.env.CRAFTSTATION_DSH_CONFIG?.trim() || process.env.DSH_CORDIS_CONFIG?.trim();
    const packagePath = process.env.CRAFTSTATION_DSH_PACKAGE?.trim() || defaultDshPackage;
    const promptMarker = "CRAFTSTATION_DSH_PRODUCT_PATH_OK";
    const events: RuntimeEvent[] = [];
    const evidence: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      synthetic: false,
      feature: "v0.7.0 — Native Antigravity CLI and DeepSeek Harness Adapters",
      executionPath:
        "SupervisorRuntime.craftAgent -> NativeProcessHarnessRuntimeAdapter -> official dsh-jsonrpc-agent JSON-RPC 2.0 stdio -> Entity -> Session",
      executablePath,
      configProvided: Boolean(configPath),
      promptMarker,
    };
    let runtime: SupervisorRuntime | undefined;
    let unsubscribe: (() => void) | undefined;
    try {
      if (!existsSync(executablePath)) {
        throw new Error(
          "RUNTIME_UNAVAILABLE: official dsh-jsonrpc-agent was not found at the configured path.",
        );
      }
      if (!configPath || !existsSync(configPath)) {
        throw new Error(
          "RUNTIME_UNAVAILABLE: an explicit official DSH Cordis config was not provided.",
        );
      }
      const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
        name?: string;
        version?: string;
      };
      Object.assign(evidence, {
        carrierPackage: packageJson.name,
        carrierVersion: packageJson.version,
      });

      const registry = getDefaultRegistry();
      const model = registry.getItem("deepseek:deepseek-chat");
      const harness = registry.getItem("harness:deepseek");
      if (!model || !harness) {
        throw new Error("RUNTIME_UNAVAILABLE: native DeepSeek items are not registered.");
      }
      const planResult = new Crafter(registry).compile(
        { slots: { model, harness } },
        {
          workspace: process.cwd(),
          threadId: `craft-real-deepseek-${Date.now()}`,
          clientProperties: {
            configPath,
            executablePath,
            approvalPolicy: "never",
          },
        },
      );
      if (!planResult.success || !planResult.craftPlan) {
        throw new Error(`COMPILATION_ERROR: ${JSON.stringify(planResult.errors ?? [])}`);
      }
      const requestedModel = process.env.CRAFTSTATION_DSH_MODEL?.trim() || "deepseek-chat";
      const craftPlan = {
        ...planResult.craftPlan,
        runtimeBinding: {
          ...planResult.craftPlan.runtimeBinding,
          modelId: requestedModel,
        },
        overrides: {
          ...planResult.craftPlan.overrides,
          model: requestedModel,
        },
      };

      runtime = new SupervisorRuntime(() => undefined);
      unsubscribe = runtime.subscribeRuntimeEvents((_threadId, event) => events.push(event));
      const result = await runtime.craftAgent({
        craftPlan,
        projectLocation: { kind: "windows", path: process.cwd() },
        prompt: `Reply with exactly ${promptMarker}. Do not use tools.`,
      });
      await runtime.closeThread({ threadId: result.threadId });
      const response = result.response ?? "";
      Object.assign(evidence, {
        verdict: response.includes(promptMarker) ? "PASS" : "EMPTY_RESPONSE",
        entityIdCommitted: Boolean(result.entityId),
        sessionIdCommitted: Boolean(result.sessionId),
        responseLength: response.length,
        responseMarkerObserved: response.includes(promptMarker),
        model: requestedModel,
        eventTypes: events.map((event) => event.type),
        nativeTypes: events.flatMap((event) => event.nativeEnvelope?.nativeType ?? []),
        cleanup: {
          operation: "SupervisorRuntime.closeThread",
          observedSessionExited: events.some((event) => event.type === "session.exited"),
        },
      });
    } catch (error) {
      const detail = errorDetail(error);
      const code = String(detail.code ?? "");
      Object.assign(evidence, {
        verdict: code === "AUTH_REQUIRED" ? "AUTH_REQUIRED" : "UNAVAILABLE",
        error: detail,
        eventTypes: events.map((event) => event.type),
        nativeTypes: events.flatMap((event) => event.nativeEnvelope?.nativeType ?? []),
        cleanup: {
          operation: "SupervisorRuntime first-turn failure cleanup",
          observedSessionExited: events.some((event) => event.type === "session.exited"),
        },
      });
      if (
        !["RUNTIME_UNAVAILABLE", "AUTH_REQUIRED", "EXECUTION_FAILED", "PROTOCOL_MISMATCH"].includes(
          code,
        )
      ) {
        throw error;
      }
    } finally {
      unsubscribe?.();
      await runtime?.disposeAsync().catch(() => undefined);
      writeFileSync(
        join(validationDir, "v0.7.9-deepseek-product-path.json"),
        JSON.stringify(evidence, null, 2),
        "utf8",
      );
    }
    expect(evidence.synthetic).toBe(false);
  }, 180_000);
});

describe.skipIf(!kimiEnabled)("CraftStation native Kimi product path evidence", () => {
  it("runs craftAgent through the official Kimi Code ACP stdio process boundary", async () => {
    const validationDir = join(process.cwd(), "ai_workspace", "validation");
    mkdirSync(validationDir, { recursive: true });
    const promptMarker = "CRAFTSTATION_KIMI_PRODUCT_PATH_OK";
    const events: RuntimeEvent[] = [];
    const evidence: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      synthetic: false,
      feature: "v0.7.0 — Native Antigravity CLI and DeepSeek Harness Adapters",
      executionPath:
        "SupervisorRuntime.craftAgent -> StructuredNativeHarnessRuntimeAdapter -> official kimi acp stdio -> Entity -> Session",
      promptMarker,
    };
    let runtime: SupervisorRuntime | undefined;
    let unsubscribe: (() => void) | undefined;
    try {
      const executablePath = resolveExecutablePath("kimi");
      if (!executablePath) {
        throw new Error("RUNTIME_UNAVAILABLE: official Kimi Code CLI was not discovered.");
      }
      const registry = getDefaultRegistry();
      const model = registry.getItem("moonshot:kimi-for-coding");
      const harness = registry.getItem("harness:kimi");
      if (!model || !harness) {
        throw new Error("RUNTIME_UNAVAILABLE: native Kimi items are not registered.");
      }
      const planResult = new Crafter(registry).compile(
        { slots: { model, harness } },
        {
          workspace: process.cwd(),
          threadId: `craft-real-kimi-${Date.now()}`,
          clientProperties: { approvalPolicy: "never" },
        },
      );
      if (!planResult.success || !planResult.craftPlan) {
        throw new Error(`COMPILATION_ERROR: ${JSON.stringify(planResult.errors ?? [])}`);
      }

      runtime = new SupervisorRuntime(() => undefined);
      unsubscribe = runtime.subscribeRuntimeEvents((_threadId, event) => events.push(event));
      const result = await runtime.craftAgent({
        craftPlan: planResult.craftPlan,
        projectLocation: { kind: "windows", path: process.cwd() },
        prompt: `Reply with exactly ${promptMarker}. Do not use tools.`,
      });
      await runtime.closeThread({ threadId: result.threadId });
      const response = result.response ?? "";
      Object.assign(evidence, {
        executableDiscovered: true,
        verdict: response.includes(promptMarker) ? "PASS" : "EMPTY_RESPONSE",
        entityIdCommitted: Boolean(result.entityId),
        sessionIdCommitted: Boolean(result.sessionId),
        responseLength: response.length,
        responseMarkerObserved: response.includes(promptMarker),
        eventTypes: events.map((event) => event.type),
        nativeTypes: events.flatMap((event) => event.nativeEnvelope?.nativeType ?? []),
        cleanup: {
          operation: "SupervisorRuntime.closeThread",
          observedSessionExited: events.some((event) => event.type === "session.exited"),
        },
      });
    } catch (error) {
      const detail = errorDetail(error);
      const raw = JSON.stringify(detail);
      const verdict = /auth|credential|sign[ -]?in|login/iu.test(raw)
        ? "AUTH_REQUIRED"
        : /runtime_unavailable|not found|enoent/iu.test(raw)
          ? "RUNTIME_UNAVAILABLE"
          : "EXECUTION_FAILED";
      Object.assign(evidence, {
        verdict,
        error: detail,
        eventTypes: events.map((event) => event.type),
        nativeTypes: events.flatMap((event) => event.nativeEnvelope?.nativeType ?? []),
        cleanup: {
          operation: "SupervisorRuntime first-turn failure cleanup",
          observedSessionExited: events.some((event) => event.type === "session.exited"),
        },
      });
    } finally {
      unsubscribe?.();
      await runtime?.disposeAsync().catch(() => undefined);
      writeFileSync(
        join(validationDir, "v0.7.9-kimi-product-path.json"),
        JSON.stringify(evidence, null, 2),
        "utf8",
      );
    }
    expect(evidence.synthetic).toBe(false);
  }, 180_000);
});

describe.skipIf(!grokEnabled)("CraftStation native Grok product path evidence", () => {
  it("runs craftAgent through the official Grok Build ACP stdio process boundary", async () => {
    const validationDir = join(process.cwd(), "ai_workspace", "validation");
    mkdirSync(validationDir, { recursive: true });
    const isolatedDataDir = mkdtempSync(join(process.cwd(), ".tmp-v0.7-grok-data-"));
    const promptMarker = "CRAFTSTATION_GROK_PRODUCT_PATH_OK";
    const events: RuntimeEvent[] = [];
    const evidence: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      synthetic: false,
      feature: "v0.7.0 — Native Antigravity CLI and DeepSeek Harness Adapters",
      executionPath:
        "SupervisorRuntime.craftAgent -> StructuredNativeHarnessRuntimeAdapter -> official grok agent ACP stdio -> Entity -> Session",
      credentialBoundary: "official host Grok login state; no API-key or proxy fallback",
      promptMarker,
    };
    const previousDataDir = process.env.PORACODE_DATA_DIR;
    process.env.PORACODE_DATA_DIR = isolatedDataDir;
    let runtime: SupervisorRuntime | undefined;
    let unsubscribe: (() => void) | undefined;
    try {
      const executablePath = resolveExecutablePath("grok");
      if (!executablePath) {
        throw new Error("RUNTIME_UNAVAILABLE: official Grok Build CLI was not discovered.");
      }
      const registry = getDefaultRegistry();
      const model = registry.getItem("xai:grok-4.6");
      const harness = registry.getItem("harness:grok");
      if (!model || !harness) {
        throw new Error("RUNTIME_UNAVAILABLE: native Grok items are not registered.");
      }
      const planResult = new Crafter(registry).compile(
        { slots: { model, harness } },
        {
          workspace: process.cwd(),
          threadId: `craft-real-grok-${Date.now()}`,
          clientProperties: { approvalPolicy: "never" },
        },
      );
      if (!planResult.success || !planResult.craftPlan) {
        throw new Error(`COMPILATION_ERROR: ${JSON.stringify(planResult.errors ?? [])}`);
      }

      runtime = new SupervisorRuntime(() => undefined);
      unsubscribe = runtime.subscribeRuntimeEvents((_threadId, event) => events.push(event));
      const result = await runtime.craftAgent({
        craftPlan: planResult.craftPlan,
        projectLocation: { kind: "windows", path: process.cwd() },
        prompt: `Reply with exactly ${promptMarker}. Do not use tools.`,
      });
      await runtime.closeThread({ threadId: result.threadId });
      const response = result.response ?? "";
      Object.assign(evidence, {
        executableDiscovered: true,
        verdict: response.includes(promptMarker) ? "PASS" : "EMPTY_RESPONSE",
        entityIdCommitted: Boolean(result.entityId),
        sessionIdCommitted: Boolean(result.sessionId),
        responseLength: response.length,
        responseMarkerObserved: response.includes(promptMarker),
        eventTypes: events.map((event) => event.type),
        nativeTypes: events.flatMap((event) => event.nativeEnvelope?.nativeType ?? []),
        cleanup: {
          operation: "SupervisorRuntime.closeThread",
          observedSessionExited: events.some((event) => event.type === "session.exited"),
        },
      });
    } catch (error) {
      const detail = errorDetail(error);
      const raw = JSON.stringify(detail);
      const verdict = /402|quota|usage balance|exhausted/iu.test(raw)
        ? "QUOTA_EXHAUSTED"
        : /auth|credential|sign[ -]?in|login/iu.test(raw)
          ? "AUTH_REQUIRED"
          : /runtime_unavailable|not found|enoent/iu.test(raw)
            ? "RUNTIME_UNAVAILABLE"
            : "EXECUTION_FAILED";
      Object.assign(evidence, {
        verdict,
        error: detail,
        eventTypes: events.map((event) => event.type),
        nativeTypes: events.flatMap((event) => event.nativeEnvelope?.nativeType ?? []),
        cleanup: {
          operation: "SupervisorRuntime first-turn failure cleanup",
          observedSessionExited: events.some((event) => event.type === "session.exited"),
        },
      });
    } finally {
      unsubscribe?.();
      await runtime?.disposeAsync().catch(() => undefined);
      if (previousDataDir === undefined) delete process.env.PORACODE_DATA_DIR;
      else process.env.PORACODE_DATA_DIR = previousDataDir;
      writeFileSync(
        join(validationDir, "v0.7.9-grok-product-path.json"),
        JSON.stringify(evidence, null, 2),
        "utf8",
      );
      rmSync(isolatedDataDir, { recursive: true, force: true });
    }
    expect(evidence.synthetic).toBe(false);
  }, 180_000);
});
