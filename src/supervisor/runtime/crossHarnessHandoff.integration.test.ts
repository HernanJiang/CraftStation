import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
// Type-only imports: the real supervisor/crafting modules are loaded lazily
// inside the gated test so the deterministic regression suite below never
// depends on the supervisor module graph being loadable.
import type { CraftPlan } from "@/shared/crafting";
import type { ProjectLocation, RuntimeEvent } from "@/shared/contracts";
import type { SupervisorRuntime } from "../supervisorRuntime";

const enabled = process.env.CRAFTSTATION_REAL_CROSS_HARNESS_E2E === "1";
const evidencePath = join(
  process.cwd(),
  "ai_workspace",
  "validation",
  "v0.9-cross-harness-handoff-real.json",
);

const runtimes: SupervisorRuntime[] = [];
const temporaryWorkspaces: string[] = [];

// ── Acceptance helpers (pure, unit-tested below) ────────────────────────────
//
// The real-environment gate must never convert a product failure into a green
// "blocked by environment" artifact. Everything below is deliberately pure so
// the false-green regression tests can exercise exactly the logic the gated
// run uses, without real providers.

const ENVIRONMENT_BLOCK_CODES = ["AUTH_REQUIRED", "QUOTA_OR_LIMIT", "RUNTIME_UNAVAILABLE"] as const;

const RESPONSE_MARKERS = {
  "codex-a": "HANDOFF_CODEX_A_OK",
  "grok-b": "HANDOFF_GROK_B_OK",
  "codex-c": "HANDOFF_CODEX_C_OK",
} as const;

type SegmentLabel = keyof typeof RESPONSE_MARKERS;

type ScenarioStatus = "passed" | "blocked" | "unverified" | "failed";

const SCENARIO_NAMES = [
  "three-segment-continuation",
  "queued-switch-replace-latest",
  "queued-switch-cancel",
  "queued-switch-safe-boundary",
  "abort-confirmed",
  "abort-timeout-or-failure",
  "target-prepare-rollback",
  "target-bootstrap-rollback",
  "stale-event",
  "stale-input",
  "restart-recovery",
] as const;

type ScenarioName = (typeof SCENARIO_NAMES)[number];

interface ScenarioRecord {
  name: ScenarioName;
  status: ScenarioStatus;
  detail: string;
}

interface ChainSegmentIdentity {
  label: string;
  segmentId?: string | undefined;
  ordinal?: number | undefined;
  bindingEpoch?: number | undefined;
  runtimeSessionId?: string | undefined;
  nativeSessionRef?: string | undefined;
}

interface SegmentMarkerPayload {
  segmentId?: string;
  ordinal?: number;
  bindingEpoch?: number;
  runtimeSessionId?: string;
  nativeSessionRef?: string;
}

type FailureClassification =
  | { kind: "environment"; code: string }
  | { kind: "product"; code: string };

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/**
 * Stable SCREAMING_SNAKE codes embedded in product errors pass through as-is;
 * everything else falls back to coarse environment-shaped buckets.
 */
function stableErrorCode(message: string): string | null {
  const match = message.match(/\b[A-Z][A-Z0-9]+(_[A-Z0-9]+)+\b/);
  return match ? match[0] : null;
}

function sanitizedErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/auth|login|credential|unauthorized|401/i.test(message)) return "AUTH_REQUIRED";
  if (/quota|402|balance|exhausted|limit/i.test(message)) return "QUOTA_OR_LIMIT";
  if (/binary|executable|not found|spawn/i.test(message)) return "RUNTIME_UNAVAILABLE";
  return stableErrorCode(message) ?? "NATIVE_EXECUTION_FAILED";
}

function environmentBlockCode(error: unknown): string | null {
  const code = sanitizedErrorCode(error);
  return (ENVIRONMENT_BLOCK_CODES as readonly string[]).includes(code) ? code : null;
}

/**
 * Environment blocks are only honest BEFORE the official runtimes have started
 * a turn. Once the chain started, every exception is a product failure and the
 * gated test must fail — never be swallowed into a blocked artifact.
 */
function classifyFailure(error: unknown, chainStarted: boolean): FailureClassification {
  if (!chainStarted) {
    const environmentCode = environmentBlockCode(error);
    if (environmentCode) return { kind: "environment", code: environmentCode };
  }
  return { kind: "product", code: sanitizedErrorCode(error) };
}

function assertionCode(segmentLabel: SegmentLabel): string {
  return segmentLabel.toUpperCase().replace(/-/g, "_");
}

/**
 * A real completed assistant response is mandatory for every segment. An
 * empty/absent response means the acceptance FAILS — it can never be recorded
 * as evidence of a working handoff.
 */
function assertRealResponse(segmentLabel: SegmentLabel, response: string | undefined): void {
  if (typeof response !== "string" || response.trim().length === 0) {
    throw new Error(`${assertionCode(segmentLabel)}_RESPONSE_NOT_CONFIRMED`);
  }
}

function assertResponseMarker(
  segmentLabel: SegmentLabel,
  response: string | undefined,
  marker: string,
): void {
  if (!response?.includes(marker)) {
    throw new Error(`${assertionCode(segmentLabel)}_MARKER_NOT_CONFIRMED`);
  }
}

/** Only sanitized summaries: never body text, credentials, or hidden reasoning. */
function responseSummary(response: string | undefined): {
  nonEmpty: boolean;
  length: number;
  hash: string | null;
} {
  const text = response ?? "";
  return {
    nonEmpty: text.trim().length > 0,
    length: text.length,
    hash: text ? shortHash(text) : null,
  };
}

/**
 * The single acceptance gate for the A -> B -> C chain. Throws stable product
 * assertion codes; REAL_NATIVE_CHAIN_COMPLETED may only be written after this
 * passes.
 */
function assertChainAcceptance(input: {
  threadIds: (string | undefined)[];
  workspaces: (string | undefined)[];
  segments: ChainSegmentIdentity[];
}): void {
  const { threadIds, workspaces, segments } = input;
  if (segments.length !== 3) throw new Error("CHAIN_SEGMENT_COUNT_NOT_THREE");
  if (
    threadIds.length !== segments.length ||
    threadIds.some((id) => !id) ||
    new Set(threadIds).size !== 1
  ) {
    throw new Error("CHAIN_THREAD_ID_MISMATCH");
  }
  if (
    workspaces.length !== segments.length ||
    workspaces.some((workspace) => !workspace) ||
    new Set(workspaces).size !== 1
  ) {
    throw new Error("CHAIN_WORKSPACE_MISMATCH");
  }
  if (
    segments.some((segment) => !segment.segmentId) ||
    new Set(segments.map((segment) => segment.segmentId)).size !== 3
  ) {
    throw new Error("CHAIN_SEGMENTS_NOT_DISTINCT");
  }
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1]!;
    const current = segments[index]!;
    if (
      typeof previous.ordinal !== "number" ||
      typeof current.ordinal !== "number" ||
      current.ordinal <= previous.ordinal
    ) {
      throw new Error("CHAIN_ORDINAL_NOT_STRICTLY_INCREASING");
    }
    if (
      typeof previous.bindingEpoch !== "number" ||
      typeof current.bindingEpoch !== "number" ||
      current.bindingEpoch <= previous.bindingEpoch
    ) {
      throw new Error("CHAIN_BINDING_EPOCH_NOT_STRICTLY_INCREASING");
    }
  }
  // Each switch target must present fresh runtime session identity versus the
  // source (and versus each other) — a reused ref means no real handoff.
  const runtimeSessionIds = segments.map((segment) => segment.runtimeSessionId);
  if (runtimeSessionIds.some((id) => !id) || new Set(runtimeSessionIds).size !== segments.length) {
    throw new Error("CHAIN_TARGET_SESSION_IDENTITY_NOT_FRESH");
  }
  const nativeSessionRefs = segments
    .map((segment) => segment.nativeSessionRef)
    .filter((ref): ref is string => Boolean(ref));
  if (new Set(nativeSessionRefs).size !== nativeSessionRefs.length) {
    throw new Error("CHAIN_NATIVE_SESSION_REF_REUSED");
  }
}

function newScenarioLedger(initialDetail: string): ScenarioRecord[] {
  return SCENARIO_NAMES.map((name) => ({ name, status: "unverified", detail: initialDetail }));
}

function setScenarioRecord(
  scenarios: ScenarioRecord[],
  name: ScenarioName,
  status: ScenarioStatus,
  detail: string,
): void {
  const record = scenarios.find((scenario) => scenario.name === name);
  if (record) {
    record.status = status;
    record.detail = detail;
  }
}

function collectChainSegments(events: RuntimeEvent[]): ChainSegmentIdentity[] {
  const bySegmentId = new Map<string, ChainSegmentIdentity>();
  for (const event of events) {
    if (event.type !== "item.completed" || !event.itemId.startsWith("runtime-segment:")) continue;
    const payload = event.payload as SegmentMarkerPayload | undefined;
    if (!payload?.segmentId || bySegmentId.has(payload.segmentId)) continue;
    bySegmentId.set(payload.segmentId, {
      label: "segment",
      segmentId: payload.segmentId,
      ordinal: payload.ordinal,
      bindingEpoch: payload.bindingEpoch,
      runtimeSessionId: payload.runtimeSessionId,
      nativeSessionRef: payload.nativeSessionRef,
    });
  }
  return [...bySegmentId.values()].sort(
    (first, second) => (first.ordinal ?? 0) - (second.ordinal ?? 0),
  );
}

function assistantTextForSegment(events: RuntimeEvent[], segmentId: string): string {
  return events
    .filter(
      (event) =>
        event.type === "content.delta" &&
        event.stream === "assistant_text" &&
        event.execution?.segmentId === segmentId,
    )
    .map((event) => (event.type === "content.delta" ? event.delta : ""))
    .join("");
}

/**
 * Wait for the activated target segment's bootstrap turn to settle. Resolves
 * only on a real completed turn; failed/interrupted turns and timeouts are
 * product failures.
 */
async function waitForSegmentTurnCompletion(
  events: RuntimeEvent[],
  segmentId: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const outcomes = events
      .filter(
        (event) => event.type === "turn.completed" && event.execution?.segmentId === segmentId,
      )
      .map((event) => (event.type === "turn.completed" ? event.state : undefined));
    const latest = outcomes.at(-1);
    if (latest === "completed") return;
    if (latest !== undefined) throw new Error(`SWITCH_TARGET_TURN_${latest.toUpperCase()}`);
    if (Date.now() >= deadline) throw new Error("SWITCH_TARGET_TURN_TIMEOUT");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function writeEvidenceFile(evidence: Record<string, unknown>): void {
  mkdirSync(join(process.cwd(), "ai_workspace", "validation"), { recursive: true });
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
}

describe.skipIf(!enabled)("real Codex -> Grok -> Codex handoff", () => {
  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.disposeAsync()));
    for (const workspace of temporaryWorkspaces.splice(0)) {
      if (existsSync(workspace)) rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("attempts three official native Sessions on one Thread and records only sanitized evidence", async () => {
    // Loaded only when the real gate is enabled; see the type-only imports above.
    const { Crafter, getDefaultRegistry } = await import("@/shared/crafting");
    const { SupervisorRuntime: SupervisorRuntimeCtor } = await import("../supervisorRuntime");
    const nativePlan = (input: {
      threadId: string;
      modelId: string;
      harnessId: string;
      workspace: string;
    }): CraftPlan => {
      const registry = getDefaultRegistry();
      const model = registry.getItem(input.modelId);
      const harness = registry.getItem(input.harnessId);
      if (!model || !harness) throw new Error("NATIVE_ITEM_NOT_REGISTERED");
      const result = new Crafter(registry).compile(
        { slots: { model, harness } },
        { threadId: input.threadId, workspace: input.workspace },
      );
      if (!result.success || !result.craftPlan) throw new Error("NATIVE_PLAN_COMPILE_FAILED");
      return result.craftPlan;
    };

    const workspace = mkdtempSync(join(tmpdir(), "craftstation-v09-handoff-"));
    temporaryWorkspaces.push(workspace);
    writeFileSync(join(workspace, "handoff.txt"), "initial workspace fact\n", "utf8");
    const location: ProjectLocation = { kind: "windows", path: workspace };
    const events: RuntimeEvent[] = [];
    // A real turn has started only once an official runtime emitted
    // turn.started (or a full craftAgent turn returned). Until then,
    // auth/quota/runtime failures honestly mean the environment never let the
    // chain begin; afterwards, any failure is a product failure.
    let chainStarted = false;
    const observeEvents = (incoming: RuntimeEvent[]): void => {
      events.push(...incoming);
      if (incoming.some((event) => event.type === "turn.started")) chainStarted = true;
    };
    const runtime = new SupervisorRuntimeCtor((event) => {
      if (event.type === "thread-runtime-event") observeEvents([event.event]);
      if (event.type === "thread-runtime-events") observeEvents(event.events);
    });
    runtimes.push(runtime);

    const scenarios = newScenarioLedger("not exercised by this gate run");
    const evidence: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      synthetic: false,
      feature: "v0.9.0 — Cross-Harness Session Handoff",
      executionPath:
        "SupervisorRuntime.craftAgent/requestSessionSwitch -> official Codex app-server / official Grok ACP -> Runtime Segment ledger",
      workspaceSameForAllSegments: false,
      verdict: "INCOMPLETE",
      scenarios,
      segments: [],
    };

    try {
      const initialPlan = nativePlan({
        threadId: `handoff-real-${Date.now()}`,
        modelId: "openai:gpt-5.3-codex",
        harnessId: "harness:codex",
        workspace,
      });
      const first = await runtime.craftAgent({
        craftPlan: initialPlan,
        projectLocation: location,
        prompt:
          "Read handoff.txt and reply with exactly HANDOFF_CODEX_A_OK, mentioning the workspace fact only if you saw it.",
      });
      chainStarted = true;
      const threadId = first.threadId;
      assertRealResponse("codex-a", first.response);
      assertResponseMarker("codex-a", first.response, RESPONSE_MARKERS["codex-a"]);
      const codexASegment = collectChainSegments(events)[0];
      (evidence.segments as unknown[]).push({
        name: "codex-a",
        threadIdPresent: Boolean(threadId),
        sessionIdPresent: Boolean(first.sessionId),
        segmentIdPresent: Boolean(codexASegment?.segmentId),
        ordinal: codexASegment?.ordinal,
        bindingEpoch: codexASegment?.bindingEpoch,
        nativeSessionRefPresent: Boolean(codexASegment?.nativeSessionRef),
        markerPresent: first.response.includes(RESPONSE_MARKERS["codex-a"]),
        response: responseSummary(first.response),
      });

      const grokPlan = nativePlan({
        threadId,
        modelId: "xai:grok-4.6",
        harnessId: "harness:grok",
        workspace,
      });
      const toGrok = await runtime.requestSessionSwitch({
        threadId,
        projectLocation: location,
        targetCraftPlan: grokPlan,
        mode: "after-current-turn",
        prompt:
          "Continue this same task. Confirm you received the portable checkpoint and read handoff.txt; reply with exactly HANDOFF_GROK_B_OK.",
        accountMode: "auto",
      });
      const grokSegmentId = toGrok.state.activeSegment?.id ?? toGrok.state.targetSegmentId;
      if (toGrok.disposition !== "activated") throw new Error("GROK_B_NOT_ACTIVATED");
      if (!grokSegmentId) throw new Error("GROK_B_SEGMENT_ID_MISSING");
      await waitForSegmentTurnCompletion(events, grokSegmentId, 120_000);
      const grokResponse = assistantTextForSegment(events, grokSegmentId);
      assertRealResponse("grok-b", grokResponse);
      assertResponseMarker("grok-b", grokResponse, RESPONSE_MARKERS["grok-b"]);
      (evidence.segments as unknown[]).push({
        name: "grok-b",
        disposition: toGrok.disposition,
        segmentIdPresent: Boolean(grokSegmentId),
        ordinal: toGrok.state.activeSegment?.ordinal,
        bindingEpoch: toGrok.state.activeSegment?.bindingEpoch,
        nativeSessionRefPresent: Boolean(toGrok.state.activeSegment?.nativeSessionRef),
        markerPresent: grokResponse.includes(RESPONSE_MARKERS["grok-b"]),
        response: responseSummary(grokResponse),
      });

      const codexContinuationPlan = nativePlan({
        threadId,
        modelId: "openai:gpt-5.3-codex",
        harnessId: "harness:codex",
        workspace,
      });
      const toCodex = await runtime.requestSessionSwitch({
        threadId,
        projectLocation: location,
        targetCraftPlan: codexContinuationPlan,
        mode: "after-current-turn",
        prompt: "Continue after Grok's work and reply with exactly HANDOFF_CODEX_C_OK.",
      });
      const codexCSegmentId = toCodex.state.activeSegment?.id ?? toCodex.state.targetSegmentId;
      if (toCodex.disposition !== "activated") throw new Error("CODEX_C_NOT_ACTIVATED");
      if (!codexCSegmentId) throw new Error("CODEX_C_SEGMENT_ID_MISSING");
      await waitForSegmentTurnCompletion(events, codexCSegmentId, 120_000);
      const codexCResponse = assistantTextForSegment(events, codexCSegmentId);
      assertRealResponse("codex-c", codexCResponse);
      assertResponseMarker("codex-c", codexCResponse, RESPONSE_MARKERS["codex-c"]);
      (evidence.segments as unknown[]).push({
        name: "codex-c",
        disposition: toCodex.disposition,
        segmentIdPresent: Boolean(codexCSegmentId),
        ordinal: toCodex.state.activeSegment?.ordinal,
        bindingEpoch: toCodex.state.activeSegment?.bindingEpoch,
        nativeSessionRefPresent: Boolean(toCodex.state.activeSegment?.nativeSessionRef),
        markerPresent: codexCResponse.includes(RESPONSE_MARKERS["codex-c"]),
        response: responseSummary(codexCResponse),
      });

      const chainSegments = collectChainSegments(events);
      const workspaces = [
        initialPlan.workspace,
        grokPlan.workspace,
        codexContinuationPlan.workspace,
      ];
      assertChainAcceptance({
        threadIds: [threadId, toGrok.state.threadId, toCodex.state.threadId],
        workspaces,
        segments: chainSegments,
      });
      const ledgerSegmentIds = new Set(chainSegments.map((segment) => segment.segmentId));
      if (!ledgerSegmentIds.has(grokSegmentId) || !ledgerSegmentIds.has(codexCSegmentId)) {
        throw new Error("CHAIN_SWITCH_SEGMENT_NOT_IN_LEDGER");
      }

      // ALL chain assertions passed — only now may the verdict claim success.
      evidence.workspaceSameForAllSegments = new Set(workspaces).size === 1;
      evidence.verdict = "REAL_NATIVE_CHAIN_COMPLETED";
      evidence.segmentCount = chainSegments.length;
      evidence.segmentIdsPresent = chainSegments.every((segment) => Boolean(segment.segmentId));
      evidence.runtimeEventCount = events.length;
      setScenarioRecord(
        scenarios,
        "three-segment-continuation",
        "passed",
        "three official native Sessions ran on one durable Thread with distinct segments, strictly increasing ordinals and binding epochs, and fresh runtime/native session identity per switch",
      );
    } catch (error) {
      const classification = classifyFailure(error, chainStarted);
      evidence.runtimeEventCount = events.length;
      if (classification.kind === "environment") {
        // The environment never let the chain start; record honest blocked
        // evidence and keep the remaining scenarios unverified — no fabricated
        // passes.
        evidence.verdict = "BLOCKED BY ENVIRONMENT";
        evidence.blockedReason = { code: classification.code };
        setScenarioRecord(scenarios, "three-segment-continuation", "blocked", classification.code);
        for (const scenario of scenarios) {
          if (scenario.status === "unverified") {
            scenario.detail = "not attempted: environment unavailable before the chain started";
          }
        }
      } else {
        // The chain started (or the failure is product-shaped): failing the
        // test is the only honest outcome. Never swallow this into a blocked
        // artifact.
        evidence.verdict = "PRODUCT_CHAIN_FAILED";
        evidence.productFailure = { code: classification.code };
        setScenarioRecord(scenarios, "three-segment-continuation", "failed", classification.code);
        for (const scenario of scenarios) {
          if (scenario.status === "unverified") {
            scenario.detail = "not attempted: product chain failure";
          }
        }
        throw error;
      }
    } finally {
      writeEvidenceFile(evidence);
    }

    expect(evidence.synthetic).toBe(false);
  }, 300_000);
});

describe("cross-harness handoff acceptance helpers (false-green regression)", () => {
  function chainSegment(
    overrides: Partial<Omit<ChainSegmentIdentity, "label">> & { label?: string | undefined },
  ): ChainSegmentIdentity {
    return {
      label: overrides.label ?? "segment",
      segmentId: overrides.segmentId,
      ordinal: overrides.ordinal,
      bindingEpoch: overrides.bindingEpoch,
      runtimeSessionId: overrides.runtimeSessionId,
      nativeSessionRef: overrides.nativeSessionRef,
    };
  }

  function validSegment(index: number): ChainSegmentIdentity {
    return chainSegment({
      segmentId: `segment:thread:${index + 1}`,
      ordinal: index,
      bindingEpoch: index + 1,
      runtimeSessionId: `runtime-session-${index + 1}`,
      nativeSessionRef: `native-ref-${index + 1}`,
    });
  }

  function validChainInput(): {
    threadIds: string[];
    workspaces: string[];
    segments: ChainSegmentIdentity[];
  } {
    return {
      threadIds: ["thread-1", "thread-1", "thread-1"],
      workspaces: ["/ws", "/ws", "/ws"],
      segments: [validSegment(0), validSegment(1), validSegment(2)],
    };
  }

  it("fails when grok-b reports no real assistant response", () => {
    expect(() => assertRealResponse("grok-b", undefined)).toThrow("GROK_B_RESPONSE_NOT_CONFIRMED");
    expect(() => assertRealResponse("grok-b", "")).toThrow("GROK_B_RESPONSE_NOT_CONFIRMED");
    expect(() => assertRealResponse("grok-b", "   \n")).toThrow("GROK_B_RESPONSE_NOT_CONFIRMED");
  });

  it("fails when codex-c reports no real assistant response", () => {
    expect(() => assertRealResponse("codex-c", undefined)).toThrow(
      "CODEX_C_RESPONSE_NOT_CONFIRMED",
    );
    expect(() => assertRealResponse("codex-c", "")).toThrow("CODEX_C_RESPONSE_NOT_CONFIRMED");
  });

  it("fails when a real response lacks its required marker", () => {
    expect(() =>
      assertResponseMarker(
        "grok-b",
        "unrelated prose without the token",
        RESPONSE_MARKERS["grok-b"],
      ),
    ).toThrow("GROK_B_MARKER_NOT_CONFIRMED");
    expect(() => assertResponseMarker("codex-a", "", RESPONSE_MARKERS["codex-a"])).toThrow(
      "CODEX_A_MARKER_NOT_CONFIRMED",
    );
    expect(() =>
      assertResponseMarker(
        "codex-c",
        "prefix HANDOFF_CODEX_C_OK suffix",
        RESPONSE_MARKERS["codex-c"],
      ),
    ).not.toThrow();
  });

  it("keeps response summaries sanitized to nonEmpty/length/hash", () => {
    const body = "HANDOFF_GROK_B_OK plus model output that must never be persisted";
    const summary = responseSummary(body);
    expect(summary.nonEmpty).toBe(true);
    expect(summary.length).toBe(body.length);
    expect(Object.keys(summary).sort()).toEqual(["hash", "length", "nonEmpty"]);
    expect(JSON.stringify(summary)).not.toContain("HANDOFF_GROK_B_OK");
    expect(JSON.stringify(summary)).not.toContain("model output");
    expect(responseSummary(undefined)).toEqual({ nonEmpty: false, length: 0, hash: null });
  });

  it("fails on the wrong segment count", () => {
    const twoSegments = validChainInput();
    twoSegments.segments = [validSegment(0), validSegment(1)];
    twoSegments.threadIds = ["thread-1", "thread-1"];
    twoSegments.workspaces = ["/ws", "/ws"];
    expect(() => assertChainAcceptance(twoSegments)).toThrow("CHAIN_SEGMENT_COUNT_NOT_THREE");
  });

  it("fails when ordinals or binding epochs do not strictly increase", () => {
    const flatOrdinal = validChainInput();
    flatOrdinal.segments = [
      chainSegment({ ...validSegment(0), ordinal: 1 }),
      validSegment(1),
      validSegment(2),
    ];
    expect(() => assertChainAcceptance(flatOrdinal)).toThrow(
      "CHAIN_ORDINAL_NOT_STRICTLY_INCREASING",
    );

    const flatEpoch = validChainInput();
    flatEpoch.segments = [
      validSegment(0),
      chainSegment({ ...validSegment(1), bindingEpoch: 1 }),
      validSegment(2),
    ];
    expect(() => assertChainAcceptance(flatEpoch)).toThrow(
      "CHAIN_BINDING_EPOCH_NOT_STRICTLY_INCREASING",
    );
  });

  it("fails when a switch target reuses the source session identity", () => {
    const reusedRuntimeSession = validChainInput();
    reusedRuntimeSession.segments = [
      validSegment(0),
      chainSegment({ ...validSegment(1), runtimeSessionId: "runtime-session-1" }),
      validSegment(2),
    ];
    expect(() => assertChainAcceptance(reusedRuntimeSession)).toThrow(
      "CHAIN_TARGET_SESSION_IDENTITY_NOT_FRESH",
    );

    const reusedNativeRef = validChainInput();
    reusedNativeRef.segments = [
      validSegment(0),
      validSegment(1),
      chainSegment({ ...validSegment(2), nativeSessionRef: "native-ref-1" }),
    ];
    expect(() => assertChainAcceptance(reusedNativeRef)).toThrow("CHAIN_NATIVE_SESSION_REF_REUSED");
  });

  it("fails when thread ids or workspaces differ across the chain", () => {
    const driftedThread = validChainInput();
    driftedThread.threadIds = ["thread-1", "thread-1", "thread-2"];
    expect(() => assertChainAcceptance(driftedThread)).toThrow("CHAIN_THREAD_ID_MISMATCH");

    const driftedWorkspace = validChainInput();
    driftedWorkspace.workspaces = ["/ws", "/elsewhere", "/ws"];
    expect(() => assertChainAcceptance(driftedWorkspace)).toThrow("CHAIN_WORKSPACE_MISMATCH");
  });

  it("fails when a segment marker lacks identity", () => {
    const missingSegmentId = validChainInput();
    missingSegmentId.segments = [
      validSegment(0),
      {
        label: "segment",
        ordinal: 1,
        bindingEpoch: 2,
        runtimeSessionId: "runtime-session-2",
        nativeSessionRef: "native-ref-2",
      },
      validSegment(2),
    ];
    expect(() => assertChainAcceptance(missingSegmentId)).toThrow("CHAIN_SEGMENTS_NOT_DISTINCT");
  });

  it("classifies failures before the first turn as environment blocks only for real environment codes", () => {
    expect(classifyFailure(new Error("codex login required (401)"), false)).toEqual({
      kind: "environment",
      code: "AUTH_REQUIRED",
    });
    expect(classifyFailure(new Error("insufficient quota; balance exhausted"), false)).toEqual({
      kind: "environment",
      code: "QUOTA_OR_LIMIT",
    });
    expect(classifyFailure(new Error("spawn codex ENOENT: executable not found"), false)).toEqual({
      kind: "environment",
      code: "RUNTIME_UNAVAILABLE",
    });
    expect(classifyFailure(new Error("HANDOFF_CHECKPOINT_PROJECTION_FAILED"), false)).toEqual({
      kind: "product",
      code: "HANDOFF_CHECKPOINT_PROJECTION_FAILED",
    });
  });

  it("classifies any exception after the chain started as a product failure, not environment", () => {
    expect(classifyFailure(new Error("quota exhausted mid-chain"), true)).toEqual({
      kind: "product",
      code: "QUOTA_OR_LIMIT",
    });
    expect(classifyFailure(new Error("GROK_B_RESPONSE_NOT_CONFIRMED"), true)).toEqual({
      kind: "product",
      code: "GROK_B_RESPONSE_NOT_CONFIRMED",
    });
    expect(classifyFailure(new Error("unexpected renderer assertion"), true)).toEqual({
      kind: "product",
      code: "NATIVE_EXECUTION_FAILED",
    });
  });

  it("collects three distinct segment identities from runtime-segment markers", () => {
    const markerEvent = (ordinal: number, segmentId: string): RuntimeEvent => ({
      type: "item.completed",
      threadId: "thread-1",
      itemId: `runtime-segment:${segmentId}`,
      payload: {
        segmentId,
        ordinal,
        bindingEpoch: ordinal + 1,
        runtimeSessionId: `runtime-session-${ordinal + 1}`,
        nativeSessionRef: `native-ref-${ordinal + 1}`,
      },
    });
    const events = [
      markerEvent(2, "segment:c"),
      markerEvent(0, "segment:a"),
      markerEvent(1, "segment:b"),
    ];
    const segments = collectChainSegments(events);
    expect(segments.map((segment) => segment.segmentId)).toEqual([
      "segment:a",
      "segment:b",
      "segment:c",
    ]);
    expect(() =>
      assertChainAcceptance({
        threadIds: ["thread-1", "thread-1", "thread-1"],
        workspaces: ["/ws", "/ws", "/ws"],
        segments,
      }),
    ).not.toThrow();
  });

  it("times out when a switch target turn never completes", async () => {
    await expect(
      waitForSegmentTurnCompletion(
        [
          {
            type: "turn.started",
            threadId: "thread-1",
            turnId: "turn-1",
            execution: {
              segmentId: "segment:b",
              runtimeSessionId: "runtime-session-2",
              bindingEpoch: 2,
            },
          },
        ],
        "segment:b",
        0,
      ),
    ).rejects.toThrow("SWITCH_TARGET_TURN_TIMEOUT");
  });

  it("fails when a switch target turn completes failed", async () => {
    await expect(
      waitForSegmentTurnCompletion(
        [
          {
            type: "turn.completed",
            threadId: "thread-1",
            turnId: "turn-1",
            state: "failed",
            execution: {
              segmentId: "segment:b",
              runtimeSessionId: "runtime-session-2",
              bindingEpoch: 2,
            },
          },
        ],
        "segment:b",
        1_000,
      ),
    ).rejects.toThrow("SWITCH_TARGET_TURN_FAILED");
  });

  it("collects assistant text only for the requested segment", () => {
    const events: RuntimeEvent[] = [
      {
        type: "content.delta",
        threadId: "thread-1",
        itemId: "item:b1",
        stream: "assistant_text",
        delta: "B",
        execution: {
          segmentId: "segment:b",
          runtimeSessionId: "runtime-session-2",
          bindingEpoch: 2,
        },
      },
      {
        type: "content.delta",
        threadId: "thread-1",
        itemId: "item:a1",
        stream: "assistant_text",
        delta: "A",
        execution: {
          segmentId: "segment:a",
          runtimeSessionId: "runtime-session-1",
          bindingEpoch: 1,
        },
      },
      {
        type: "content.delta",
        threadId: "thread-1",
        itemId: "item:b1",
        stream: "assistant_text",
        delta: "C",
        execution: {
          segmentId: "segment:b",
          runtimeSessionId: "runtime-session-2",
          bindingEpoch: 2,
        },
      },
    ];
    expect(assistantTextForSegment(events, "segment:b")).toBe("BC");
  });

  it("records every scenario honestly when the environment is unavailable", () => {
    const scenarios = newScenarioLedger("not exercised by this gate run");
    expect(scenarios.map((scenario) => scenario.name)).toEqual([...SCENARIO_NAMES]);
    setScenarioRecord(scenarios, "three-segment-continuation", "blocked", "QUOTA_OR_LIMIT");
    expect(scenarios.find((scenario) => scenario.name === "three-segment-continuation")).toEqual({
      name: "three-segment-continuation",
      status: "blocked",
      detail: "QUOTA_OR_LIMIT",
    });
    const nonChainScenarios = scenarios.filter(
      (scenario) => scenario.name !== "three-segment-continuation",
    );
    expect(nonChainScenarios).toHaveLength(SCENARIO_NAMES.length - 1);
    expect(nonChainScenarios.every((scenario) => scenario.status === "unverified")).toBe(true);
    expect(nonChainScenarios.every((scenario) => scenario.detail.length > 0)).toBe(true);
  });
});
