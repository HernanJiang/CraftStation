import { describe, expect, it } from "vitest";
import { coerceStringifiedJsonArgs, tryParseStringifiedJson } from "./stringifiedJsonArgs";

describe("tryParseStringifiedJson", () => {
  it("parses stringified JSON and passes everything else through", () => {
    expect(tryParseStringifiedJson('{"kind":"new"}')).toEqual({ kind: "new" });
    expect(tryParseStringifiedJson("[1,2]")).toEqual([1, 2]);
    expect(tryParseStringifiedJson(42)).toBe(42);
    expect(tryParseStringifiedJson(null)).toBe(null);
    expect(tryParseStringifiedJson("not json")).toBe("not json");
  });
});

describe("coerceStringifiedJsonArgs", () => {
  const schema = {
    type: "object",
    properties: {
      window: { type: "object" },
      fields: { type: "array", items: { type: "string" } },
      label: { type: "string" },
      maybeObject: { type: ["object", "null"] },
      recurrence: {
        oneOf: [
          { type: "object", required: ["kind", "minute"] },
          { type: "object", required: ["kind", "days", "time"] },
        ],
      },
      anyTarget: { anyOf: [{ type: "object" }, { type: "string" }] },
    },
  };

  it("unwraps params declared as object or array", () => {
    expect(
      coerceStringifiedJsonArgs(
        { window: '{"app":"calc","id":1}', fields: '["text","box"]' },
        schema,
      ),
    ).toEqual({ window: { app: "calc", id: 1 }, fields: ["text", "box"] });
  });

  it("never converts string-declared params, even when they hold valid JSON", () => {
    const args = { label: '{"looks":"like json"}' };
    expect(coerceStringifiedJsonArgs(args, schema)).toEqual(args);
  });

  it("unwraps params declared through oneOf/anyOf object branches", () => {
    expect(
      coerceStringifiedJsonArgs({ recurrence: '{"kind":"hourly","minute":5}' }, schema),
    ).toEqual({ recurrence: { kind: "hourly", minute: 5 } });
    expect(coerceStringifiedJsonArgs({ anyTarget: '{"kind":"new"}' }, schema)).toEqual({
      anyTarget: { kind: "new" },
    });
  });

  it("unwraps type-union declarations that include object", () => {
    expect(coerceStringifiedJsonArgs({ maybeObject: '{"a":1}' }, schema)).toEqual({
      maybeObject: { a: 1 },
    });
  });

  it("keeps invalid JSON untouched (same reference) so tool validation reports it", () => {
    const args = { window: "{not json" };
    expect(coerceStringifiedJsonArgs(args, schema)).toBe(args);
  });

  it("ignores non-string values, undeclared params, and non-{[ strings", () => {
    const args = {
      window: { app: "calc", id: 1 },
      undeclared: '{"a":1}',
      fields: "null",
    };
    expect(coerceStringifiedJsonArgs(args, schema)).toBe(args);
  });

  it("returns args unchanged when the schema has no usable properties", () => {
    const args = { window: '{"a":1}' };
    expect(coerceStringifiedJsonArgs(args, { type: "object" })).toBe(args);
    expect(coerceStringifiedJsonArgs(args, undefined)).toBe(args);
  });

  it("does not mutate the caller's arguments bag", () => {
    const args = { window: '{"a":1}', label: "keep" };
    const result = coerceStringifiedJsonArgs(args, schema);
    expect(args.window).toBe('{"a":1}');
    expect(result).not.toBe(args);
  });
});
