import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { CapabilityResolution } from "@/shared/crafting/workbenchTypes";
import { EfficientWorkbench } from "./EfficientWorkbench";

function resolution(status: CapabilityResolution["status"]): CapabilityResolution {
  return {
    resolutionKey: "test-key",
    createdAt: new Date().toISOString(),
    status,
    source: status === "NATIVE" ? "native" : "unavailable",
    modelEntryRef: "agent:codex:gpt-5.3",
    harnessRef: "harness:codex",
    capabilities: [],
    diagnostics:
      status === "IMPOSSIBLE"
        ? [
            {
              code: "RUNTIME_UNAVAILABLE",
              phase: "readiness",
              message: "Harness 未就绪或不可用",
              remediation: "请安装/配置所选 Harness",
            },
          ]
        : [],
  };
}

describe("EfficientWorkbench", () => {
  it("renders a 3x3 input grid plus one result slot", () => {
    render(<EfficientWorkbench onCraft={() => undefined} onClear={() => undefined} />);
    expect(screen.getByTestId("crafting-grid-3x3")).toBeInTheDocument();
    expect(screen.queryByTestId("crafting-grid-2x2")).toBeNull();
    expect(screen.getByTestId("crafting-slot-model")).toBeInTheDocument();
    expect(screen.getByTestId("crafting-slot-harness")).toBeInTheDocument();
    expect(screen.getByTestId("crafting-slot-component")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^crafting-slot-reserved-/)).toHaveLength(6);
    expect(screen.getByTestId("crafting-result-slot")).toBeInTheDocument();
    expect(screen.getByTestId("craft-button")).toHaveTextContent("合成");
  });

  it("exposes 合成 as the primary action and keeps it disabled off-native", () => {
    render(
      <EfficientWorkbench
        resolution={resolution("IMPOSSIBLE")}
        onCraft={() => undefined}
        onClear={() => undefined}
      />,
    );
    expect(screen.getByTestId("craft-button")).toBeDisabled();
    expect(screen.getByTestId("clear-workbench")).toHaveTextContent("清空");
  });

  it("shows the real failure reason instead of a bare status", () => {
    render(
      <EfficientWorkbench
        resolution={resolution("IMPOSSIBLE")}
        onCraft={() => undefined}
        onClear={() => undefined}
      />,
    );
    expect(screen.getByTestId("compatibility-status")).toHaveTextContent("不可合成");
    expect(screen.getByTestId("compatibility-reason")).toHaveTextContent("Harness 未就绪或不可用");
  });

  it("lets the user click 安装并合成 when CPA is the only blocker", () => {
    const blocked: CapabilityResolution = {
      ...resolution("IMPOSSIBLE"),
      diagnostics: [
        {
          code: "CPA_NOT_INSTALLED",
          phase: "readiness",
          message: "跨厂商组合需要 CLIProxyAPI",
        },
      ],
    };
    render(
      <EfficientWorkbench
        resolution={blocked}
        onCraft={() => undefined}
        onClear={() => undefined}
      />,
    );
    expect(screen.getByTestId("craft-button")).not.toBeDisabled();
    expect(screen.getByTestId("craft-button")).toHaveTextContent("安装并合成");
  });

  it("enables crafting for native resolutions", () => {
    render(
      <EfficientWorkbench
        resolution={resolution("NATIVE")}
        onCraft={() => undefined}
        onClear={() => undefined}
      />,
    );
    expect(screen.getByTestId("compatibility-status")).toHaveTextContent("原生可合成");
    expect(screen.getByTestId("craft-button")).not.toBeDisabled();
    expect(screen.queryByTestId("compatibility-reason")).not.toBeInTheDocument();
  });

  it("enables crafting for bridge-verified compatibility resolutions", () => {
    render(
      <EfficientWorkbench
        resolution={resolution("CRAFTABLE")}
        onCraft={() => undefined}
        onClear={() => undefined}
      />,
    );
    expect(screen.getByTestId("compatibility-status")).toHaveTextContent("兼容桥可合成");
    expect(screen.getByTestId("craft-button")).not.toBeDisabled();
    expect(screen.queryByTestId("compatibility-reason")).not.toBeInTheDocument();
  });

  it("keeps the component slot empty — the bridge is invisible infrastructure", () => {
    render(<EfficientWorkbench onCraft={() => undefined} onClear={() => undefined} />);
    expect(screen.queryByTestId("cpa-helper-row")).not.toBeInTheDocument();
    expect(screen.getByTestId("crafting-slot-component")).toHaveTextContent("组件");
  });
});
