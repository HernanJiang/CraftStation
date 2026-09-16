import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeEvent } from "@/shared/contracts";
import type { CreateStructuredSessionInput, StructuredSessionListener } from "../base";
import { AntigravityStructuredSession } from "./structuredSession";
import { ANTIGRAVITY_PRINT_WAIT_TIMEOUT } from "./argv";

type EmitFrame = (frame: Record<string, unknown>) => void;

function emitSuccessfulTurn(emit: EmitFrame): void {
  emit({ event: "init", conversation_id: "agy-conversation-1" });
  emit({
    event: "step_update",
    step_update: {
      conversation_id: "agy-conversation-1",
      step_index: 1,
      step_type: "tool",
      tool_name: "view_file",
      state: "ACTIVE",
      tool_info: { parameters: { path: "README.md" } },
    },
  });
  emit({
    event: "step_update",
    step_update: {
      conversation_id: "agy-conversation-1",
      step_index: 1,
      step_type: "tool",
      tool_name: "view_file",
      state: "DONE",
      tool_info: { output: "file contents" },
    },
  });
  emit({
    event: "step_update",
    step_update: {
      step_type: "agent_response",
      state: "ACTIVE",
      text_delta: "hello from Antigravity",
    },
  });
  emit({
    event: "result",
    result: { status: "SUCCESS", response: "hello from Antigravity" },
  });
}

class AntigravityFixture extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly requests: Array<Record<string, unknown>> = [];
  readonly stdin: Writable;
  killed = false;
  kill = vi.fn<() => boolean>(() => {
    this.killed = true;
    return true;
  });

  constructor(private readonly onRequest: (emit: EmitFrame) => void = emitSuccessfulTurn) {
    super();
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        this.requests.push(JSON.parse(String(chunk)) as Record<string, unknown>);
        this.onRequest((frame) => this.stdout.write(`${JSON.stringify(frame)}\n`));
        callback();
      },
    });
  }
}

function createFixtureSession(
  fixture: AntigravityFixture,
  inputOverrides: Partial<CreateStructuredSessionInput> = {},
  optionOverrides: { supportsPrintTimeout?: boolean } = {},
) {
  const spawnProcess = vi.fn<() => ChildProcessWithoutNullStreams>(
    () => fixture as unknown as ChildProcessWithoutNullStreams,
  ) as unknown as typeof spawn;
  const session = new AntigravityStructuredSession(
    {
      threadId: "thread-antigravity",
      projectLocation: { kind: "windows", path: "C:\\repo" },
      config: { model: "Gemini 3.5 Flash", approvalPolicy: "yolo" },
      presentationMode: "gui",
      baseSpawnEnv: { AGY_CLI_DISABLE_AUTO_UPDATE: "1" },
      ...inputOverrides,
    },
    {
      supportsSeparateModelEffort: true,
      defaultModel: "Gemini 3.5 Flash",
      spawnProcess,
      ...optionOverrides,
    },
  );
  return { session, spawnProcess };
}

describe("AntigravityStructuredSession", () => {
  it("maps the official stream-json protocol into CraftStation runtime events", async () => {
    const fixture = new AntigravityFixture();
    const { session, spawnProcess } = createFixtureSession(fixture);
    const events: RuntimeEvent[] = [];
    const updates: Parameters<StructuredSessionListener["onUpdate"]>[0][] = [];
    session.setListener({
      onClose: vi.fn<() => void>(),
      onError: vi.fn<(message: string) => void>(),
      onUpdate: (update) => updates.push(update),
      onRuntimeEvent: (event) => events.push(event),
    });

    await session.activate();
    await expect(
      session.openThread({ model: "Gemini 3.5 Flash", approvalPolicy: "yolo" }),
    ).resolves.toBeUndefined();
    await session.startTurn("hello", { model: "Gemini 3.5 Flash" });

    expect(fixture.requests).toEqual([{ event: "user", message: { content: "hello" } }]);
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionRef: expect.objectContaining({ providerSessionId: "agy-conversation-1" }),
        }),
      ]),
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "session.started" }),
        expect.objectContaining({
          type: "item.started",
          itemId: "tool:agy-conversation-1:1",
        }),
        expect.objectContaining({
          type: "item.completed",
          itemId: "tool:agy-conversation-1:1",
          payload: expect.objectContaining({ status: "success", result: "file contents" }),
        }),
        expect.objectContaining({
          type: "content.delta",
          stream: "assistant_text",
          delta: "hello from Antigravity",
        }),
        expect.objectContaining({ type: "turn.completed", state: "completed" }),
      ]),
    );
    expect(
      events.filter((event) => event.type === "content.delta" && event.stream === "assistant_text"),
    ).toHaveLength(1);
    expect(spawnProcess).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["--input-format", "stream-json", "--output-format", "stream-json"]),
      expect.objectContaining({ windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }),
    );

    await session.dispose();
    expect(fixture.killed).toBe(true);
  });

  it("widens the print wait so a long turn is not cut off mid-task", async () => {
    const fixture = new AntigravityFixture();
    const { session, spawnProcess } = createFixtureSession(
      fixture,
      {},
      {
        supportsPrintTimeout: true,
      },
    );

    await session.activate();
    await session.openThread({ model: "Gemini 3.5 Flash", approvalPolicy: "yolo" });

    expect(JSON.stringify(vi.mocked(spawnProcess).mock.calls[0])).toContain(
      `--print-timeout=${ANTIGRAVITY_PRINT_WAIT_TIMEOUT}`,
    );
    await session.dispose();
  });

  it("omits --print-timeout for agy builds whose probed help does not list it", async () => {
    const fixture = new AntigravityFixture();
    const { session, spawnProcess } = createFixtureSession(fixture);

    await session.activate();
    await session.openThread({ model: "Gemini 3.5 Flash", approvalPolicy: "yolo" });

    expect(JSON.stringify(vi.mocked(spawnProcess).mock.calls[0])).not.toContain("--print-timeout");
    await session.dispose();
  });

  it("warns when a success result leaves tool steps unfinished (print-mode cutoff)", async () => {
    const fixture = new AntigravityFixture((emit) => {
      emit({ event: "init", conversation_id: "agy-conversation-1" });
      emit({
        event: "step_update",
        step_update: {
          conversation_id: "agy-conversation-1",
          step_index: 1,
          step_type: "tool",
          tool_name: "schedule",
          state: "ACTIVE",
        },
      });
      emit({ event: "result", result: { status: "SUCCESS", response: "waiting" } });
    });
    const { session } = createFixtureSession(fixture);
    const events: RuntimeEvent[] = [];
    session.setListener({
      onClose: vi.fn<() => void>(),
      onError: vi.fn<(message: string) => void>(),
      onUpdate: () => undefined,
      onRuntimeEvent: (event) => events.push(event),
    });

    await session.activate();
    await session.openThread({ model: "Gemini 3.5 Flash", approvalPolicy: "yolo" });
    await session.startTurn("hello", { model: "Gemini 3.5 Flash" });

    const warnings = events.filter((event) => event.type === "warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toEqual(
      expect.objectContaining({
        type: "warning",
        message: expect.stringContaining("still running"),
      }),
    );
    // The provider-reported success is preserved; the warning only makes the
    // silent truncation visible.
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "turn.completed", state: "completed" }),
      ]),
    );
    await session.dispose();
  });

  it("does not warn when every tool step closes before the result", async () => {
    const fixture = new AntigravityFixture();
    const { session } = createFixtureSession(fixture);
    const events: RuntimeEvent[] = [];
    session.setListener({
      onClose: vi.fn<() => void>(),
      onError: vi.fn<(message: string) => void>(),
      onUpdate: () => undefined,
      onRuntimeEvent: (event) => events.push(event),
    });

    await session.activate();
    await session.openThread({ model: "Gemini 3.5 Flash", approvalPolicy: "yolo" });
    await session.startTurn("hello", { model: "Gemini 3.5 Flash" });

    expect(events.filter((event) => event.type === "warning")).toHaveLength(0);
    await session.dispose();
  });

  it("respawns transparently after the process exits mid-session", async () => {
    const fixture = new AntigravityFixture();
    const { session, spawnProcess } = createFixtureSession(fixture);
    const events: RuntimeEvent[] = [];
    session.setListener({
      onClose: vi.fn<() => void>(),
      onError: vi.fn<(message: string) => void>(),
      onUpdate: () => undefined,
      onRuntimeEvent: (event) => events.push(event),
    });

    await session.activate();
    await session.openThread({ model: "Gemini 3.5 Flash", approvalPolicy: "yolo" });
    expect(spawnProcess).toHaveBeenCalledTimes(1);

    // The process dies with no turn active (crash/OOM/killed). The next send
    // must transparently reopen against the retained conversation instead of
    // failing forever with "session is not open".
    fixture.emit("exit", 1, null);
    await session.startTurn("hello again", { model: "Gemini 3.5 Flash" });

    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "turn.completed", state: "completed" }),
      ]),
    );
  });

  it("passes pool ADC scope env through on native projects", async () => {
    const fixture = new AntigravityFixture();
    const { session, spawnProcess } = createFixtureSession(fixture, {
      baseSpawnEnv: {
        AGY_CLI_DISABLE_AUTO_UPDATE: "1",
        AGY_ADC_AUTH: "1",
        GOOGLE_APPLICATION_CREDENTIALS: "D:\\managed\\profile\\adc\\authorized_user.json",
      },
    });

    await session.activate();
    await session.openThread({ model: "Gemini 3.5 Flash", approvalPolicy: "yolo" });

    const spawnOptions = (spawnProcess as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as
      | { env: Record<string, string> }
      | undefined;
    expect(spawnOptions?.env.AGY_ADC_AUTH).toBe("1");
    expect(spawnOptions?.env.GOOGLE_APPLICATION_CREDENTIALS).toBe(
      "D:\\managed\\profile\\adc\\authorized_user.json",
    );
    await session.dispose();
  });

  it("strips host-side ADC scope env at the WSL boundary", async () => {
    const fixture = new AntigravityFixture();
    const { session, spawnProcess } = createFixtureSession(fixture, {
      projectLocation: {
        kind: "wsl",
        distro: "Ubuntu",
        linuxPath: "/home/user/repo",
        uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\user\\repo",
      },
      baseSpawnEnv: {
        AGY_CLI_DISABLE_AUTO_UPDATE: "1",
        AGY_ADC_AUTH: "1",
        GOOGLE_APPLICATION_CREDENTIALS: "D:\\managed\\profile\\adc\\authorized_user.json",
      },
    });

    await session.activate();
    await session.openThread({ model: "Gemini 3.5 Flash", approvalPolicy: "yolo" });

    // WSL launches through `bash -l -i -c` with the env baked into the script,
    // so inspect the exported script rather than the spawn options env.
    const call = JSON.stringify((spawnProcess as ReturnType<typeof vi.fn>).mock.calls[0!]);
    expect(call).not.toContain("AGY_ADC_AUTH");
    expect(call).not.toContain("authorized_user.json");
    // Non-credential spawn env still crosses the boundary.
    expect(call).toContain("AGY_CLI_DISABLE_AUTO_UPDATE");
    await session.dispose();
  });

  it("filters app-controls headers before spawn instead of failing openThread or leaking its token", async () => {
    const fixture = new AntigravityFixture(() => undefined);
    const token = "app-controls-session-secret";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { session, spawnProcess } = createFixtureSession(fixture, {
      mcpServers: [
        {
          id: "app-controls",
          name: "craftstation",
          timeoutMs: 30_000,
          transport: {
            type: "http",
            url: "http://127.0.0.1:49152/mcp",
            headers: { Authorization: `Bearer ${token}` },
          },
        },
      ],
    });

    try {
      await expect(
        session.openThread({ model: "Gemini 3.5 Flash", approvalPolicy: "yolo" }),
      ).resolves.toBeUndefined();
      expect(spawnProcess).toHaveBeenCalledOnce();
      expect(JSON.stringify(vi.mocked(spawnProcess).mock.calls[0])).not.toContain(token);
      expect(warn.mock.calls.flat().join(" ")).toContain("craftstation");
      expect(warn.mock.calls.flat().join(" ")).not.toContain(token);
    } finally {
      await session.dispose();
      warn.mockRestore();
    }
  });

  it("appends only the final response tail that was not already streamed", async () => {
    const fixture = new AntigravityFixture((emit) => {
      emit({ event: "init", conversation_id: "agy-conversation-1" });
      emit({
        event: "step_update",
        step_update: { step_type: "agent_response", state: "ACTIVE", text_delta: "hello " },
      });
      emit({
        event: "result",
        result: { status: "SUCCESS", response: "hello world" },
      });
    });
    const { session } = createFixtureSession(fixture);
    const events: RuntimeEvent[] = [];
    session.setListener({
      onClose: vi.fn<() => void>(),
      onError: vi.fn<(message: string) => void>(),
      onUpdate: vi.fn<StructuredSessionListener["onUpdate"]>(),
      onRuntimeEvent: (event) => events.push(event),
    });

    await session.openThread({ model: "Gemini 3.5 Flash", approvalPolicy: "yolo" });
    await session.startTurn("hello", { model: "Gemini 3.5 Flash" });

    expect(
      events
        .filter(
          (event): event is Extract<RuntimeEvent, { type: "content.delta" }> =>
            event.type === "content.delta" && event.stream === "assistant_text",
        )
        .map((event) => event.delta),
    ).toEqual(["hello ", "world"]);
  });

  it("does not re-append a step_update snapshot of the already streamed answer", async () => {
    const fixture = new AntigravityFixture((emit) => {
      emit({ event: "init", conversation_id: "agy-conversation-1" });
      emit({
        event: "step_update",
        step_update: { step_type: "agent_response", state: "ACTIVE", text_delta: "hello " },
      });
      emit({
        event: "step_update",
        step_update: {
          step_type: "agent_response",
          state: "DONE",
          text_delta: "hello world",
        },
      });
      emit({
        event: "result",
        result: { status: "SUCCESS", response: "hello world" },
      });
    });
    const { session } = createFixtureSession(fixture);
    const events: RuntimeEvent[] = [];
    session.setListener({
      onClose: vi.fn<() => void>(),
      onError: vi.fn<(message: string) => void>(),
      onUpdate: vi.fn<StructuredSessionListener["onUpdate"]>(),
      onRuntimeEvent: (event) => events.push(event),
    });

    await session.openThread({ model: "Gemini 3.8 Flash", approvalPolicy: "yolo" });
    await session.startTurn("hello", { model: "Gemini 3.8 Flash" });

    expect(
      events
        .filter(
          (event): event is Extract<RuntimeEvent, { type: "content.delta" }> =>
            event.type === "content.delta" && event.stream === "assistant_text",
        )
        .map((event) => event.delta)
        .join(""),
    ).toBe("hello world");
  });

  it("completes streamed thinking when the result envelope arrives", async () => {
    const fixture = new AntigravityFixture((emit) => {
      emit({ event: "init", conversation_id: "agy-conversation-1" });
      emit({
        event: "step_update",
        step_update: {
          conversation_id: "agy-conversation-1",
          step_index: 1,
          step_type: "thinking",
          state: "ACTIVE",
          text_delta: "plan the files",
        },
      });
      emit({
        event: "result",
        result: { status: "SUCCESS", response: "done" },
      });
    });
    const { session } = createFixtureSession(fixture);
    const events: RuntimeEvent[] = [];
    session.setListener({
      onClose: vi.fn<() => void>(),
      onError: vi.fn<(message: string) => void>(),
      onUpdate: vi.fn<StructuredSessionListener["onUpdate"]>(),
      onRuntimeEvent: (event) => events.push(event),
    });

    await session.openThread({ model: "Gemini 3.8 Flash", approvalPolicy: "yolo" });
    await session.startTurn("hello", { model: "Gemini 3.8 Flash" });

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "item.completed",
          itemId: "thought:agy-conversation-1:1",
        }),
      ]),
    );
  });

  it("keeps a failed result in the error state and preserves the official tool error", async () => {
    const fixture = new AntigravityFixture((emit) => {
      emit({ event: "init", conversation_id: "agy-conversation-1" });
      emit({
        event: "step_update",
        step_update: {
          conversation_id: "agy-conversation-1",
          step_index: 2,
          step_type: "tool",
          tool_name: "run_command",
          state: "DONE",
          tool_info: { error: "command failed" },
        },
      });
      emit({ event: "result", result: { status: "ERROR", error: "turn failed" } });
    });
    const { session } = createFixtureSession(fixture);
    const events: RuntimeEvent[] = [];
    const updates: Parameters<StructuredSessionListener["onUpdate"]>[0][] = [];
    session.setListener({
      onClose: vi.fn<() => void>(),
      onError: vi.fn<(message: string) => void>(),
      onUpdate: (update) => updates.push(update),
      onRuntimeEvent: (event) => events.push(event),
    });

    await session.openThread({ model: "Gemini 3.5 Flash", approvalPolicy: "yolo" });
    await expect(session.startTurn("fail", { model: "Gemini 3.5 Flash" })).rejects.toThrow(
      "turn failed",
    );

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "item.completed",
          payload: expect.objectContaining({ status: "error", error: "command failed" }),
        }),
        expect.objectContaining({ type: "turn.completed", state: "failed" }),
      ]),
    );
    expect(updates.at(-1)).toMatchObject({ status: "error", attention: "none" });
  });

  it("starts a replacement turn after interrupt without reporting a crash", async () => {
    const fixture = new AntigravityFixture(() => undefined);
    const { session } = createFixtureSession(fixture);
    const events: RuntimeEvent[] = [];
    const onError = vi.fn<(message: string) => void>();
    session.setListener({
      onClose: vi.fn<() => void>(),
      onError,
      onUpdate: vi.fn<StructuredSessionListener["onUpdate"]>(),
      onRuntimeEvent: (event) => events.push(event),
    });

    await session.openThread({ model: "Gemini 3.8 Flash", approvalPolicy: "yolo" });
    const first = session.startTurn("first", { model: "Gemini 3.8 Flash" });
    await session.interruptTurn();
    await first;

    const second = session.startTurn("injected", { model: "Gemini 3.8 Flash" });
    await Promise.race([
      second.then(
        () => undefined,
        (error: unknown) => {
          throw error;
        },
      ),
      new Promise((resolve) => setTimeout(resolve, 30)),
    ]);

    expect(onError).not.toHaveBeenCalled();
    expect(events.filter((event) => event.type === "turn.started")).toHaveLength(2);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "turn.completed", state: "interrupted" }),
      ]),
    );
    await session.dispose();
  });

  it("interrupts the official process and completes the active turn as interrupted", async () => {
    const fixture = new AntigravityFixture(() => undefined);
    const { session } = createFixtureSession(fixture);
    const events: RuntimeEvent[] = [];
    session.setListener({
      onClose: vi.fn<() => void>(),
      onError: vi.fn<(message: string) => void>(),
      onUpdate: vi.fn<StructuredSessionListener["onUpdate"]>(),
      onRuntimeEvent: (event) => events.push(event),
    });

    await session.openThread({ model: "Gemini 3.5 Flash", approvalPolicy: "yolo" });
    const turn = session.startTurn("stop", { model: "Gemini 3.5 Flash" });
    await session.interruptTurn();
    await turn;

    expect(fixture.kill).toHaveBeenCalledOnce();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "turn.completed", state: "interrupted" }),
      ]),
    );
  });

  it("observes turn failures for pool quota write-back without changing the rejection", async () => {
    const fixture = new AntigravityFixture((emit) => {
      emit({ event: "init", conversation_id: "agy-conversation-1" });
      emit({
        event: "result",
        result: { status: "ERROR", error: "RESOURCE_EXHAUSTED: Individual quota reached" },
      });
    });
    const onPromptError = vi.fn<(error: unknown) => void>();
    const { session } = createFixtureSession(fixture, { onPromptError });
    session.setListener({
      onClose: vi.fn<() => void>(),
      onError: vi.fn<(message: string) => void>(),
      onUpdate: vi.fn<StructuredSessionListener["onUpdate"]>(),
      onRuntimeEvent: vi.fn<(event: RuntimeEvent) => void>(),
    });

    await session.openThread({ model: "Gemini 3.5 Flash", approvalPolicy: "yolo" });
    // The turn still rejects with the provider error; the observer is additive.
    await expect(session.startTurn("hi", { model: "Gemini 3.5 Flash" })).rejects.toThrow(
      "RESOURCE_EXHAUSTED: Individual quota reached",
    );
    expect(onPromptError).toHaveBeenCalledOnce();
    expect((onPromptError.mock.calls[0]?.[0] as Error | undefined)?.message).toBe(
      "RESOURCE_EXHAUSTED: Individual quota reached",
    );
  });
});
