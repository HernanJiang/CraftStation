import { describe, expect, it } from "vitest";
import { stripKimiHarnessNoise } from "./kimiHarnessNoise";

const COMPACTION_BLOCK = [
  "Compacting conversation context…",
  "Compaction is blocked by the current turn; retry when the turn is idle.",
  "Compaction completed.",
  "Messages compacted: 327",
  "Tokens before: 202,707",
  "Tokens after: 65,863",
].join("\n");

describe("stripKimiHarnessNoise", () => {
  it("drops the whole compaction status block", () => {
    expect(stripKimiHarnessNoise(COMPACTION_BLOCK)).toBeUndefined();
  });

  it("drops compaction lines while keeping the surrounding answer", () => {
    expect(stripKimiHarnessNoise(`前半段回答\n${COMPACTION_BLOCK}\n后半段回答`)).toBe(
      "前半段回答\n后半段回答",
    );
  });

  it("drops a single streamed compaction line on its own", () => {
    expect(stripKimiHarnessNoise("Messages compacted: 327")).toBeUndefined();
    expect(stripKimiHarnessNoise("Tokens after: 65,863")).toBeUndefined();
  });

  it("leaves ordinary text untouched", () => {
    expect(stripKimiHarnessNoise("Compaction 这个词可以出现在正常回答里。")).toBe(
      "Compaction 这个词可以出现在正常回答里。",
    );
  });

  it("returns undefined for empty input", () => {
    expect(stripKimiHarnessNoise("")).toBeUndefined();
  });
});
