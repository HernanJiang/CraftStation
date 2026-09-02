import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeEvent } from "@/shared/contracts";
import type { CreateStructuredSessionInput, StructuredSessionListener } from "../base";
import { CommandCodeStructuredSession } from "./structuredSession";

type EmitFrame = (frame: Record<string, unknown>) => void;

const SESSION_ID = "af75c40e-44dd-4369-a187-571745a01df2";

function emitSuccessfulTurn(emit: EmitFrame): void {
  emit({ type: "event", event: { type: "run_start", sessionId: SESSION_ID } });
  emit({ type: "event", event: { type: "text_delta", delta: "hello from Command Code" } });
  emit({
    type: "result",
    subtype: "success",
    sessionId: SESSION_ID,
    stopReason: "end_turn",
    usage: { inputTokens: 8, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
    durationMs: 20,
    finalText: "hello from Command Code",
  });
}

class CommandCodeFixture extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin: Writable;
  killed = false;
  kill = vi.fn<() => boolean>(() => {
    this.killed = true;
    this.emit("exit", null, "SIGTERM");
    return true;
  });

  constructor(private readonly onStart: (emit: EmitFrame) => void = emitSuccessfulTurn) {
    super();
    this.stdin = new Writable({
      write: (_chunk, _encoding, callback) => callback(),
    });
    queueMicrotask(() => {
      this.onStart((frame) => this.stdout.write(`${JSON.stringify(frame)}\n`));
    });
  }
}

function spawnedCommandLine(spawnProcess: typeof spawn, callIndex = 0): string {
  const args = vi.mocked(spawnProcess).mock.calls[callIndex]?.[1] as string[] | undefined;
  if (!args) return "";
  const encodedAt = args.indexOf("-EncodedCommand");
  if (encodedAt >= 0 && args[encodedAt + 1]) {
    return Buffer.from(args[encodedAt + 1]!, "base64").toString("utf16le");
  }
  return args.join(" ");
}

function createFixtureSession(
  fixtures: CommandCodeFixture | CommandCodeFixture[],
  inputOverrides: Partial<CreateStructuredSessionInput> = {},
) {
  const queue = Array.isArray(fixtures) ? [...fixtures] : [fixtures];
  const spawnProcess = vi.fn<() => ChildProcessWithoutNullStreams>(() => {
    const next = queue.shift() ?? new CommandCodeFixture();
    return next as unknown as ChildProcessWithoutNullStreams;
  }) as unknown as typeof spawn;
  const session = new CommandCodeStructuredSession(
    {
      threadId: "thread-commandcode",
      projectLocation: { kind: "windows", path: "C:\\repo" },
      config: { model: "deepseek/deepseek-v4-flash", approvalPolicy: "yolo" },
      presentationMode: "gui",
      baseSpawnEnv: { COMMANDCODE_SKIP_UPDATES: "1" },
      ...inputOverrides,
    },
    { spawnProcess },
  );
  return { session, spawnProcess };
}

describe("CommandCodeStructuredSession", () => {
  it("maps the official -p json protocol into CraftStation runtime events", async () => {
    const fixture = new CommandCodeFixture();
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
      session.openThread({ model: "deepseek/deepseek-v4-flash", approvalPolicy: "yolo" }),
    ).resolves.toBeUndefined();
    expect(spawnProcess).not.toHaveBeenCalled();

    await session.startTurn("hello", { model: "deepseek/deepseek-v4-flash" });

    const commandLine = spawnedCommandLine(spawnProcess);
    expect(commandLine).toContain("--output-format");
    expect(commandLine).toContain("-p");
    expect(commandLine).toContain("hello");
    expect(commandLine).toContain("--yolo");
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionRef: expect.objectContaining({ providerSessionId: SESSION_ID }),
        }),
      ]),
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "turn.started" }),
        expect.objectContaining({ type: "session.started" }),
        expect.objectContaining({
          type: "item.started",
          itemType: "assistant_message",
        }),
        expect.objectContaining({
          type: "content.delta",
          stream: "assistant_text",
          delta: "hello from Command Code",
        }),
        expect.objectContaining({ type: "turn.completed", state: "completed" }),
      ]),
    );

    await session.dispose();
  });

  it("resumes the captured session id on the next print process", async () => {
    const first = new CommandCodeFixture();
    const second = new CommandCodeFixture();
    const { session, spawnProcess } = createFixtureSession([first, second]);
    session.setListener({
      onClose: vi.fn<() => void>(),
      onError: vi.fn<(message: string) => void>(),
      onUpdate: vi.fn<StructuredSessionListener["onUpdate"]>(),
      onRuntimeEvent: vi.fn<(event: RuntimeEvent) => void>(),
    });

    await session.openThread({ model: "deepseek/deepseek-v4-flash" });
    await session.startTurn("hello", { model: "deepseek/deepseek-v4-flash" });
    await session.startTurn("again", { model: "deepseek/deepseek-v4-flash" });

    expect(spawnProcess).toHaveBeenCalledTimes(2);
    const secondCommand = spawnedCommandLine(spawnProcess, 1);
    expect(secondCommand).toContain("--resume");
    expect(secondCommand).toContain(SESSION_ID);
    expect(secondCommand).toContain("-p");
    expect(secondCommand).toContain("again");
    await session.dispose();
  });

  it("kills the print process on Stop and completes the turn as interrupted", async () => {
    const fixture = new CommandCodeFixture(() => undefined);
    const { session } = createFixtureSession(fixture);
    const events: RuntimeEvent[] = [];
    session.setListener({
      onClose: vi.fn<() => void>(),
      onError: vi.fn<(message: string) => void>(),
      onUpdate: vi.fn<StructuredSessionListener["onUpdate"]>(),
      onRuntimeEvent: (event) => events.push(event),
    });

    await session.openThread({ model: "deepseek/deepseek-v4-flash" });
    const turn = session.startTurn("hang", { model: "deepseek/deepseek-v4-flash" });
    await session.interruptTurn();
    await turn;

    expect(fixture.killed).toBe(true);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "turn.completed", state: "interrupted" }),
      ]),
    );
    await session.dispose();
  });

  it("does not close the CraftStation session when the print process exits", async () => {
    const fixture = new CommandCodeFixture();
    const { session } = createFixtureSession(fixture);
    const onClose = vi.fn<() => void>();
    session.setListener({
      onClose,
      onError: vi.fn<(message: string) => void>(),
      onUpdate: vi.fn<StructuredSessionListener["onUpdate"]>(),
      onRuntimeEvent: vi.fn<(event: RuntimeEvent) => void>(),
    });

    await session.openThread({ model: "deepseek/deepseek-v4-flash" });
    await session.startTurn("hello", { model: "deepseek/deepseek-v4-flash" });
    expect(onClose).not.toHaveBeenCalled();
    await session.dispose();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
