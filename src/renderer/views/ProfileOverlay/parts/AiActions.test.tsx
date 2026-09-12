import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { AiActions } from "./AiActions";

describe("AiActions", () => {
  it("renders the honest empty state when nothing was tracked", () => {
    render(<AiActions actions={[]} />);
    expect(screen.getByText(/No AI commits, pushes, PRs/)).toBeInTheDocument();
  });

  it("renders the fixed Commit/Push/PR/Merge/Branch rows with real counts", () => {
    render(
      <AiActions
        actions={[
          { type: "commit", label: "Commit", count: 2, topProvider: "Codex" },
          { type: "push", label: "Push", count: 1 },
        ]}
      />,
    );
    expect(screen.getByText("Commit").closest("div")).toHaveTextContent("2");
    expect(screen.getByText("Push").closest("div")).toHaveTextContent("1");
    // Categories without data render as real zeros, never fabricated numbers.
    expect(screen.getByText("PR").closest("div")).toHaveTextContent("0");
    expect(screen.getByText("Merge / Conflict Resolve").closest("div")).toHaveTextContent("0");
    expect(screen.getByText("Branch").closest("div")).toHaveTextContent("0");
    expect(screen.queryByText("其他 Git Action")).toBeNull();
  });

  it("appends the Other row only when unknown kinds were bucketed", () => {
    render(
      <AiActions
        actions={[
          { type: "commit", label: "Commit", count: 1 },
          { type: "other", label: "其他 Git Action", count: 3 },
        ]}
      />,
    );
    expect(screen.getByText("其他 Git Action").closest("div")).toHaveTextContent("3");
  });
});
