import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatThreadAddressClipboard, resolveNativeSessionPath } from "./nativeSessionPaths";

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

  it("resolves a Kimi session_ prefixed dir from a bare uuid", () => {
    const home = makeHome();
    const sessionDir = join(
      home,
      "sessions",
      "wd_eq-agent",
      "session_9e226cdd-e252-4827-b074-ff3bc143be88",
    );
    mkdirSync(sessionDir, { recursive: true });
    expect(
      resolveNativeSessionPath({
        provider: "kimi",
        credentialRoot: home,
        nativeSessionId: "9e226cdd-e252-4827-b074-ff3bc143be88",
      }),
    ).toBe(sessionDir);
  });

  it("does not fall back to the sessions store when the session is missing", () => {
    const home = makeHome();
    mkdirSync(join(home, "sessions", "work-1", "ses-9"), { recursive: true });
    expect(
      resolveNativeSessionPath({
        provider: "kimi",
        credentialRoot: home,
        nativeSessionId: "ses-missing",
      }),
    ).toBeUndefined();
  });

  it("formats harness:sessionId plus the concrete path for the clipboard", () => {
    expect(
      formatThreadAddressClipboard([
        {
          harness: "kimi",
          nativeSessionId: "session_abc",
          path: "C:\\Users\\me\\.kimi-code\\sessions",
        },
      ]),
    ).toBe("kimi:session_abc");
    expect(
      formatThreadAddressClipboard([
        {
          harness: "kimi",
          nativeSessionId: "session_abc",
          path: "C:\\Users\\me\\.kimi-code\\sessions\\wd_eq\\session_abc",
        },
      ]),
    ).toBe("kimi:session_abc\nC:\\Users\\me\\.kimi-code\\sessions\\wd_eq\\session_abc");
  });

  it("returns null for unknown providers and missing homes", () => {
    expect(
      resolveNativeSessionPath({ provider: "not-a-harness", nativeSessionId: "x" }),
    ).toBeUndefined();
    expect(
      resolveNativeSessionPath({
        provider: "kimi",
        credentialRoot: join(tmpdir(), "craftstation-no-such-home"),
        nativeSessionId: "x",
      }),
    ).toBeUndefined();
  });
});
