import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { SelectedModelEntry } from "@/shared/crafting/workbenchTypes";
import { CRAFTING_SLOT_SIZE_CLASS } from "./CraftingSlot";
import { ModelsInventory } from "./ModelsInventory";

function entry(entryId: string, displayName: string): SelectedModelEntry {
  return {
    entryId,
    source: "agent",
    providerKind: "openai",
    providerSurfaceKey: "openai",
    providerLabel: "OpenAI",
    channelLabel: "订阅",
    modelId: "gpt-5.3",
    displayName,
  };
}

describe("ModelsInventory layout", () => {
  it("fills remaining column height instead of capping at a truncated max-height", () => {
    render(<ModelsInventory entries={[]} onSelect={() => undefined} onAdd={() => undefined} />);

    const column = screen.getByTestId("models-inventory");
    expect(column.className).toContain("flex-1");
    expect(column.className).toContain("min-h-0");

    const grid = screen.getByTestId("models-inventory-grid");
    expect(grid.className).toContain("flex-1");
    expect(grid.className).toContain("overflow-y-auto");
    expect(grid.className).not.toContain("max-h-72");
  });

  it("renders entries as square slots matching the crafting-grid footprint", () => {
    render(
      <ModelsInventory
        entries={[entry("agent:openai:gpt-5.3", "GPT-5.3")]}
        selectedEntryId="agent:openai:gpt-5.3"
        onSelect={() => undefined}
        onAdd={() => undefined}
      />,
    );

    const slot = screen.getByText("GPT-5.3").closest("button");
    expect(slot?.className).toContain(CRAFTING_SLOT_SIZE_CLASS);
    expect(slot).toHaveAttribute("aria-pressed", "true");
  });
});
