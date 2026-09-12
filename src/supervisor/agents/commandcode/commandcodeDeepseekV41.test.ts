import { describe, expect, it } from "vitest";
import {
  buildCommandCodeModelPickerCapabilities,
  defaultCommandCodeCapabilities,
  resolveCommandCodeModelEfforts,
} from "./detection";

describe("commandcode deepseek v4.1 + thinking intensity", () => {
  it("exposes curated v4.1 flash/pro models offline", () => {
    const ids = defaultCommandCodeCapabilities.models.map((m) => m.id);
    expect(ids).toContain("deepseek/deepseek-v4.1-flash");
    expect(ids).toContain("deepseek/deepseek-v4.1-pro");
  });

  it("labels v4.1 ids prettily", () => {
    const byId = new Map(defaultCommandCodeCapabilities.models.map((m) => [m.id, m.label]));
    expect(byId.get("deepseek/deepseek-v4.1-flash")).toBe("DeepSeek V4.1 Flash");
    expect(byId.get("deepseek/deepseek-v4.1-pro")).toBe("DeepSeek V4.1 Pro");
  });

  it("gives v4/v4.1 deepseek models high/max thinking range", () => {
    expect(resolveCommandCodeModelEfforts("deepseek/deepseek-v4-flash")).toEqual(["high", "max"]);
    expect(resolveCommandCodeModelEfforts("deepseek/deepseek-v4.1-flash")).toEqual(["high", "max"]);
    expect(resolveCommandCodeModelEfforts("deepseek/deepseek-v4.1-pro")).toEqual(["high", "max"]);
    expect(defaultCommandCodeCapabilities.modelEfforts?.["deepseek/deepseek-v4.1-flash"]).toEqual([
      "high",
      "max",
    ]);
  });

  it("falls back by deepseek prefix for future models instead of hiding effort", () => {
    expect(resolveCommandCodeModelEfforts("deepseek/deepseek-v4.2-xxx")).toEqual(["high", "max"]);
    expect(resolveCommandCodeModelEfforts("deepseek-v4.1-flash")).toEqual(["high", "max"]);
  });

  it("does not fabricate efforts for unknown vendors", () => {
    expect(resolveCommandCodeModelEfforts("acme/future-1")).toBeUndefined();
    expect(resolveCommandCodeModelEfforts("")).toBeUndefined();
  });

  it("advertises the official 1M window for V4 / V4.1 models", () => {
    expect(
      defaultCommandCodeCapabilities.modelContextSizes?.["deepseek/deepseek-v4-flash"],
    ).toEqual(["1M"]);
    expect(
      defaultCommandCodeCapabilities.modelContextSizes?.["deepseek/deepseek-v4.1-pro"],
    ).toEqual(["1M"]);
    expect(defaultCommandCodeCapabilities.contextSizes?.some((size) => size.id === "1M")).toBe(
      true,
    );
    const live = buildCommandCodeModelPickerCapabilities([
      { id: "deepseek/deepseek-v4-flash" },
      { id: "gpt-5.5" },
    ]);
    expect(live.modelContextSizes?.["deepseek/deepseek-v4-flash"]).toEqual(["1M"]);
    expect(live.modelContextSizes?.["gpt-5.5"]).toBeUndefined();
  });

  it("live probe models gain prefix fallback efforts + deepseek grouping", () => {
    const caps = buildCommandCodeModelPickerCapabilities([
      { id: "deepseek/deepseek-v4.1-flash", description: "fast reasoning" },
      { id: "acme/future-1", description: "unknown" },
    ]);
    expect(caps.modelEfforts?.["deepseek/deepseek-v4.1-flash"]).toEqual(["high", "max"]);
    expect(caps.modelEfforts?.["acme/future-1"]).toBeUndefined();
    expect(caps.modelSubProvider?.["deepseek/deepseek-v4.1-flash"]).toBe("deepseek");
    expect(caps.models.find((m) => m.id === "deepseek/deepseek-v4.1-flash")?.label).toBe(
      "DeepSeek V4.1 Flash",
    );
  });
});
