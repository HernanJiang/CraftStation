import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNotificationStore } from "@/renderer/state/notificationStore";
import { renderWithI18n } from "@/renderer/testUtils/i18n";
import { SidebarCodexNav } from "./SidebarCodexNav";

vi.mock("@/renderer/actions/threadActions", () => ({
  openNewThread: vi.fn<() => void>(),
  openThread: vi.fn<(threadId: string, options?: unknown) => void>(),
}));

describe("SidebarCodexNav notification bell", () => {
  beforeEach(() => {
    useNotificationStore.getState().clear();
  });

  it("keeps the unread bell until the conversation is opened, then drops the row", async () => {
    const { openThread } = await import("@/renderer/actions/threadActions");
    const { rerender } = renderWithI18n(<SidebarCodexNav />);
    expect(screen.queryByTestId("notification-unread-dot")).not.toBeInTheDocument();

    useNotificationStore.getState().push({
      tone: "success",
      title: "Refactor session",
      status: "Done · Waiting for your input",
      project: "Home",
      threadId: "thread-1",
    });
    rerender(<SidebarCodexNav />);
    expect(screen.getByTestId("notification-unread-dot")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByText("Refactor session")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Refactor session"));
    expect(openThread).toHaveBeenCalledWith("thread-1", {
      focusComposer: true,
      switchWorkspace: true,
    });
    expect(useNotificationStore.getState().items).toEqual([]);
  });

  it("shows an empty state and a clear action when there are no notifications", () => {
    renderWithI18n(<SidebarCodexNav />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByText("No notifications")).toBeInTheDocument();
    expect(screen.queryByText("Clear all")).not.toBeInTheDocument();
  });
});
