// @vitest-environment node

import { describe, expect, it } from "vitest";
import { hasUnresolvedConflicts, parseMergeConflicts } from "./mergeConflicts";

const single = [
  "line a",
  "<<<<<<< HEAD",
  "current 1",
  "current 2",
  "=======",
  "incoming 1",
  ">>>>>>> feature/x",
  "line b",
].join("\n");

const threeWay = [
  "<<<<<<< HEAD",
  "ours",
  "||||||| merged common ancestors",
  "base",
  "=======",
  "theirs",
  ">>>>>>> branch",
].join("\n");

const multiple = [
  "a",
  "<<<<<<< HEAD",
  "x",
  "=======",
  "y",
  ">>>>>>> b",
  "between",
  "<<<<<<< HEAD",
  "p",
  "=======",
  "q",
  ">>>>>>> b",
  "end",
].join("\n");

describe("parseMergeConflicts", () => {
  it("returns [] for plain text", () => {
    expect(parseMergeConflicts("hello\nworld")).toEqual([]);
    expect(parseMergeConflicts("")).toEqual([]);
  });

  it("parses a single conflict", () => {
    const [block] = parseMergeConflicts(single);
    expect(block).toBeDefined();
    expect(block?.currentHeaderLine).toBe(2);
    expect(block?.separatorLine).toBe(5);
    expect(block?.incomingFooterLine).toBe(7);
    expect(block?.currentLabel).toBe("HEAD");
    expect(block?.incomingLabel).toBe("feature/x");
    expect(block?.currentRange).toEqual({ startLine: 3, endLine: 4 });
    expect(block?.incomingRange).toEqual({ startLine: 6, endLine: 6 });
    expect(block?.fullRange).toEqual({ startLine: 2, endLine: 7 });
  });

  it("parses 3-way conflicts (treats base as part of current span)", () => {
    const [block] = parseMergeConflicts(threeWay);
    expect(block?.baseHeaderLine).toBe(3);
    expect(block?.separatorLine).toBe(5);
    expect(block?.incomingFooterLine).toBe(7);
  });

  it("parses multiple conflicts in one file", () => {
    const blocks = parseMergeConflicts(multiple);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.currentHeaderLine).toBe(2);
    expect(blocks[1]?.currentHeaderLine).toBe(8);
  });

  it("handles CRLF line endings", () => {
    const blocks = parseMergeConflicts(single.replace(/\n/g, "\r\n"));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.currentLabel).toBe("HEAD");
  });

  it("returns [] for malformed (no separator)", () => {
    const text = "<<<<<<< HEAD\nfoo\n>>>>>>> b\n";
    expect(parseMergeConflicts(text)).toEqual([]);
  });

  it("returns [] for malformed (unterminated)", () => {
    const text = "<<<<<<< HEAD\nfoo\n=======\nbar\n";
    expect(parseMergeConflicts(text)).toEqual([]);
  });

  it("recovers after a nested unterminated marker", () => {
    const text = [
      "<<<<<<< HEAD",
      "broken",
      "<<<<<<< HEAD",
      "good",
      "=======",
      "good2",
      ">>>>>>> b",
    ].join("\n");
    const blocks = parseMergeConflicts(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.currentHeaderLine).toBe(3);
  });

  it("parses end-of-file conflict (no trailing newline)", () => {
    const text = "prefix\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> b";
    const blocks = parseMergeConflicts(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.currentHeaderLine).toBe(2);
    expect(blocks[0]?.incomingFooterLine).toBe(6);
    expect(blocks[0]?.fullRange).toEqual({ startLine: 2, endLine: 6 });
  });
});

describe("hasUnresolvedConflicts", () => {
  it("is true when blocks are present", () => {
    expect(hasUnresolvedConflicts(single)).toBe(true);
  });
  it("is false when buffer is clean", () => {
    expect(hasUnresolvedConflicts("clean text")).toBe(false);
  });
});
