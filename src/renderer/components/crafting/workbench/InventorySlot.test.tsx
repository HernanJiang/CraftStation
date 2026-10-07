import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { PlugZap } from "lucide-react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { CRAFTING_SLOT_SIZE_CLASS } from "./CraftingSlot";
import { IngredientGlyph, InventorySlot } from "./InventorySlot";

describe("InventorySlot", () => {
  it("renders a button with aria-pressed when onClick and selected are supplied", () => {
    const onClick = vi.fn<() => void>();
    render(
      <InventorySlot
        name="gpt-5.3"
        visual={<span>V</span>}
        selected={true}
        testId="slot"
        onClick={onClick}
      />,
    );

    const slot = screen.getByTestId("slot");
    expect(slot.tagName).toBe("BUTTON");
    expect(slot).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(slot);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders a div when no onClick is supplied", () => {
    render(<InventorySlot name="Not open yet" visual={<span>V</span>} testId="slot" />);

    const slot = screen.getByTestId("slot");
    expect(slot.tagName).toBe("DIV");
    expect(slot).not.toHaveAttribute("aria-pressed");
  });

  it("renders the status dot for both on and off", () => {
    render(
      <>
        <InventorySlot name="a" visual={<span>V</span>} statusDot="on" testId="slot-on" />
        <InventorySlot name="b" visual={<span>V</span>} statusDot="off" testId="slot-off" />
      </>,
    );

    const onDot = screen.getByTestId("slot-on").querySelector("span[aria-hidden]");
    const offDot = screen.getByTestId("slot-off").querySelector("span[aria-hidden]");
    expect(onDot?.className).toContain("bg-emerald-400");
    expect(offDot?.className).toContain("bg-neutral-600");
  });

  it("uses the same square footprint as the crafting-grid slots", () => {
    render(<InventorySlot name="x" visual={<IngredientGlyph icon={PlugZap} tone="mcp" />} />);

    expect(screen.getByText("x").parentElement?.className).toContain(CRAFTING_SLOT_SIZE_CLASS);
    expect(CRAFTING_SLOT_SIZE_CLASS).toBe("size-[4.5rem]");
  });
});
