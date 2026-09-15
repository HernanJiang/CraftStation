import { describe, expect, it } from "vitest";
import {
  buildDshAcpModelWireValue,
  DSH_OFFICIAL_PROVIDER_ID,
  parseDshAcpModelWireValue,
  resolveOfficialDshModelId,
} from "./modelIds";

describe("DeepSeek Harness model-id resolution", () => {
  describe("ACP wire tuple values", () => {
    it("parses JSON [provider, model] wire values", () => {
      expect(parseDshAcpModelWireValue('["deepseek-official","deepseek-flash"]')).toEqual({
        provider: "deepseek-official",
        model: "deepseek-flash",
      });
      expect(parseDshAcpModelWireValue('["commandcode","deepseek/deepseek-v4.1-flash"]')).toEqual({
        provider: "commandcode",
        model: "deepseek/deepseek-v4.1-flash",
      });
    });

    it("returns undefined for bare ids and malformed tuples", () => {
      expect(parseDshAcpModelWireValue("deepseek-flash")).toBeUndefined();
      expect(parseDshAcpModelWireValue("")).toBeUndefined();
      expect(parseDshAcpModelWireValue(undefined)).toBeUndefined();
      expect(parseDshAcpModelWireValue('["only-one"]')).toBeUndefined();
      expect(parseDshAcpModelWireValue('["a","b","c"]')).toBeUndefined();
      expect(parseDshAcpModelWireValue("[not-json")).toBeUndefined();
    });

    it("builds wire values that round-trip", () => {
      const wire = buildDshAcpModelWireValue(DSH_OFFICIAL_PROVIDER_ID, "deepseek-v4-flash");
      expect(wire).toBe('["deepseek-official","deepseek-v4-flash"]');
      expect(parseDshAcpModelWireValue(wire)).toEqual({
        provider: "deepseek-official",
        model: "deepseek-v4-flash",
      });
    });
  });

  describe("official DSH model-id mapping", () => {
    it("passes through ids advertised by the official dsh runtime", () => {
      expect(resolveOfficialDshModelId("deepseek-flash")).toBe("deepseek-flash");
      expect(resolveOfficialDshModelId("deepseek-v4-flash")).toBe("deepseek-v4-flash");
      expect(resolveOfficialDshModelId("deepseek-v4-pro")).toBe("deepseek-v4-pro");
      expect(resolveOfficialDshModelId("deepseek-v4-flash-vision-exp")).toBe(
        "deepseek-v4-flash-vision-exp",
      );
    });

    it("maps CraftStation catalog aliases onto official ids", () => {
      // dsh 0.1.5-rc.1 advertises the V4.1 Flash under the bare id
      // "deepseek-flash" (display name "DeepSeek-V41-Flash").
      expect(resolveOfficialDshModelId("deepseek-v4.1-flash")).toBe("deepseek-flash");
    });

    it("trims whitespace before resolving", () => {
      expect(resolveOfficialDshModelId("  deepseek-flash  ")).toBe("deepseek-flash");
    });

    it("fails closed on ids the official runtime does not serve", () => {
      expect(resolveOfficialDshModelId("deepseek-v4.1-pro")).toBeUndefined();
      expect(resolveOfficialDshModelId("deepseek-chat")).toBeUndefined();
      expect(resolveOfficialDshModelId("gpt-5.6-sol")).toBeUndefined();
      expect(resolveOfficialDshModelId("deepseek/deepseek-v4.1-flash")).toBeUndefined();
      expect(resolveOfficialDshModelId("")).toBeUndefined();
    });
  });
});
