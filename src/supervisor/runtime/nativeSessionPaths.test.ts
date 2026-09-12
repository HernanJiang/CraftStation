import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveNativeSessionPath } from "./nativeSessionPaths";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "craftstation-native-path-"));
  dirs.push(dir);
  return dir;
}

describe("resolveNativeSessionPath", () => {
  it("resolves a Kimi session dir under a managed home", () => {
    const home = makeHome();
    mkdirSync(join(home, "sessions", "work-1", "ses-9"), { recursive: true });
    expect(
      resolveNativeSessionPath({
        provider: "kimi",
        credentialRoot: home,
        nativeSessionId: "ses-9",
      }),
    ).toBe(join(home, "sessions", "work-1", "ses-9"));
  });

  it("resolves a Grok session dir by scanning cwd buckets", () => {
    const home = makeHome();
    mkdirSync(join(home, "sessions", "cwd-a", "uuid-1"), { recursive: true });
    expect(
      resolveNativeSessionPath({
        provider: "grok",
        credentialRoot: home,
        nativeSessionId: "uuid-1",
      }),
    ).toBe(join(home, "sessions", "cwd-a", "uuid-1"));
  });

  it("resolves a Codex rollout by session id", () => {
    const home = makeHome();
    mkdirSync(join(home, "sessions", "2026", "09"), { recursive: true });
    writeFileSync(
      join(home, "sessions", "2026", "09", "rollout-1.jsonl"),
      `${JSON.stringify({ session_meta: { id: "ses-codex" } })}\n`,
    );
    expect(
      resolveNativeSessionPath({
        provider: "codex",
        credentialRoot: home,
        nativeSessionId: "ses-codex",
      }),
    ).toBe(join(home, "sessions", "2026", "09", "rollout-1.jsonl"));
  });

  it("resolves an Antigravity conversation file", () => {
    const home = makeHome();
    mkdirSync(join(home, "conversations"), { recursive: true });
    writeFileSync(join(home, "conversations", "conv-1.pb"), "protobuf");
    expect(
      resolveNativeSessionPath({
        provider: "antigravity",
        credentialRoot: home,
        nativeSessionId: "conv-1",
      }),
    ).toBe(join(home, "conversations", "conv-1.pb"));
  });

  it("falls back to the sessions home dir when the session file is unknown", () => {
    const home = makeHome();
    mkdirSync(join(home, "sessions", "work-1", "ses-9"), { recursive: true });
    expect(
      resolveNativeSessionPath({
        provider: "kimi",
        credentialRoot: home,
        nativeSessionId: "ses-missing",
      }),
    ).toBe(join(home, "sessions"));
  });

  it("returns null for unknown providers and missing homes", () => {
    expect(resolveNativeSessionPath({ provider: "claude", nativeSessionId: "x" })).toBeUndefined();
    expect(
      resolveNativeSessionPath({
        provider: "kimi",
        credentialRoot: join(tmpdir(), "craftstation-no-such-home"),
        nativeSessionId: "x",
      }),
    ).toBeUndefined();
  });
});
