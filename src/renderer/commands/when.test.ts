// @vitest-environment node

import { describe, expect, it } from "vitest";
import { evaluateWhenClause } from "./when";

describe("evaluateWhenClause", () => {
  it("evaluates boolean expressions against command context", () => {
    const context = {
      hasProject: true,
      inputFocus: false,
      editorFocus: false,
      view: "thread",
    };

    expect(evaluateWhenClause("hasProject && !inputFocus && !editorFocus", context)).toBe(true);
    expect(evaluateWhenClause("hasProject && inputFocus", context)).toBe(false);
  });

  it("supports equality checks for string context", () => {
    expect(evaluateWhenClause("view == 'thread'", { view: "thread" })).toBe(true);
    expect(evaluateWhenClause("view != 'thread'", { view: "thread" })).toBe(false);
  });
});
