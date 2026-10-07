import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptSegment } from "@/shared/contracts";
import {
  BUILTIN_MODEL_ITEMS,
  Crafter,
  type CraftSession,
  type HarnessRuntimeAdapter,
  type StartTurnCommand,
  type TurnResult,
} from "@/shared/crafting";
import { SupervisorRuntime } from "./supervisorRuntime";

const nativeHarnessFactoryOverrides = vi.hoisted(
  () => new Map<string, (...args: unknown[]) => unknown>(),
);

vi.mock("./runtime/nativeHarness", async (importActual) => {
  const actual = await importActual<typeof import("./runtime/nativeHarness")>();
  return {
    ...actual,
    createNativeHarnessRuntimeAdapter: (harnessKind: string, options: unknown) => {
      const override = nativeHarnessFactoryOverrides.get(harnessKind);
      return override
        ? (override(harnessKind, options) as HarnessRuntimeAdapter | undefined)
        : actual.createNativeHarnessRuntimeAdapter(harnessKind, options as never);
    },
  };
});

vi.spyOn(console, "warn").mockImplementation(() => {});
vi.spyOn(console, "log").mockImplementation(() => {});

const tempDirs: string[] = [];
const runtimesToDispose: SupervisorRuntime[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "craftstation-crafted-skills-"));
  tempDirs.push(dir);
  return dir;
}

function makeRuntime(): SupervisorRuntime {
  const runtime = new SupervisorRuntime(() => undefined);
  vi.spyOn(runtime.skillsService, "prepareForLaunch").mockResolvedValue(undefined);
  vi.spyOn(runtime.skillsService, "scan").mockResolvedValue({
    skills: [],
    effectiveSkillIds: [],
    invocation: "slash",
    issues: [],
    canLinkToGlobal: true,
  });
  vi.spyOn(runtime.skillsService, "buildTurnSkillInjection").mockImplementation(
    async (input: { segments: readonly PromptSegment[] }) =>
      `INLINED:${input.segments
        .filter((segment) => segment.kind === "skill")
        .map((segment) => segment.name)
        .sort()
        .join(",")}`,
  );
  vi.spyOn(runtime.skillsService, "filterPluginSkillSegments").mockImplementation(
    async (segments: PromptSegment[]) => segments,
  );
  runtimesToDispose.push(runtime);
  return runtime;
}

beforeEach(() => {
  const baseDir = makeTempDir();
  vi.stubEnv("CRAFTSTATION_DATA_DIR", baseDir);
  writeFileSync(
    join(baseDir, "settings.json"),
    JSON.stringify({ locale: "en", customGlobalPrompt: "" }),
  );
});

afterEach(async () => {
  await Promise.allSettled(runtimesToDispose.splice(0).map((runtime) => runtime.disposeAsync()));
  vi.unstubAllEnvs();
  nativeHarnessFactoryOverrides.clear();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function nativeCraftPlan(threadId: string) {
  const result = new Crafter().compile(
    { slots: { model: BUILTIN_MODEL_ITEMS[0], harness: "auto" } },
    { workspace: "C:\\repo", threadId },
  );
  expect(result.success).toBe(true);
  const base = result.craftPlan!;
  return {
    ...base,
    ingredients: {
      model: { ...base.ingredients.model!, vendor: "xai", itemId: "xai:model" },
      harness: { ...base.ingredients.harness!, vendor: "xai", itemId: "harness:grok" },
    },
    runtimeBinding: {
      ...base.runtimeBinding,
      harnessKind: "grok",
      vendor: "xai",
      modelId: "grok-4.6",
      runtimeAdapterId: "native-harness:grok",
    },
  };
}

function installCommandCapturingAdapter(commands: StartTurnCommand[]) {
  const factory = (_harnessKind: unknown, _options: unknown) => {
    const session: CraftSession = {
      id: "session:test:grok",
      entityId: "entity:test:grok",
      status: "idle",
      sessionRef: "ses-1",
      startTurn: (async (command: StartTurnCommand): Promise<TurnResult> => {
        commands.push(command);
        return { turnId: "turn:test", status: "completed", events: [], response: "ok" };
      }) as CraftSession["startTurn"],
      interrupt: async () => undefined,
      terminate: async () => undefined,
      getSnapshot: () => ({
        sessionId: "session:test:grok",
        entityId: "entity:test:grok",
        status: "idle" as const,
        events: [],
      }),
      subscribe: () => () => undefined,
      sendPrompt: (async (prompt: string) => ({
        response: `ok:${prompt}`,
        events: [],
      })) as CraftSession["sendPrompt"],
    };
    const adapter: HarnessRuntimeAdapter = {
      id: "test-native:grok",
      harnessKind: "grok",
      supports: (plan) => plan.runtimeBinding.harnessKind === "grok",
      spawnEntity: async (plan) => ({
        id: "entity:test:grok",
        resultItemId: plan.resultItemId,
        craftPlan: plan,
        status: "spawned" as const,
        createdAt: new Date(0).toISOString(),
      }),
      createSession: async () => session,
      resumeSession: async () => session,
    };
    return adapter;
  };
  nativeHarnessFactoryOverrides.set("grok", factory as (...args: unknown[]) => unknown);
}

const SKILL: PromptSegment = {
  kind: "skill",
  name: "agentic-probe",
  path: "C:\\repo\\.agents\\skills\\agentic-probe\\SKILL.md",
  invocation: "/agentic-probe",
  provider: "agents",
  scope: "project",
};

const windowsProject = { kind: "windows", path: "C:\\repo" } as const;

describe("SupervisorRuntime crafted skill pinning", () => {
  it("re-inlines a mid-thread invoked skill on every later turn", async () => {
    const runtime = makeRuntime();
    const commands: StartTurnCommand[] = [];
    installCommandCapturingAdapter(commands);

    await runtime.craftAgent({
      craftPlan: nativeCraftPlan("crafted-skill-pin"),
      projectLocation: { ...windowsProject },
      prompt: "",
    });

    await runtime.sendThreadInput({
      threadId: "crafted-skill-pin",
      prompt: "use the probe",
      config: { model: "grok-4.6" },
      segments: [{ kind: "text", content: "use the probe " }, SKILL],
    });

    await runtime.sendThreadInput({
      threadId: "crafted-skill-pin",
      prompt: "follow up",
      config: { model: "grok-4.6" },
    });

    expect(commands).toHaveLength(2);
    expect(commands[0]!.inlineInstructions).toBe("INLINED:agentic-probe");
    // The follow-up carries no skill segment, yet the pinned SKILL.md body
    // still reaches the provider — Codex-style permanence.
    expect(commands[1]!.inlineInstructions).toBe("INLINED:agentic-probe");
  });

  it("pins additional skills invoked on later turns alongside earlier ones", async () => {
    const runtime = makeRuntime();
    const commands: StartTurnCommand[] = [];
    installCommandCapturingAdapter(commands);
    const SECOND: PromptSegment = {
      kind: "skill",
      name: "reviewer",
      path: "C:\\repo\\.agents\\skills\\reviewer\\SKILL.md",
      invocation: "/reviewer",
      provider: "agents",
      scope: "project",
    };

    await runtime.craftAgent({
      craftPlan: nativeCraftPlan("crafted-skill-accumulate"),
      projectLocation: { ...windowsProject },
      prompt: "",
    });

    await runtime.sendThreadInput({
      threadId: "crafted-skill-accumulate",
      prompt: "probe first",
      config: { model: "grok-4.6" },
      segments: [SKILL],
    });
    await runtime.sendThreadInput({
      threadId: "crafted-skill-accumulate",
      prompt: "now review",
      config: { model: "grok-4.6" },
      segments: [SECOND],
    });
    await runtime.sendThreadInput({
      threadId: "crafted-skill-accumulate",
      prompt: "wrap up",
      config: { model: "grok-4.6" },
    });

    expect(commands).toHaveLength(3);
    expect(commands[1]!.inlineInstructions).toBe("INLINED:agentic-probe,reviewer");
    expect(commands[2]!.inlineInstructions).toBe("INLINED:agentic-probe,reviewer");
  });
});
