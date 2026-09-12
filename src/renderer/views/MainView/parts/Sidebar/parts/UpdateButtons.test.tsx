import { beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useUpdateStore } from "@/renderer/state/updateStore";
import { UpdateButtons } from "./UpdateButtons";

describe("UpdateButtons agent progress", () => {
  beforeEach(() => {
    useUpdateStore.setState({
      phase: "idle",
      version: null,
      downloadPercent: 0,
      agentUpdates: {},
    });
  });

  it("renders nothing when nothing is in flight", () => {
    const { container } = render(<UpdateButtons />);
    expect(container.textContent).toBe("");
  });

  it("renders an indeterminate row per in-flight agent update", () => {
    useUpdateStore.setState({
      agentUpdates: {
        "grok:windows:": { label: "Grok", startedAt: Date.now() },
      },
    });
    render(<UpdateButtons />);

    expect(screen.getByText(/Updating Grok/)).toBeInTheDocument();
  });

  it("keeps the app download bar alongside agent rows", () => {
    useUpdateStore.setState({
      phase: "downloading",
      downloadPercent: 42,
      downloadTransferred: 42,
      downloadTotal: 100,
      agentUpdates: {
        "kimi:windows:": { label: "Kimi", startedAt: Date.now() },
      },
    });
    render(<UpdateButtons />);

    expect(screen.getByText(/Updating Kimi/)).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
  });
});
