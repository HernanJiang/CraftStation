import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { ModelsInventory } from "./ModelsInventory";

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
});
