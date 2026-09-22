import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, initDatabase } from "../db/connection";
import { dbUpsertProject, dbUpsertThread } from "../db/projectsThreads";
import {
  assertKnownHarness,
  inferNativeHarnessFromModel,
  deleteNativeBindingsForThread,
  discoverCodexThreads,
  getNativeBinding,
  getNativeBindingByThread,
  listNativeBindingsByWorkspace,
  putNativeBinding,
  resolveWorkspace,
  workspacesEqual,
} from "./nativeThreadIndex";
import { formatNativeAddress, parseNativeAddress } from "@/shared/nativeThreads";

const serverNativeBinding = join(process.cwd(), "dist", "server-native", "better_sqlite3.node");
let nativeBindingEnv: string | undefined;
let sqliteAvailable = true;
try {
  new Database(":memory:").close();
} catch {
  if (existsSync(serverNativeBinding)) nativeBindingEnv = serverNativeBinding;
  else sqliteAvailable = false;
}

describe("native thread addresses", () => {
  it("formats and parses harness:nativeId addresses", () => {
    expect(formatNativeAddress("codex", "C123")).toBe("codex:C123");
    expect(parseNativeAddress("kimi:K456")).toEqual({ harness: "kimi", nativeId: "K456" });
    expect(() => parseNativeAddress("no-separator")).toThrow(/Invalid native thread address/);
    expect(() => parseNativeAddress("codex:")).toThrow(/Invalid native thread address/);
  });

  it("accepts every harness slug and rejects an empty id", () => {
    expect(() => assertKnownHarness("codex")).not.toThrow();
    expect(() => assertKnownHarness("devin")).not.toThrow();
    expect(() => assertKnownHarness("claude")).not.toThrow();
    expect(() => assertKnownHarness("commandcode")).not.toThrow();
    expect(() => assertKnownHarness("")).toThrow(/Invalid harness id/);
  });

  it("infers a native harness from the model family", () => {
    expect(inferNativeHarnessFromModel("gemini-3.8-flash")).toBe("antigravity");
    expect(inferNativeHarnessFromModel("google:gemini-3.8-flash")).toBe("antigravity");
    expect(inferNativeHarnessFromModel("grok-4.6")).toBe("grok");
    expect(inferNativeHarnessFromModel("k2")).toBe("kimi");
    expect(inferNativeHarnessFromModel("opencode-go/muse-spark-1.3-contributor")).toBe("opencode");
    expect(inferNativeHarnessFromModel("gpt-5.4")).toBe("codex");
    expect(inferNativeHarnessFromModel("mystery-model")).toBeNull();
  });

  it("infers devin from Cognition SWE model ids without stealing kimi/codex", () => {
    expect(inferNativeHarnessFromModel("swe-2-max")).toBe("devin");
    expect(inferNativeHarnessFromModel("swe-2")).toBe("devin");
    expect(inferNativeHarnessFromModel("swe-1")).toBe("devin");
    expect(inferNativeHarnessFromModel("swe")).toBe("devin");
    expect(inferNativeHarnessFromModel("cognition:swe-2-max")).toBe("devin");
    expect(inferNativeHarnessFromModel("devin")).toBe("devin");
    // Regression: existing families are untouched by the devin rule.
    expect(inferNativeHarnessFromModel("kimi-for-coding")).toBe("kimi");
    expect(inferNativeHarnessFromModel("gpt-5.6")).toBe("codex");
  });

  it("normalizes trailing slashes and same-path equality", () => {
    expect(workspacesEqual("/tmp/x/", "/tmp/x")).toBe(true);
    expect(workspacesEqual("/tmp/x", "/tmp/y")).toBe(false);
  });

  it.runIf(process.platform === "win32")("folds Windows drive case and separators", () => {
    expect(resolveWorkspace("D:\\Work\\CraftStation\\")).toBe("d:/work/craftstation");
    expect(workspacesEqual("D:/Work/CraftStation", "d:\\work\\CRAFTSTATION\\")).toBe(true);
  });

  it.runIf(process.platform !== "win32")("keeps POSIX case intact", () => {
    expect(resolveWorkspace("/tmp/X/")).toBe("/tmp/X");
    expect(workspacesEqual("/tmp/X", "/tmp/x")).toBe(false);
  });
});

describe("codex native discovery", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "craftstation-codex-home-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  function rollout(id: string, cwd: string): void {
    const dir = join(home, "sessions", "2026");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `rollout-2026-09-05T10-00-00-${id}.jsonl`),
      `${JSON.stringify({ type: "session_meta", payload: { id, cwd } })}\n`,
    );
  }

  it("discovers external CLI threads by workspace without spawning anything", () => {
    rollout("C123", "/tmp/proj");
    rollout("C999", "/tmp/other");
    writeFileSync(join(home, "sessions", "2026", "notes.txt"), "not a rollout");

    const peers = discoverCodexThreads({
      extraHomes: [home],
      workspace: "/tmp/proj",
    });
    expect(peers).toHaveLength(1);
    expect(peers[0]).toMatchObject({
      harness: "codex",
      nativeId: "C123",
      address: "codex:C123",
      workspace: resolveWorkspace("/tmp/proj"),
    });
  });
});

describe.skipIf(!sqliteAvailable)("native thread bindings (real sqlite)", () => {
  let dir: string;

  beforeEach(() => {
    if (nativeBindingEnv) {
      process.env.CRAFTSTATION_BETTER_SQLITE3_NATIVE_BINDING = nativeBindingEnv;
    }
    dir = mkdtempSync(join(tmpdir(), "craftstation-native-index-"));
    initDatabase(join(dir, "state.sqlite"));
  });

  afterEach(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CRAFTSTATION_BETTER_SQLITE3_NATIVE_BINDING;
  });

  it("binds an address to a thread row and resolves both directions", () => {
    dbUpsertProject(
      {
        id: "project-1",
        name: "project-1",
        location: { kind: "posix", path: "/tmp/proj" },
        createdAt: "2026-08-31T00:00:00.000Z",
      },
      0,
    );
    for (const threadId of ["thread-1", "thread-2"]) {
      dbUpsertThread(
        {
          id: threadId,
          projectId: "project-1",
          title: threadId,
          agentKind: "codex",
          config: { model: "gpt-5.6" },
          status: "inactive",
          attention: "none",
          canResumeWithConfig: false,
          archived: false,
          done: false,
          starred: false,
          presentationMode: "gui",
          createdAt: "2026-08-31T00:00:00.000Z",
          updatedAt: "2026-08-31T00:00:00.000Z",
        },
        0,
      );
    }
    putNativeBinding({
      address: "codex:C123",
      threadId: "thread-1",
      workspace: "/tmp/proj",
      origin: "external",
      boundAt: new Date(0).toISOString(),
    });
    expect(getNativeBinding("codex:C123")).toMatchObject({
      threadId: "thread-1",
      harness: "codex",
      nativeId: "C123",
    });
    expect(getNativeBindingByThread("thread-1")?.address).toBe("codex:C123");
    expect(listNativeBindingsByWorkspace("/tmp/proj")).toHaveLength(1);
    // Re-binding the same address moves it (no duplicate native thread).
    putNativeBinding({
      address: "codex:C123",
      threadId: "thread-2",
      workspace: "/tmp/proj",
      origin: "external",
      boundAt: new Date(1).toISOString(),
    });
    expect(getNativeBinding("codex:C123")?.threadId).toBe("thread-2");
    deleteNativeBindingsForThread("thread-2");
    expect(getNativeBinding("codex:C123")).toBeNull();
  });
});
