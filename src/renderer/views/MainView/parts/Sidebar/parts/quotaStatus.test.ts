import { describe, expect, it } from "vitest";
import {
  formatUsedQuota,
  maxUsedPercent,
  quotaDisplayStateClass,
  quotaDisplayStateLabel,
  resolveAccountQuotaDisplayState,
  resolveProviderQuotaDisplayState,
  userFacingTokenMessage,
} from "./quotaStatus";

describe("quotaStatus", () => {
  it("maps measured provider usage to the three user-facing states", () => {
    expect(resolveProviderQuotaDisplayState("ok", [{ usedPercent: 89 }])).toBe("sufficient");
    expect(resolveProviderQuotaDisplayState("ok", [{ usedPercent: 90 }])).toBe("low");
    expect(resolveProviderQuotaDisplayState("ok", [{ usedPercent: 100 }])).toBe("unavailable");
  });

  it("treats provider failures and missing quota windows as unavailable", () => {
    expect(resolveProviderQuotaDisplayState("error", [{ usedPercent: 1 }])).toBe("unavailable");
    expect(resolveProviderQuotaDisplayState("app-not-running", [])).toBe("unavailable");
    expect(resolveProviderQuotaDisplayState("ok", [])).toBe("unavailable");
  });

  it("keeps account quota-low as a warning and hard account states red", () => {
    expect(resolveAccountQuotaDisplayState("quota-low", [{ usedPercent: 1 }])).toBe("low");
    expect(resolveAccountQuotaDisplayState("quota-exhausted", [{ usedPercent: 1 }])).toBe(
      "unavailable",
    );
    expect(resolveAccountQuotaDisplayState("quota-low", [{ usedPercent: 100 }])).toBe(
      "unavailable",
    );
    expect(resolveAccountQuotaDisplayState("available", [])).toBe("unavailable");
  });

  it("uses the highest active window for the first-row used quota", () => {
    expect(maxUsedPercent([{ usedPercent: 12 }, { usedPercent: 81.4 }])).toBe(81.4);
    expect(formatUsedQuota(81.4)).toBe("已用额度 81%");
    expect(formatUsedQuota(null)).toBe("已用额度 --");
  });

  it("provides the requested Chinese labels and warning colors", () => {
    expect(quotaDisplayStateLabel("sufficient")).toBe("额度充足");
    expect(quotaDisplayStateLabel("low")).toBe("额度低");
    expect(quotaDisplayStateLabel("unavailable")).toBe("不可用");
    expect(quotaDisplayStateClass("low")).toContain("amber");
    expect(quotaDisplayStateClass("unavailable")).toContain("red");
    expect(userFacingTokenMessage("Runtime ledger has no exact account usage.")).toBe(
      "暂无精确 Token 用量",
    );
  });
});
