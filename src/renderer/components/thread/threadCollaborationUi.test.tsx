import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppProvider } from "@/renderer/components/ui/provider";
import { collaborationStatusLabel, threadTargetStatusLabel } from "./threadCollaborationUi";

describe("thread collaboration UI labels", () => {
  it("localizes known target runtime statuses", () => {
    render(
      <AppProvider>
        <div>
          <span>{threadTargetStatusLabel("working")}</span>
          <span>{threadTargetStatusLabel("needs_reply")}</span>
        </div>
      </AppProvider>,
    );

    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText("Needs reply")).toBeInTheDocument();
  });

  it("keeps exchange status labels stable and uses a safe fallback for future statuses", () => {
    render(
      <AppProvider>
        <div>
          <span>{collaborationStatusLabel("replied")}</span>
          <span>{threadTargetStatusLabel("future-status")}</span>
        </div>
      </AppProvider>,
    );

    expect(screen.getByText("Replied")).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });
});
