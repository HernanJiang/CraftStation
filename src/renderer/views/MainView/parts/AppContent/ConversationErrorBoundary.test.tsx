import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { ConversationErrorBoundary } from "./ConversationErrorBoundary";

function ThrowingConversation(props: { shouldThrow: boolean }) {
  if (props.shouldThrow) throw new Error("conversation render failed");
  return <div>conversation-content</div>;
}

describe("ConversationErrorBoundary", () => {
  it("contains a conversation render failure and retries without changing routes", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { rerender } = render(
      <ConversationErrorBoundary resetKey="thread:one">
        <ThrowingConversation shouldThrow />
      </ConversationErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Conversation view failed to render.")).toBeInTheDocument();

    rerender(
      <ConversationErrorBoundary resetKey="thread:one">
        <ThrowingConversation shouldThrow={false} />
      </ConversationErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getByText("conversation-content")).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it("resets automatically when the active conversation changes", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { rerender } = render(
      <ConversationErrorBoundary resetKey="thread:one">
        <ThrowingConversation shouldThrow />
      </ConversationErrorBoundary>,
    );

    rerender(
      <ConversationErrorBoundary resetKey="thread:two">
        <ThrowingConversation shouldThrow={false} />
      </ConversationErrorBoundary>,
    );

    expect(screen.getByText("conversation-content")).toBeInTheDocument();
    consoleError.mockRestore();
  });
});
