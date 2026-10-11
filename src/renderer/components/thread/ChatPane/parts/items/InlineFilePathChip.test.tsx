import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
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
      expect(toastDanger).toHaveBeenCalledWith(
        "Cannot open missing.md: File not found: missing.md",
      ),
    );
    expect(button).toBeDisabled();
    toastDanger.mockRestore();
  });

  it.each([
    ["Open in sidebar", "sidebar"],
    ["Open in folder", "explorer"],
    ["Open with default app", "system"],
  ])("dispatches %s without activating the chip or its parent", async (label, action) => {
    const onOpen = vi.fn<(path: string, line?: number) => void>();
    const onShowInExplorer = vi.fn<(path: string) => void>();
    const onOpenWithSystem = vi.fn<(path: string) => void>();
    const parentContextMenu = vi.fn<() => void>();
    render(
      <div onContextMenu={parentContextMenu}>
        <InlineFilePathChip
          path="Documents/简历.pdf"
          line={12}
          onOpen={onOpen}
          onShowInExplorer={onShowInExplorer}
          onOpenWithSystem={onOpenWithSystem}
        />
      </div>,
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: /简历\.pdf/u }));
    expect(onOpen).not.toHaveBeenCalled();
    expect(parentContextMenu).not.toHaveBeenCalled();
    const item = await screen.findByRole("menuitem", { name: label });
    fireEvent.click(item);
    await waitFor(() => {
      expect(onOpen).toHaveBeenCalledTimes(action === "sidebar" ? 1 : 0);
      expect(onShowInExplorer).toHaveBeenCalledTimes(action === "explorer" ? 1 : 0);
      expect(onOpenWithSystem).toHaveBeenCalledTimes(action === "system" ? 1 : 0);
    });
    expect(onOpen.mock.calls).toEqual(action === "sidebar" ? [["Documents/简历.pdf", 12]] : []);
    expect(onShowInExplorer.mock.calls).toEqual(
      action === "explorer" ? [["Documents/简历.pdf"]] : [],
    );
    expect(onOpenWithSystem.mock.calls).toEqual(
      action === "system" ? [["Documents/简历.pdf"]] : [],
    );
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("keeps sidebar access available after the default application fails", async () => {
    const toastDanger = vi.spyOn(toast, "danger").mockImplementation(() => undefined as never);
    try {
      const onOpen = vi.fn<(path: string, line?: number) => void>();
      render(
        <InlineFilePathChip
          path="a.pdf"
          onOpen={onOpen}
          onOpenWithSystem={() => {
            throw new Error("No application is associated with this file");
          }}
        />,
      );
      const chip = screen.getByRole("button", { name: /a\.pdf/u });
      fireEvent.contextMenu(chip);
      fireEvent.click(await screen.findByRole("menuitem", { name: "Open with default app" }));
      await waitFor(() =>
        expect(toastDanger).toHaveBeenCalledWith(
          "Cannot open a.pdf: No application is associated with this file",
        ),
      );
      expect(chip).not.toBeDisabled();
      fireEvent.click(chip);
      expect(onOpen).toHaveBeenCalledWith("a.pdf", undefined);
    } finally {
      toastDanger.mockRestore();
    }
  });
});
