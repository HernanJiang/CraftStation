import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "@heroui/react";
import { describe, expect, it, vi } from "vitest";
import { InlineFilePathChip } from "./InlineFilePathChip";

vi.mock("@/renderer/components/common/fileIcons", () => ({
  getEntryIconUrl: () => "icon.png",
}));

describe("InlineFilePathChip", () => {
  it("opens the path in the sidebar on click", async () => {
    const onOpen = vi.fn<(path: string, lineNumber?: number) => Promise<void>>(async () => {});
    render(<InlineFilePathChip path="Paper/a.pdf" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /a\.pdf/u }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("Paper/a.pdf", undefined));
  });

  it("toasts the reason once when opening fails, then goes inert", async () => {
    const toastDanger = vi.spyOn(toast, "danger").mockImplementation(() => undefined as never);
    const onOpen = vi.fn<(path: string, lineNumber?: number) => Promise<void>>(async () => {
      throw new Error("File not found: missing.md");
    });
    render(<InlineFilePathChip path="missing.md" onOpen={onOpen} />);
    const button = screen.getByRole("button", { name: /missing\.md/u });
    fireEvent.click(button);
    await waitFor(() =>
      expect(toastDanger).toHaveBeenCalledWith("无法打开 missing.md：File not found: missing.md"),
    );
    expect(button).toBeDisabled();
    toastDanger.mockRestore();
  });
});
