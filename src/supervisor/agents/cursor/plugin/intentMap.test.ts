import { describe, expect, it } from "vitest";
import { cursorIntentFor } from "./intentMap";

describe("cursorIntentFor", () => {
  it("maps sessionStart to session.started", () => {
    expect(cursorIntentFor("sessionStart", undefined)).toBe("session.started");
  });

  it("maps prompt and tool-use events to session.turn_started", () => {
    expect(cursorIntentFor("beforeSubmitPrompt", undefined)).toBe("session.turn_started");
    expect(cursorIntentFor("preToolUse", undefined)).toBe("session.turn_started");
    expect(cursorIntentFor("postToolUse", undefined)).toBe("session.turn_started");
  });

  it("maps stop with completed/missing status to session.turn_finished", () => {
    expect(cursorIntentFor("stop", { status: "completed" })).toBe("session.turn_finished");
    expect(cursorIntentFor("stop", undefined)).toBe("session.turn_finished");
    expect(cursorIntentFor("stop", { status: "" })).toBe("session.turn_finished");
  });

  it("maps stop with error/aborted to session.turn_errored", () => {
    expect(cursorIntentFor("stop", { status: "error" })).toBe("session.turn_errored");
    expect(cursorIntentFor("stop", { status: "aborted" })).toBe("session.turn_errored");
    expect(cursorIntentFor("stop", { status: "ABORTED" })).toBe("session.turn_errored");
  });

  it("prefers payload.hook_event_name over the argv eventName", () => {
    expect(cursorIntentFor("preToolUse", { hook_event_name: "stop", status: "completed" })).toBe(
      "session.turn_finished",
    );
    expect(cursorIntentFor("anything", { hook_event_name: "sessionStart" })).toBe(
      "session.started",
    );
  });

  it("returns undefined for unmapped events (sessionEnd, beforeShellExecution, etc.)", () => {
    expect(cursorIntentFor("sessionEnd", undefined)).toBeUndefined();
    expect(cursorIntentFor("beforeShellExecution", undefined)).toBeUndefined();
    expect(cursorIntentFor("afterFileEdit", undefined)).toBeUndefined();
    expect(cursorIntentFor("", undefined)).toBeUndefined();
  });
});
