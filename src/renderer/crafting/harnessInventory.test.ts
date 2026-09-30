import { describe, expect, it } from "vitest";
import { shortHarnessName } from "./harnessInventory";

describe("shortHarnessName", () => {
  it("strips a trailing whole-word Harness suffix", () => {
    expect(shortHarnessName("Codex Harness")).toBe("Codex");
    expect(shortHarnessName("DeepSeek / DSH Harness")).toBe("DeepSeek / DSH");
    expect(shortHarnessName("Kimi Code harness")).toBe("Kimi Code");
  });

  it("never returns an empty name", () => {
    expect(shortHarnessName("Harness")).toBe("Harness");
    expect(shortHarnessName("  Harness  ")).toBe("Harness");
  });

  it("leaves names without the suffix untouched", () => {
    expect(shortHarnessName("Codex")).toBe("Codex");
    expect(shortHarnessName("MyHarness")).toBe("MyHarness");
    expect(shortHarnessName("DeepSeek API Runtime")).toBe("DeepSeek API Runtime");
  });
});
