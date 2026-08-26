import { describe, expect, it } from "vitest";
import {
  extractAcpFileChangesFromContent,
  hasSubstantialAcpRawOutput,
  joinAcpContentFileChangeDiffs,
} from "./acpFileChangeContent";

describe("extractAcpFileChangesFromContent", () => {
  it("returns an empty list for non-array content", () => {
    expect(extractAcpFileChangesFromContent(undefined)).toEqual([]);
    expect(extractAcpFileChangesFromContent({ type: "diff" })).toEqual([]);
  });

  it("builds a unified diff from ACP diff content blocks", () => {
    const changes = extractAcpFileChangesFromContent([
      {
        type: "diff",
        path: "styles.css",
        oldText: ".body { color: red; }",
        newText: ".body { color: blue; }",
      },
    ]);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.path).toBe("styles.css");
    expect(changes[0]?.unifiedDiff).toContain("diff --git a/styles.css b/styles.css");
    expect(changes[0]?.unifiedDiff).toContain("-.body { color: red; }");
    expect(changes[0]?.unifiedDiff).toContain("+.body { color: blue; }");
  });

  it("joins multiple diff blocks for multi-file edits", () => {
    const joined = joinAcpContentFileChangeDiffs(
      extractAcpFileChangesFromContent([
        { type: "diff", path: "a.ts", oldText: "a", newText: "b" },
        { type: "diff", path: "b.ts", oldText: "c", newText: "d" },
      ]),
    );
    expect(joined).toContain("diff --git a/a.ts");
    expect(joined).toContain("diff --git a/b.ts");
  });
});

describe("hasSubstantialAcpRawOutput", () => {
  it("treats empty objects as non-substantial so content diffs can win", () => {
    expect(hasSubstantialAcpRawOutput({})).toBe(false);
    expect(hasSubstantialAcpRawOutput(undefined)).toBe(false);
    expect(hasSubstantialAcpRawOutput({ stdout: "ok" })).toBe(true);
  });
});
