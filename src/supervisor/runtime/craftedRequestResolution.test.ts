import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@/shared/contracts";
import { resolveCraftedRequest } from "./craftedRequestResolution";

type CraftedRequest = Extract<RuntimeEvent, { type: "request.opened" }>;

function questionRequest(
  questions: Array<{
    id: string;
    multiSelect?: boolean;
    multiple?: boolean;
    custom: boolean;
    options: Array<{ optionId: string; label: string }>;
  }> = [
    {
      id: "q0",
      multiSelect: false,
      custom: false,
      options: [
        { optionId: "q0.0", label: "TypeScript" },
        { optionId: "q0.1", label: "Rust" },
      ],
    },
  ],
): CraftedRequest {
  return {
    type: "request.opened",
    threadId: "thread-question",
    requestId: "question-1",
    requestType: "tool_user_input",
    payload: {
      summary: "Choose",
      details: { userInputForm: { questions } },
    },
  };
}

describe("crafted native request resolution", () => {
  it.each([[["not-an-option"]], { answers: { q0: "not-an-option" } }])(
    "rejects custom=false unknown options for every response shape",
    (response) => {
      expect(() => resolveCraftedRequest(questionRequest(), response)).toThrow(/unknown option/i);
    },
  );

  it.each([[["q0.0", "q0.1"]], { answers: { q0: ["q0.0", "q0.1"] } }])(
    "rejects multiple values for a single-select question",
    (response) => {
      expect(() => resolveCraftedRequest(questionRequest(), response)).toThrow(/single-select/i);
    },
  );

  it.each([
    [["q0.0", "q0.1"]],
    { answers: { q0: ["q0.0", "q0.1"] } },
    { answers: { q0: { answers: ["q0.0", "q0.1"] } } },
  ])("accepts allowlisted values for a multi-select question", (response) => {
    const request = questionRequest([
      {
        id: "q0",
        multiSelect: true,
        custom: false,
        options: [
          { optionId: "q0.0", label: "TypeScript" },
          { optionId: "q0.1", label: "Rust" },
        ],
      },
    ]);
    expect(resolveCraftedRequest(request, response)).toEqual({
      kind: "question",
      action: "answer",
      answers: [["TypeScript", "Rust"]],
    });
  });

  it("preserves the SDK v2 multiple alias when validating cardinality", () => {
    const request = questionRequest([
      {
        id: "q0",
        multiple: true,
        custom: false,
        options: [
          { optionId: "q0.0", label: "TypeScript" },
          { optionId: "q0.1", label: "Rust" },
        ],
      },
    ]);

    expect(resolveCraftedRequest(request, { answers: { q0: ["q0.0", "q0.1"] } })).toEqual({
      kind: "question",
      action: "answer",
      answers: [["TypeScript", "Rust"]],
    });
  });

  it.each([[["custom answer"]], { answers: { q0: "custom answer" } }])(
    "accepts a non-empty custom answer for every response shape",
    (response) => {
      const request = questionRequest([
        { id: "q0", multiSelect: false, custom: true, options: [] },
      ]);
      expect(resolveCraftedRequest(request, response)).toEqual({
        kind: "question",
        action: "answer",
        answers: [["custom answer"]],
      });
    },
  );

  it.each([
    [],
    [["q0.0"], ["extra"]],
    [[""]],
    [[42]],
    { answers: {} },
    { answers: { q0: "   " } },
    { answers: { q0: 42 } },
    { answers: { q0: "q0.0", extra: "q0.1" } },
  ])("rejects missing, extra, empty, or non-string question answers", (response) => {
    expect(() => resolveCraftedRequest(questionRequest(), response)).toThrow(
      /question|answer|response|identity/i,
    );
  });

  it("keeps the original ACP optionId when mapping allow-once", () => {
    const request: CraftedRequest = {
      type: "request.opened",
      threadId: "thread-perm",
      requestId: "acp-perm-0",
      requestType: "tool_call_approval",
      payload: {
        summary: "tasks__list",
        options: [
          { optionId: "allow-once", label: "allow once" },
          { optionId: "reject-once", label: "reject once" },
        ],
      },
    };
    expect(resolveCraftedRequest(request, { optionId: "allow-once" })).toEqual({
      kind: "permission",
      response: "once",
      optionId: "allow-once",
    });
    expect(resolveCraftedRequest(request, { optionId: "reject-once" })).toEqual({
      kind: "permission",
      response: "reject",
      optionId: "reject-once",
    });
  });
});
