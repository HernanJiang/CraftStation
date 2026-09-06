import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({
    listWslDistros: vi.fn<() => Promise<string[]>>().mockResolvedValue([]),
  }),
}));

import { WelcomeOverlay } from "./WelcomeOverlay";

describe("WelcomeOverlay startup pipeline", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("covers background hydration with a spinning logo and loading copy", () => {
    const { container } = render(<WelcomeOverlay ready={false} />);
    expect(screen.getByTestId("welcome-loading-status")).toHaveTextContent("Starting up");
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    expect(container.querySelector('[data-welcome-spinning="true"]')).not.toBeNull();
    expect(container.querySelector('[data-welcome-loading="true"]')).not.toBeNull();
  });

  it("reveals a single start action as soon as background hydration finishes", () => {
    const { rerender, container } = render(<WelcomeOverlay ready={false} />);
    rerender(<WelcomeOverlay ready />);
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.queryByTestId("welcome-loading-status")).not.toBeInTheDocument();
    expect(container.querySelector('[data-welcome-spinning="true"]')).toBeNull();
    expect(container.querySelector('[data-welcome-loading="true"]')).toBeNull();
  });
});
