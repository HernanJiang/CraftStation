import { describe, expect, it } from "vitest";
import {
  appendRuntimeStream,
  MAX_RUNTIME_OUTPUT_CHARS,
  RUNTIME_OUTPUT_TRUNCATION_MARKER,
} from "./runtimeStream";

describe("runtime stream bounds", () => {
  it("keeps only the newest tail when one provider frame is larger than the cap", () => {
    const output = appendRuntimeStream(
      "old",
      "x".repeat(MAX_RUNTIME_OUTPUT_CHARS * 4),
      "command_output",
    );

    expect(output).toHaveLength(MAX_RUNTIME_OUTPUT_CHARS);
    expect(output.startsWith(RUNTIME_OUTPUT_TRUNCATION_MARKER)).toBe(true);
    expect(output.endsWith("x".repeat(100))).toBe(true);
  });

  it("does not bound assistant text streams", () => {
    const delta = "x".repeat(MAX_RUNTIME_OUTPUT_CHARS + 1);

    expect(appendRuntimeStream("", delta, "assistant_text")).toBe(delta);
  });
});
