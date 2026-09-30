import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { ComponentsInventory } from "./ComponentsInventory";

describe("ComponentsInventory", () => {
  it("uses a four-column card grid by default", () => {
    render(<ComponentsInventory onSelect={() => undefined} />);
    expect(screen.getByTestId("components-inventory-grid").className).toContain("grid-cols-4");
  });

  it("uses a two-column card grid in compact rail mode", () => {
    render(<ComponentsInventory compact onSelect={() => undefined} />);
    expect(screen.getByTestId("components-inventory-grid").className).toContain("grid-cols-2");
  });
});
