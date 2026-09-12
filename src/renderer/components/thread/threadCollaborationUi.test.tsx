import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppProvider } from "@/renderer/components/ui/provider";
import {
  collaborationStatusLabel,
  displayDialogueTitle,
  threadTargetStatusLabel,
} from "./threadCollaborationUi";

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

  it("falls back to a friendly title for id-like provenance titles", () => {
    const provenance = (title: string) => ({
      threadId: "thread-1",
      projectId: "project-1",
      title,
      modelId: "model-1",
      harnessId: "harness-1",
      agentMcpSupported: false,
    });
    expect(displayDialogueTitle(provenance("nQV8lQ"))).toBe("跨线程对话");
    expect(displayDialogueTitle(provenance(""))).toBe("跨线程对话");
    expect(displayDialogueTitle(provenance("Assistant"))).toBe("Assistant");
    expect(displayDialogueTitle(provenance("E0.2-Oracle动作上屏"))).toBe("E0.2-Oracle动作上屏");
    expect(displayDialogueTitle(provenance("D.0-MER20250V-GRPO"))).toBe("D.0-MER20250V-GRPO");
  });
});
