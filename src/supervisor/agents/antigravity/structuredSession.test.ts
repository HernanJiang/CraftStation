import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeEvent } from "@/shared/contracts";
import type { CreateStructuredSessionInput, StructuredSessionListener } from "../base";
import { AntigravityStructuredSession } from "./structuredSession";
import { ANTIGRAVITY_PRINT_WAIT_TIMEOUT } from "./argv";
import {
  TurnRetryCoordinator,
  type TurnRetryCoordinatorContext,
} from "@/supervisor/runtime/threadSession/turnRetryCoordinator";
import type { QueuedStructuredTurn, SessionRuntime } from "@/supervisor/runtime/sessionTypes";

type EmitFrame = (frame: Record<string, unknown>) => void;

/** Folds assistant_text content events the way the renderer/persistence do. */
function finalAssistantText(events: RuntimeEvent[], itemId?: string): string {
  let text = "";
  for (const event of events) {
    if (event.type === "content.delta" && event.stream === "assistant_text") {
      if (itemId === undefined || event.itemId === itemId) text += event.delta;
    } else if (event.type === "content.set" && event.stream === "assistant_text") {
      if (itemId === undefined || event.itemId === itemId) text = event.text;
    }
  }
  return text;
}

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

  it("rejects a success result that leaves tools unfinished instead of marking the turn completed", async () => {
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
    await expect(session.startTurn("hello", { model: "Gemini 3.5 Flash" })).rejects.toThrow(
      "尚未交付最终回复",
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "turn.completed", state: "failed" }),
      ]),
    );
    expect(events).not.toEqual(
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

  it("settles the streamed text to the authoritative result response", async () => {
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

    expect(finalAssistantText(events)).toBe("hello world");
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "content.set",
          stream: "assistant_text",
          text: "hello world",
        }),
      ]),
    );
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

    expect(finalAssistantText(events)).toBe("hello world");
  });

  it("drops a diverging regeneration that streamed into the same item", async () => {
    // Probe-verified shape: agy can emit a SECOND, different answer inside one
    // step (`agent_response` deltas that diverge from the first generation)
    // while `result.response` stays the first answer. Per-chunk remainder
    // trimming cannot catch this — the regen is genuinely new text — so the
    // result snapshot must replace the stream.
    const answer = "这个问题问到了 CLIP 最本质、最核心的机制！完整的回答正文。";
    const regenHead = "这个问题问到了 CLIP 最本质、最核心的机制！改写后的回答被截断";
    const fixture = new AntigravityFixture((emit) => {
      emit({ event: "init", conversation_id: "agy-conversation-1" });
      emit({
        event: "step_update",
        step_update: { step_type: "agent_response", state: "ACTIVE", text_delta: answer },
      });
      emit({
        event: "step_update",
        step_update: { step_type: "agent_response", state: "ACTIVE", text_delta: regenHead },
      });
      emit({
        event: "result",
        result: { status: "SUCCESS", response: answer },
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

    // The regen streamed live (deltas are not lossy), but the settled stream
    // is exactly the declared response — the retracted copy is gone.
    expect(finalAssistantText(events)).toBe(answer);
  });

  it("shows exactly the declared response when the snapshot embeds status lines", async () => {
    const statusA = "正在测试提炼精简后的方案并生成排版效果图，稍后为您展示最新效果。\n";
    const statusB = "正在更新官方文档并重新编译导出 PDF，稍后为您汇报结果。\n";
    const draft = "草稿版正文，带有 * *已修正的格式瑕疵**。\n";
    const final = draft.replace("* *已修正的格式瑕疵**", "* **格式已修正**");
    const fixture = new AntigravityFixture((emit) => {
      emit({ event: "init", conversation_id: "agy-conversation-1" });
      emit({
        event: "step_update",
        step_update: { step_type: "agent_response", state: "ACTIVE", text_delta: statusA },
      });
      emit({
        event: "step_update",
        step_update: { step_type: "agent_response", state: "ACTIVE", text_delta: statusB },
      });
      emit({
        event: "result",
        result: { status: "SUCCESS", response: draft + statusA + statusB + final },
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

    expect(finalAssistantText(events)).toBe(draft + statusA + statusB + final);
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

  it.each([
    ["ACTIVE", "ERROR"],
    ["DONE", "ERROR"],
    ["ACTIVE", "SUCCESS"],
    ["DONE", "SUCCESS"],
    ["ACTIVE", "exit"],
    ["DONE", "exit"],
    ["DONE_ONLY", "ERROR"],
    ["DONE_ONLY", "SUCCESS"],
    ["DONE_ONLY", "exit"],
  ])(
    "does not accept pre-tool narration after tool %s and termination %s",
    async (toolState, termination) => {
      const fixture = new AntigravityFixture((emit) => {
        emit({ event: "init", conversation_id: "agy-conversation-1" });
        emit({
          event: "step_update",
          step_update: {
            step_type: "agent_response",
            state: "DONE",
            text_delta: "Let me check the file.",
          },
        });
        if (toolState !== "DONE_ONLY") {
          emit({
            event: "step_update",
            step_update: {
              step_index: 2,
              step_type: "tool",
              tool_name: "run_command",
              state: "ACTIVE",
            },
          });
        }
        if (toolState !== "ACTIVE") {
          emit({
            event: "step_update",
            step_update: {
              step_index: 2,
              step_type: "tool",
              tool_name: "run_command",
              state: "DONE",
              tool_info: { output: "file contents" },
            },
          });
        }
        if (termination !== "exit") {
          emit({
            event: "result",
            result: {
              status: termination,
              response: "Let me check the file.",
              ...(termination === "ERROR"
                ? { error: "request failed: use of closed network connection" }
                : {}),
            },
          });
        }
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
      try {
        const turn = session.startTurn("check the file", { model: "Gemini 3.5 Flash" });
        if (termination === "exit") fixture.emit("exit", 1, null);
        await expect(turn).rejects.toBeInstanceOf(Error);
        expect(events).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: "turn.completed", state: "completed" }),
          ]),
        );
      } finally {
        await session.dispose();
      }
    },
  );

  it("resumes a tools-only success through Craft-Harness and delivers the reply after the tool", async () => {
    let attempt = 0;
    const emitTurn = (emit: EmitFrame) => {
      emit({ event: "init", conversation_id: "agy-conversation-1" });
      if (attempt++ === 0) {
        emit({
          event: "step_update",
          step_update: {
            step_type: "agent_response",
            state: "DONE",
            text_delta: "Let me check the file.",
          },
        });
        emit({
          event: "step_update",
          step_update: {
            step_index: 2,
            step_type: "tool",
            tool_name: "view_file",
            state: "ACTIVE",
          },
        });
        emit({
          event: "result",
          result: { status: "SUCCESS", response: "Let me check the file." },
        });
      } else {
        emit({
          event: "step_update",
          step_update: {
            step_index: 2,
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
            state: "DONE",
            text_delta: "The file was checked.",
          },
        });
        emit({ event: "result", result: { status: "SUCCESS", response: "The file was checked." } });
      }
    };
    const fixture = new AntigravityFixture(emitTurn);
    const { session } = createFixtureSession(fixture);
    const events: RuntimeEvent[] = [];
    const listener: StructuredSessionListener = {
      onClose: vi.fn<() => void>(),
      onError: vi.fn<(message: string) => void>(),
      onUpdate: vi.fn<StructuredSessionListener["onUpdate"]>(),
      onRuntimeEvent: (event) => events.push(event),
    };
    session.setListener(listener);
    const resumedFixture = new AntigravityFixture(emitTurn);
    const { session: resumedSession, spawnProcess: resumedSpawn } =
      createFixtureSession(resumedFixture);
    resumedSession.setListener(listener);
    const config = { model: "Gemini 3.5 Flash" };
    await session.openThread(config);
    let resumed: Promise<void> | undefined;
    const turn: QueuedStructuredTurn = {
      prompt: "check the file",
      config,
      turnId: "turn-1",
      userMessageItemId: "user-1",
    };
    const runtime = {
      threadId: "thread-antigravity",
      agentKind: "antigravity",
      sessionRef: { providerSessionId: "agy-conversation-1" },
    } as SessionRuntime;
    const restartTurn = vi.fn<TurnRetryCoordinatorContext["restartTurn"]>(
      async (_runtime, retry) => {
        // The retained native conversation continues; the original task is not
        // submitted as a new user instruction without its continuation context.
        await session.dispose();
        await resumedSession.openThread(config, runtime.sessionRef);
        resumed = resumedSession.startTurn(`${retry.retryContext}\n${retry.prompt}`, config);
      },
    );
    const coordinator = new TurnRetryCoordinator({
      isDisposed: () => false,
      isCurrentSession: () => true,
      readPolicy: () => ({ maxAttempts: 1, intervalMs: 0 }),
      emit: vi.fn<TurnRetryCoordinatorContext["emit"]>(),
      attachHistoryPreface: vi.fn<TurnRetryCoordinatorContext["attachHistoryPreface"]>(),
      startTurn: vi.fn<TurnRetryCoordinatorContext["startTurn"]>(),
      restartTurn,
      sleep: async () => undefined,
    });
    try {
      const failure = await session.startTurn(turn.prompt, config).catch((error: unknown) => error);
      expect(await coordinator.tryTurnRetry(runtime, turn, failure)).toBe(true);
      expect(restartTurn).toHaveBeenCalledOnce();
      await resumed;
      expect(fixture.requests).toHaveLength(1);
      expect(resumedFixture.requests).toHaveLength(1);
      expect(JSON.stringify(resumedFixture.requests[0])).toContain("Craft-Harness auto-retry");
      const resumedArgs = vi.mocked(resumedSpawn).mock.calls[0]?.[1];
      expect(resumedArgs).toEqual(expect.arrayContaining(["--conversation", "agy-conversation-1"]));
      const toolCompleted = events.findLastIndex(
        (e) => e.type === "item.completed" && e.itemId.startsWith("tool:"),
      );
      const finalReply = events.findLastIndex(
        (e) => e.type === "content.set" && e.text === "The file was checked.",
      );
      expect(finalReply).toBeGreaterThan(toolCompleted);
      expect(
        events.filter((e) => e.type === "turn.completed" && e.state === "completed"),
      ).toHaveLength(1);
      expect(events.at(-1)).toMatchObject({ type: "turn.completed", state: "completed" });
      // The configured budget prevents a tools-only provider from looping.
      expect(await coordinator.tryTurnRetry(runtime, turn, failure)).toBe(false);
    } finally {
      await session.dispose();
      await resumedSession.dispose();
    }
  });

  it("accepts a new final snapshot after a completed tool even without response deltas", async () => {
    const fixture = new AntigravityFixture((emit) => {
      emit({
        event: "step_update",
        step_update: {
          step_type: "agent_response",
          state: "DONE",
          text_delta: "Checking the file.",
        },
      });
      emit({
        event: "step_update",
        step_update: {
          step_index: 2,
          step_type: "tool",
          tool_name: "view_file",
          state: "ACTIVE",
        },
      });
      emit({
        event: "step_update",
        step_update: {
          step_index: 2,
          step_type: "tool",
          tool_name: "view_file",
          state: "DONE",
        },
      });
      emit({
        event: "result",
        result: {
          status: "ERROR",
          response: "The file was checked.",
          error: "use of closed network connection",
        },
      });
    });
    const { session } = createFixtureSession(fixture);
    const events: RuntimeEvent[] = [];
    session.setListener({
      onClose: vi.fn<() => void>(),
      onError: vi.fn<(message: string) => void>(),
      onUpdate: vi.fn<StructuredSessionListener["onUpdate"]>(),
      onRuntimeEvent: (e) => events.push(e),
    });
    await session.openThread({ model: "Gemini 3.5 Flash" });
    try {
      await expect(
        session.startTurn("check the file", { model: "Gemini 3.5 Flash" }),
      ).resolves.toBeUndefined();
      expect(finalAssistantText(events)).toBe("The file was checked.");
      expect(events.filter((e) => e.type === "turn.completed")).toEqual([
        expect.objectContaining({ state: "completed" }),
      ]);
    } finally {
      await session.dispose();
    }
  });

  it("completes with a warning when the result reports an error after the answer was delivered", async () => {
    const fixture = new AntigravityFixture((emit) => {
      emit({ event: "init", conversation_id: "agy-conversation-1" });
      emit({
        event: "step_update",
        step_update: {
          conversation_id: "agy-conversation-1",
          step_index: 1,
          step_type: "agent_response",
          state: "DONE",
          text_delta: "hello from Antigravity",
        },
      });
      emit({
        event: "result",
        result: {
          status: "ERROR",
          error:
            'API error (attempt 1) request failed: Post "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse": write tcp 192.168.1.4:53312->142.250.72.74:443: use of closed network connection',
        },
      });
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
    // The turn resolves — the answer reached the chat; rejecting would feed
    // Craft-Harness a retryable error and regenerate the same reply.
    await expect(session.startTurn("hi", { model: "Gemini 3.5 Flash" })).resolves.toBeUndefined();

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "warning",
          message: expect.stringContaining("API error (attempt 1)"),
        }),
        expect.objectContaining({ type: "turn.completed", state: "completed" }),
      ]),
    );
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(
      events.some((event) => event.type === "turn.completed" && event.state === "failed"),
    ).toBe(false);
    expect(finalAssistantText(events)).toBe("hello from Antigravity");
    expect(updates.at(-1)).toMatchObject({ status: "idle", attention: "none" });
  });

  it("completes with a warning when the process exits after the answer was delivered", async () => {
    const fixture = new AntigravityFixture((emit) => {
      emit({ event: "init", conversation_id: "agy-conversation-1" });
      emit({
        event: "step_update",
        step_update: {
          step_type: "agent_response",
          state: "DONE",
          text_delta: "full answer text",
        },
      });
      // `agy` exits right after its closing frames (probe-verified) — the
      // result frame may never arrive.
    });
    const { session } = createFixtureSession(fixture);
    const events: RuntimeEvent[] = [];
    const onClose = vi.fn<() => void>();
    session.setListener({
      onClose,
      onError: vi.fn<(message: string) => void>(),
      onUpdate: vi.fn<StructuredSessionListener["onUpdate"]>(),
      onRuntimeEvent: (event) => events.push(event),
    });

    await session.openThread({ model: "Gemini 3.5 Flash", approvalPolicy: "yolo" });
    const turn = session.startTurn("hi", { model: "Gemini 3.5 Flash" });
    fixture.emit("exit", 1, null);

    await expect(turn).resolves.toBeUndefined();
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "warning" })]));
    expect(
      events.some((event) => event.type === "turn.completed" && event.state === "failed"),
    ).toBe(false);
    expect(finalAssistantText(events)).toBe("full answer text");
    expect(onClose).toHaveBeenCalledOnce();
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

  it("downgrades the post-turn exit-1 after a failed turn to a warning instead of a second failure", async () => {
    // Probe-verified agy behavior: after emitting a failed `result`, the CLI
    // exits with code 1 on its own. The crash diagnostic must not become a
    // second thread failure ("Native process exited with code 1") that buries
    // the real result-payload error.
    const fixture = new AntigravityFixture((emit) => {
      emit({ event: "init", conversation_id: "agy-conversation-1" });
      emit({ event: "result", result: { status: "ERROR", error: "model exploded" } });
    });
    const { session } = createFixtureSession(fixture);
    const events: RuntimeEvent[] = [];
    const onError = vi.fn<(message: string) => void>();
    const onClose = vi.fn<() => void>();
    session.setListener({
      onClose,
      onError,
      onUpdate: vi.fn<StructuredSessionListener["onUpdate"]>(),
      onRuntimeEvent: (event) => events.push(event),
    });

    await session.openThread({ model: "Gemini 3.8 Flash", approvalPolicy: "yolo" });
    await expect(session.startTurn("fail", { model: "Gemini 3.8 Flash" })).rejects.toThrow(
      "model exploded",
    );
    fixture.emit("exit", 1, null);

    expect(onError).not.toHaveBeenCalled();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "warning",
          message: "Native process exited with code 1 (none).",
        }),
      ]),
    );
    expect(events.filter((event) => event.type === "error")).toHaveLength(1);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("downgrades an idle process crash to a warning and keeps onClose recovery", async () => {
    const fixture = new AntigravityFixture();
    const { session } = createFixtureSession(fixture);
    const events: RuntimeEvent[] = [];
    const onError = vi.fn<(message: string) => void>();
    const onClose = vi.fn<() => void>();
    session.setListener({
      onClose,
      onError,
      onUpdate: vi.fn<StructuredSessionListener["onUpdate"]>(),
      onRuntimeEvent: (event) => events.push(event),
    });

    await session.openThread({ model: "Gemini 3.8 Flash", approvalPolicy: "yolo" });
    await session.startTurn("hello", { model: "Gemini 3.8 Flash" });
    fixture.emit("exit", 1, null);

    expect(onError).not.toHaveBeenCalled();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "warning",
          message: "Native process exited with code 1 (none).",
        }),
      ]),
    );
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("still fails the active turn when the process crashes mid-turn", async () => {
    const fixture = new AntigravityFixture(() => undefined);
    const { session } = createFixtureSession(fixture);
    const events: RuntimeEvent[] = [];
    session.setListener({
      onClose: vi.fn<() => void>(),
      onError: vi.fn<(message: string) => void>(),
      onUpdate: vi.fn<StructuredSessionListener["onUpdate"]>(),
      onRuntimeEvent: (event) => events.push(event),
    });

    await session.openThread({ model: "Gemini 3.8 Flash", approvalPolicy: "yolo" });
    const turn = session.startTurn("hello", { model: "Gemini 3.8 Flash" });
    fixture.emit("exit", 1, null);

    await expect(turn).rejects.toThrow("Native process exited with code 1");
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "turn.completed", state: "failed" }),
      ]),
    );
  });

  it("drops a mid-turn rewritten snapshot instead of showing a cut-off second copy", async () => {
    // Real shape from thread 简历优化 (agy conversation 421235c2): the turn
    // streamed the complete answer, then a step snapshot re-rendered it with
    // an edited middle but was cut mid-token at "1. *". Appending that slice
    // made the reply look truncated after its true ending.
    const sharedHead =
      "结论：这份简历已经足够优秀，可以直接投递。\n\n### 一、优势\n\n1. 叙事契合度极高；\n";
    const streamedAnswer =
      sharedHead +
      "舒展展开；\n更多旧版细节：甲乙丙丁戊己庚辛壬癸。\n\n### 三、收尾\n\n祝您投递顺利！\n";
    const revision =
      sharedHead +
      "舒展开；\n更多旧版细节：甲乙丙丁戊己庚辛壬癸。\n\n### 三、收尾\n\n祝您投递顺利！";
    const partialRevision = revision.slice(0, revision.length - 20);
    const fixture = new AntigravityFixture((emit) => {
      emit({ event: "init", conversation_id: "agy-conversation-1" });
      emit({
        event: "step_update",
        step_update: {
          step_type: "agent_response",
          state: "ACTIVE",
          text_delta: streamedAnswer,
        },
      });
      emit({
        event: "step_update",
        step_update: {
          step_type: "agent_response",
          state: "ACTIVE",
          text_delta: partialRevision,
        },
      });
      emit({
        event: "result",
        result: { status: "SUCCESS", response: revision },
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
    await session.startTurn("polish?", { model: "Gemini 3.5 Flash" });

    const joined = events
      .filter(
        (event): event is Extract<RuntimeEvent, { type: "content.delta" }> =>
          event.type === "content.delta" && event.stream === "assistant_text",
      )
      .map((event) => event.delta)
      .join("");
    expect(joined).toBe(streamedAnswer);
    expect(joined.endsWith("祝您投递顺利！\n")).toBe(true);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "turn.completed", state: "completed" }),
      ]),
    );
    await session.dispose();
  });
});
