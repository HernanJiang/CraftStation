import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentKind, PromptSegment } from "@/shared/contracts";
import type { AgentAdapter, StructuredSessionHandle } from "../agents/base";
import type { SupervisorEvent } from "@/shared/ipc";
import type { SessionRuntime } from "./sessionTypes";

import { ThreadSessionManager } from "./threadSessionManager";

const managersToDispose: ThreadSessionManager[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const manager of managersToDispose.splice(0)) {
    await manager.dispose();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createManager(
  agentKind: AgentKind,
  adapter: AgentAdapter,
  buildSkillTurnInjection: NonNullable<
    ConstructorParameters<typeof ThreadSessionManager>[0]["buildSkillTurnInjection"]
  >,
): ThreadSessionManager {
  const tempDir = mkdtempSync(join(tmpdir(), "craftstation-skill-pin-"));
  tempDirs.push(tempDir);
  writeFileSync(join(tempDir, "settings.json"), JSON.stringify({ locale: "en" }));
  const manager = new ThreadSessionManager({
    emit: vi.fn<(event: SupervisorEvent) => void>(),
    isDev: false,
    logsDir: join(tempDir, "logs"),
    settingsPath: join(tempDir, "settings.json"),
    readDisableCliHookPlugin: () => false,
    readTurnRetryPolicy: () => ({ maxAttempts: 0, intervalMs: 1000 }),
    adapters: new Map([[agentKind, adapter]]),
    resolveWindowsShell: () => ({
      shell: "powershell.exe",
      kind: "powershell" as const,
      args: ["-NoLogo"],
    }),
    buildSkillTurnInjection,
  });
  managersToDispose.push(manager);
  return manager;
}

function createAdapter(agentKind: AgentKind): AgentAdapter {
  return {
    kind: agentKind,
    label: agentKind,
    binary: agentKind,
    capabilities: {
      models: [],
      efforts: [],
      modelEfforts: {},
      modes: [],
      approvalPolicies: [],
      sandboxModes: [],
      supportsResume: true,
      supportsDirectInput: true,
      liveInputMode: "server",
      presentationMode: "gui",
      presentationModes: ["gui"],
      settingDefs: [],
    },
    detectInstall: vi.fn<AgentAdapter["detectInstall"]>(),
    buildLaunchArgv: vi.fn<AgentAdapter["buildLaunchArgv"]>(() => ({
      binary: agentKind,
      args: [],
    })),
    buildResumeArgv: vi.fn<AgentAdapter["buildResumeArgv"]>(() => ({
      binary: agentKind,
      args: [],
    })),
    createInitialSessionRef: vi.fn<AgentAdapter["createInitialSessionRef"]>(() => undefined),
  };
}

function createIdleGuiRuntime(
  agentKind: AgentKind,
  adapter: AgentAdapter,
  structuredSession: StructuredSessionHandle,
): SessionRuntime {
  return {
    instanceId: `instance-${agentKind}`,
    threadId: `thread-${agentKind}`,
    agentKind,
    adapter,
    projectLocation: { kind: "windows", path: "C:\\repo" },
    config: { model: `${agentKind}/model` },
    terminalSize: { cols: 80, rows: 24 },
    launchPrompt: "",
    sessionRef: { providerSessionId: "ses_existing" },
    status: "idle",
    attention: "none",
    canResumeWithConfig: true,
    outputLength: 0,
    prevChunk: "",
    lastStrippedPtyChunk: "",
    ptyOscCarry: "",
    presentationMode: "gui",
    structuredSession,
    mcpLaunchSnapshot: { mcpServers: [], disabledBuiltInMcpServerIds: [] },
  } as unknown as SessionRuntime;
}

const SKILL: PromptSegment = {
  kind: "skill",
  name: "agentic-probe",
  path: "C:\\repo\\.agents\\skills\\agentic-probe\\SKILL.md",
  invocation: "/agentic-probe",
  provider: "Shared agent skills",
  scope: "project",
};

describe("pinned skill injection", () => {
  it("re-inlines a previously invoked skill on every later structured turn", async () => {
    const startTurn = vi.fn<NonNullable<StructuredSessionHandle["startTurn"]>>(async () => {});
    const structuredSession: StructuredSessionHandle = {
      launchOptions: {},
      setListener: vi.fn<StructuredSessionHandle["setListener"]>(),
      startTurn,
      dispose: vi.fn<StructuredSessionHandle["dispose"]>(async () => undefined),
    };
    const agentKind: AgentKind = "antigravity";
    const adapter = createAdapter(agentKind);
    const skillNames = (segments: readonly PromptSegment[] | undefined) =>
      (segments ?? [])
        .filter((s) => s.kind === "skill")
        .map((s) => s.name)
        .join(",");
    const buildSkillTurnInjection = vi.fn<
      (input: { segments: readonly PromptSegment[] }) => Promise<string>
    >(async (input) => `INLINED:${skillNames(input.segments)}`);
    const manager = createManager(agentKind, adapter, buildSkillTurnInjection);
    const session = createIdleGuiRuntime(agentKind, adapter, structuredSession);
    manager.sessions.set(session.threadId, session);

    // Turn 1: the user invokes the skill.
    await manager.sendThreadInput({
      threadId: session.threadId,
      prompt: "use the probe",
      config: { model: `${agentKind}/model` },
      segments: [{ kind: "text", content: "use the probe " }, SKILL],
    });
    expect(buildSkillTurnInjection).toHaveBeenLastCalledWith(
      expect.objectContaining({ segments: expect.arrayContaining([SKILL]) }),
    );
    expect(startTurn).toHaveBeenLastCalledWith(
      "use the probe /agentic-probe",
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ inlineInstructions: "INLINED:agentic-probe" }),
    );

    // Turn 2: a plain follow-up — the pinned skill is re-inlined so a
    // provider that compacts earlier user messages (Antigravity) cannot
    // forget it, matching Codex's append-only context-item semantics.
    await manager.sendThreadInput({
      threadId: session.threadId,
      prompt: "follow up",
      config: { model: `${agentKind}/model` },
    });
    expect(buildSkillTurnInjection).toHaveBeenLastCalledWith(
      expect.objectContaining({ segments: [SKILL] }),
    );
    expect(startTurn).toHaveBeenLastCalledWith(
      "follow up",
      expect.anything(),
      undefined,
      expect.objectContaining({ inlineInstructions: "INLINED:agentic-probe" }),
    );
  });
});
