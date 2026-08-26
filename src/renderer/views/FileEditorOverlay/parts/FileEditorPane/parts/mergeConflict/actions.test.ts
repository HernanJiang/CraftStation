import { describe, expect, it } from "vitest";
import type { editor as MonacoEditor } from "monaco-editor";
import { parseMergeConflicts } from "@/renderer/utils/mergeConflicts";
import { buildReplacement } from "./actions";

function fakeModel(text: string): MonacoEditor.ITextModel {
  const lines = text.split(/\r?\n/);
  return {
    getLineContent: (line: number) => lines[line - 1] ?? "",
    getLineCount: () => lines.length,
    getLineMaxColumn: (line: number) => (lines[line - 1]?.length ?? 0) + 1,
  } as unknown as MonacoEditor.ITextModel;
}

const text = [
  "alpha",
  "<<<<<<< HEAD",
  "current line 1",
  "current line 2",
  "=======",
  "incoming line 1",
  ">>>>>>> branch",
  "omega",
].join("\n");

describe("buildReplacement", () => {
  const model = fakeModel(text);
  const block = parseMergeConflicts(text)[0]!;

  it("returns current content for 'current'", () => {
    expect(buildReplacement(model, block, "current")).toBe("current line 1\ncurrent line 2\n");
  });

  it("returns incoming content for 'incoming'", () => {
    expect(buildReplacement(model, block, "incoming")).toBe("incoming line 1\n");
  });

  it("returns concatenated current + incoming for 'both'", () => {
    expect(buildReplacement(model, block, "both")).toBe(
      "current line 1\ncurrent line 2\nincoming line 1\n",
    );
  });

  it("handles empty current side", () => {
    const empty = ["<<<<<<< HEAD", "=======", "x", ">>>>>>> b"].join("\n");
    const m = fakeModel(empty);
    const b = parseMergeConflicts(empty)[0]!;
    expect(buildReplacement(m, b, "current")).toBe("");
    expect(buildReplacement(m, b, "incoming")).toBe("x\n");
    expect(buildReplacement(m, b, "both")).toBe("x\n");
  });
});
// @vitest-environment node
