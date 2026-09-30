import { describe, expect, it } from "vitest";
import {
  fastVariantModelId,
  splitFastModelVariants,
  vendorConventionFastBases,
} from "./fastModelVariants";

describe("splitFastModelVariants", () => {
  it("folds -fast variants into their advertised base model", () => {
    const result = splitFastModelVariants(["grok-4.7", "grok-4.7-fast", "grok-4.6"]);
    expect(result.models).toEqual(["grok-4.7", "grok-4.6"]);
    expect(result.fastModels).toEqual(["grok-4.7"]);
    expect(result.fastVariantByBase).toEqual({ "grok-4.7": "grok-4.7-fast" });
  });

  it("folds Grok's -build-fast variant under its base id", () => {
    // The real catalog ships `grok-4.7-build-fast` — stripping `-fast` alone
    // yields `grok-4.7-build`, which is not advertised and must not fold.
    const result = splitFastModelVariants([
      "grok-4.7",
      "grok-4.7-build-fast",
      "grok-4.6",
      "grok-4.5",
    ]);
    expect(result.models).toEqual(["grok-4.7", "grok-4.6", "grok-4.5"]);
    expect(result.fastModels).toEqual(["grok-4.7"]);
    expect(result.fastVariantByBase).toEqual({ "grok-4.7": "grok-4.7-build-fast" });
  });

  it("folds Kimi's -highspeed tier into kimi-for-coding under a prefix", () => {
    const result = splitFastModelVariants([
      "kimi-code/k3-256k",
      "kimi-code/kimi-for-coding",
      "kimi-code/kimi-for-coding-highspeed",
    ]);
    expect(result.models).toEqual(["kimi-code/k3-256k", "kimi-code/kimi-for-coding"]);
    expect(result.fastModels).toEqual(["kimi-code/kimi-for-coding"]);
    expect(result.fastVariantByBase["kimi-code/kimi-for-coding"]).toBe(
      "kimi-code/kimi-for-coding-highspeed",
    );
  });

  it("keeps unpaired fast ids as standalone rows", () => {
    const result = splitFastModelVariants(["grok-4.6", "grok-code-fast-1"]);
    // `grok-code-fast-1`'s base would be `grok-code-fast` — not advertised, so
    // the row stays listed and no Fast toggle is offered for `grok-4.6`.
    expect(result.models).toEqual(["grok-4.6", "grok-code-fast-1"]);
    expect(result.fastModels).toEqual([]);
  });

  it("handles empty and variant-free lists", () => {
    expect(splitFastModelVariants([]).models).toEqual([]);
    const result = splitFastModelVariants(["k3", "k3-256k"]);
    expect(result.fastModels).toEqual([]);
    expect(result.models).toEqual(["k3", "k3-256k"]);
  });
});

describe("fastVariantModelId", () => {
  it("prefers the catalog-derived variant map over the naming heuristic", () => {
    const variants = { "grok-4.7": "grok-4.7-build-fast" };
    expect(fastVariantModelId("grok-4.7", variants)).toBe("grok-4.7-build-fast");
  });

  it("maps kimi-for-coding to the HighSpeed tier id", () => {
    expect(fastVariantModelId("kimi-for-coding")).toBe("kimi-for-coding-highspeed");
    expect(fastVariantModelId("kimi-code/kimi-for-coding")).toBe(
      "kimi-code/kimi-for-coding-highspeed",
    );
  });

  it("appends -build-fast for versioned Grok ids", () => {
    expect(fastVariantModelId("grok-4.7")).toBe("grok-4.7-build-fast");
    expect(fastVariantModelId("grok-4-fast")).toBeNull();
    expect(fastVariantModelId("grok-4.7-build-fast")).toBeNull();
  });

  it("never fabricates a variant for unknown families", () => {
    expect(fastVariantModelId("k3")).toBeNull();
    expect(fastVariantModelId("kimi-code/k3-256k")).toBeNull();
    expect(fastVariantModelId("claude-opus-4.6")).toBeNull();
  });
});

describe("vendorConventionFastBases", () => {
  it("offers fast on every grok-N base even without an advertised variant row", () => {
    expect(vendorConventionFastBases("grok", ["grok-4.7", "grok-4.6", "grok-code-fast-1"])).toEqual(
      ["grok-4.7", "grok-4.6"],
    );
  });

  it("does not return variant-shaped ids as bases", () => {
    expect(vendorConventionFastBases("grok", ["grok-4.7-build-fast"])).toEqual([]);
  });

  it("marks kimi-for-coding with or without the catalog prefix", () => {
    expect(
      vendorConventionFastBases("kimi", [
        "kimi-code/k3-256k",
        "kimi-code/kimi-for-coding",
        "kimi-for-coding",
      ]),
    ).toEqual(["kimi-code/kimi-for-coding", "kimi-for-coding"]);
  });

  it("excludes the advertised -highspeed sibling and unknown kimi models", () => {
    expect(
      vendorConventionFastBases("kimi", ["kimi-code/kimi-for-coding-highspeed", "kimi-code/k3"]),
    ).toEqual([]);
  });

  it("is inert for vendors without a fixed fast-lane convention", () => {
    expect(vendorConventionFastBases("codex", ["gpt-5.5"])).toEqual([]);
    expect(vendorConventionFastBases("claude", ["claude-opus-4.6"])).toEqual([]);
    expect(vendorConventionFastBases("grok", [])).toEqual([]);
  });
});
