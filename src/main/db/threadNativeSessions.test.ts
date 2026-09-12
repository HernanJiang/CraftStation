import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Thread } from "@/shared/contracts";
import { closeDatabase, initDatabase } from "./connection";
import { dbUpsertProject, dbUpsertThread } from "./projectsThreads";
import { dbInsertThreadNativeSession, dbListThreadNativeSessions } from "./threadNativeSessions";

const serverNativeBinding = join(process.cwd(), "dist", "server-native", "better_sqlite3.node");
let nativeBindingEnv: string | undefined;

function databaseOpens(nativeBinding?: string): boolean {
  if (nativeBinding && !existsSync(nativeBinding)) return false;
  try {
    const database = nativeBinding
      ? new Database(":memory:", { nativeBinding })
      : new Database(":memory:");
    database.close();
    return true;
  } catch {
    return false;
  }
}

if (!databaseOpens()) {
  if (!databaseOpens(serverNativeBinding)) {
    execFileSync(process.execPath, [join(process.cwd(), "scripts", "prepare-server-native.mjs")], {
      stdio: "inherit",
    });
  }
  if (!databaseOpens(serverNativeBinding)) {
    throw new Error("Unable to prepare a Node-compatible better-sqlite3 binding for tests.");
  }
  nativeBindingEnv = serverNativeBinding;
}

describe("thread native sessions", () => {
  let dir = "";

  beforeEach(() => {
    if (nativeBindingEnv) {
      process.env.CRAFTSTATION_BETTER_SQLITE3_NATIVE_BINDING = nativeBindingEnv;
    }
    dir = mkdtempSync(join(tmpdir(), "craftstation-native-sessions-"));
    initDatabase(join(dir, "state.sqlite"));
    dbUpsertProject(
      {
        id: "project-1",
        name: "Test project",
        location: { kind: "posix", path: "/tmp/project" },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      0,
    );
    dbUpsertThread(
      {
        id: "thread-1",
        projectId: "project-1",
        title: "Thread",
        agentKind: "grok",
        config: { model: "grok-4.6" },
        status: "idle",
        attention: "none",
        canResumeWithConfig: false,
        archived: false,
        done: false,
        starred: false,
        presentationMode: "gui",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      } as Thread,
      0,
    );
  });

  afterEach(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it("appends switch history and lists it oldest-first", () => {
    dbInsertThreadNativeSession({
      threadId: "thread-1",
      harness: "grok",
      model: "grok-4.6",
      nativeSessionId: "ses-grok",
      poolAccountId: "grok:a",
    });
    dbInsertThreadNativeSession({ threadId: "thread-1", harness: "kimi", model: "kimi-k2" });

    const rows = dbListThreadNativeSessions("thread-1");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      harness: "grok",
      model: "grok-4.6",
      nativeSessionId: "ses-grok",
      poolAccountId: "grok:a",
    });
    expect(rows[1]).toMatchObject({ harness: "kimi", nativeSessionId: null });
    expect(dbListThreadNativeSessions("thread-other")).toEqual([]);
  });
});
