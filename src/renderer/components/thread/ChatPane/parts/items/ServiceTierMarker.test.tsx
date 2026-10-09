import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithI18n } from "@/renderer/testUtils/i18n";
import { ServiceTierMarker } from "./ServiceTierMarker";

afterEach(cleanup);
describe("回合实际档位展示", () => {
  it.each([
    [{ requested: "ultrafast", status: "unknown" }, "实际档位未报告"],
    [
      { requested: "ultrafast", actual: "ultrafast", status: "confirmed" },
      "实际 Ultrafast · 已确认",
    ],
    [{ requested: "ultrafast", actual: "default", status: "downgraded" }, "实际 Standard · 已降档"],
    [{ requested: "ultrafast", status: "rejected" }, "请求被拒绝"],
  ])("持久化回合证据 %j", (payload, message) => {
    renderWithI18n(
      <ServiceTierMarker
        item={{
          id: "persisted-tier",
          type: "service_tier",
          state: "completed",
          streams: {},
          payload,
        }}
      />,
    );
    const row = screen.getByTestId("service-tier-status");
    expect(row).toHaveTextContent(`请求 Ultrafast · ${message}`);
    expect(row.title).toContain("8 倍");
  });
});
