import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { EMPTY_CREATIVE_DRAFT } from "@/shared/crafting/workbenchTypes";
import { EfficientWorkbench } from "./EfficientWorkbench";
import { CreativeWorkbenchShell } from "./CreativeWorkbenchShell";

describe("EfficientWorkbench", () => {
  it("renders a 2x2 input grid plus one result slot", () => {
    render(<EfficientWorkbench onCraft={() => undefined} onClear={() => undefined} />);
    expect(screen.getByTestId("crafting-grid-2x2")).toBeInTheDocument();
    expect(screen.queryByTestId("crafting-grid-4x4")).toBeNull();
    expect(screen.getByTestId("crafting-slot-model")).toBeInTheDocument();
    expect(screen.getByTestId("crafting-slot-harness")).toBeInTheDocument();
    expect(screen.getByTestId("crafting-slot-pack")).toBeInTheDocument();
    expect(screen.getByTestId("crafting-slot-reserved")).toBeInTheDocument();
    expect(screen.getByTestId("crafting-result-slot")).toBeInTheDocument();
    expect(screen.getByTestId("craft-button")).toHaveTextContent("合成");
  });
});

describe("CreativeWorkbenchShell", () => {
  it("renders a 3x3 input grid plus one result slot", () => {
    render(<CreativeWorkbenchShell draft={EMPTY_CREATIVE_DRAFT} onClear={vi.fn<() => void>()} />);
    expect(screen.getByTestId("crafting-grid-3x3")).toBeInTheDocument();
    expect(screen.getByTestId("crafting-slot-creative-0")).toBeInTheDocument();
    expect(screen.getByTestId("crafting-slot-creative-8")).toBeInTheDocument();
    expect(screen.getByTestId("crafting-result-slot")).toBeInTheDocument();
    expect(screen.getByTestId("craft-button")).toHaveTextContent("合成");
  });
});
