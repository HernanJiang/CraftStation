import { describe, expect, it } from "vitest";
import {
  buildGoalContextText,
  isCodexNativeGoalAgent,
  parseGoalSlashCommand,
  stripLeadingGoalCommand,
  validateGoalPrompt,
} from "./threadGoal";


describe("parseGoalSlashCommand", () => {
  it("parses /goal with a prompt", () => {
    expect(parseGoalSlashCommand("/goal fix auth")).toEqual({ kind: "set", prompt: "fix auth" });
  });

  it("trims the prompt and keeps newlines", () => {
    expect(parseGoalSlashCommand("/goal   line one\nline two  ")).toEqual({
      kind: "set",
      prompt: "line one\nline two",
    });
  });

  it("reports an empty goal", () => {
    expect(parseGoalSlashCommand("/goal")).toEqual({ kind: "empty" });
    expect(parseGoalSlashCommand("/goal   ")).toEqual({ kind: "empty" });
  });

  it("ignores lookalike commands and plain text", () => {
    expect(parseGoalSlashCommand("/goals fix")).toEqual({ kind: "not-goal" });
    expect(parseGoalSlashCommand("/goalie")).toEqual({ kind: "not-goal" });
    expect(parseGoalSlashCommand("please /goal this")).toEqual({ kind: "not-goal" });
    expect(parseGoalSlashCommand("hello")).toEqual({ kind: "not-goal" });
  });
});

describe("stripLeadingGoalCommand", () => {
  it("strips the command from leading text, keeping the rest", () => {
    expect(stripLeadingGoalCommand([{ kind: "text", content: "/goal fix auth" }])).toEqual([
      { kind: "text", content: "fix auth" },
    ]);
  });

  it("drops an emptied leading segment but keeps the tail", () => {
    expect(
      stripLeadingGoalCommand([
        { kind: "text", content: "/goal   " },
        { kind: "file", path: "a.ts" },
      ]),
    ).toEqual([{ kind: "file", path: "a.ts" }]);
  });

  it("leaves lookalikes and non-leading commands untouched", () => {
    const lookalike = [{ kind: "text" as const, content: "/goals fix" }];
    expect(stripLeadingGoalCommand(lookalike)).toBe(lookalike);
    const fileFirst = [
      { kind: "file" as const, path: "a.ts" },
      { kind: "text" as const, content: "/goal fix" },
    ];
    expect(stripLeadingGoalCommand(fileFirst)).toBe(fileFirst);
  });
});

describe("validateGoalPrompt", () => {
  it("accepts a normal prompt", () => {
    expect(validateGoalPrompt("  fix auth  ")).toEqual({ ok: true, prompt: "fix auth" });
  });

  it("rejects empty prompts but accepts any length", () => {
    expect(validateGoalPrompt("   ").ok).toBe(false);
    expect(validateGoalPrompt("x".repeat(4001)).ok).toBe(true);
    expect(validateGoalPrompt("x".repeat(100_000)).ok).toBe(true);
  });
});

describe("buildGoalContextText", () => {
  it("labels the block as fallback context, not a user message", () => {
    const text = buildGoalContextText("fix auth");
    expect(text).toContain("fix auth");
    expect(text).toContain("fallback");
    expect(text).toContain("/goal");
  });
});

describe("isCodexNativeGoalAgent", () => {
  it("routes only codex to the native goal surface", () => {
    expect(isCodexNativeGoalAgent("codex")).toBe(true);
    for (const kind of ["kimi", "grok", "antigravity", "opencode", "claude"]) {
      expect(isCodexNativeGoalAgent(kind)).toBe(false);
    }
  });
});
