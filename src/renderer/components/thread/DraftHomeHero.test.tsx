import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { DraftHomeHero } from "./DraftHomeHero";

describe("DraftHomeHero", () => {
  it("renders the mascot and greeting with no quick-action cards", () => {
    render(<DraftHomeHero />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.queryByTestId("home-entry-crafting")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-entry-sidebar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-entry-models")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-entry-recipes")).not.toBeInTheDocument();
  });
});
